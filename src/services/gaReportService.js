// src/services/gaReportService.js
// Historical GA4 metrics for the admin Analytics page — pageviews/sessions/
// users over time, top pages, traffic sources, device split, top countries.
// Separate from gaRealtimeService.js (which only covers "active users right
// now" via the Realtime API); this uses GA4's standard runReport, which
// supports date ranges but lags real time by a few hours (GA4's normal
// processing delay) — expected for historical reporting, unlike the
// Realtime widget.
import { getGaClient, ga4PropertyPath, assertGa4Configured, isGa4Configured } from '../utils/gaClient.js';

export { isGa4Configured };

const CACHE_TTL_MS = 5 * 60 * 1000; // historical data moves far slower than realtime
const _cache = new Map(); // days -> { data, ts }

function metricValue(row, i) {
    return Number(row.metricValues?.[i]?.value) || 0;
}
function dimValue(row, i) {
    return row.dimensionValues?.[i]?.value ?? '(not set)';
}

// GA4 returns YYYYMMDD for the `date` dimension with no separators.
function formatGaDate(raw) {
    if (!/^\d{8}$/.test(raw)) return raw;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

const CHANNEL_LABELS = {
    'Organic Search': 'Organic Search', 'Direct': 'Direct', 'Referral': 'Referral',
    'Organic Social': 'Social', 'Paid Search': 'Paid Search', 'Paid Social': 'Paid Social',
    'Email': 'Email', 'Unassigned': 'Other',
};

// Admin panel navigation stopped firing page_view events at the source
// (useAnalyticsPageview.js), but historical data already collected before
// that fix still has /admin/* rows mixed in — filter it out of every
// page-level report so it doesn't need 30+ days to age out on its own.
// Coach/admin activity was never customer traffic worth reporting on here.
const EXCLUDE_ADMIN_PAGES = {
    notExpression: {
        filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/admin' } },
    },
};

// /upload-photos/<uuid> is a per-session upload link, not a page anyone
// "visits" in a way worth reporting on — each row is a one-off UUID that's
// meaningless in a ranked list and never recurs, so it's excluded from
// page-level reports the same way admin traffic is.
const EXCLUDE_UPLOAD_PHOTO_PAGES = {
    notExpression: {
        filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/upload-photos' } },
    },
};

const EXCLUDE_NOISE_PAGES = {
    andGroup: { expressions: [EXCLUDE_ADMIN_PAGES, EXCLUDE_UPLOAD_PHOTO_PAGES] },
};

// ── Section-level engagement (in-page scroll sections on the one-page
// landing — Transformations, Pricing, etc.) ─────────────────────────────
// GA4's page_view-based reporting has no visibility into which part of one
// long single route someone was looking at; the frontend fills that gap
// with a custom `section_engagement` event (see useSectionEngagement.js),
// carrying `section_name`/`engaged_seconds` as event parameters.
//
// Those parameters only become queryable via the Data API — as
// `customEvent:section_name` / `customEvent:engaged_seconds` — after
// they're registered as Custom Definitions in the GA4 console (Admin →
// Custom definitions). That's a one-time manual step outside this
// codebase; until it's done, this query 400s. Run separately from the main
// Promise.all() below (not inside it) so that failure returns an empty,
// clearly-"not configured yet" result instead of taking down the whole
// Analytics page.
async function getSectionEngagement(client, property, dateRange) {
    try {
        const [resp] = await client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'customEvent:section_name' }],
            metrics: [{ name: 'customEvent:engaged_seconds' }, { name: 'eventCount' }],
            orderBys: [{ metric: { metricName: 'customEvent:engaged_seconds' }, desc: true }],
            limit: 15,
        });
        const sections = (resp.rows || []).map((r) => {
            const totalSeconds = metricValue(r, 0);
            const events = metricValue(r, 1);
            return {
                section: dimValue(r, 0),
                avgEngagementSeconds: events > 0 ? Math.round(totalSeconds / events) : 0,
                views: events,
            };
        });
        return { configured: true, sections };
    } catch {
        // Almost always means the custom dimension/metric hasn't been
        // registered in the GA4 console yet — not a real failure.
        return { configured: false, sections: [] };
    }
}

export async function getAnalyticsOverview(days = 30) {
    assertGa4Configured();

    const cached = _cache.get(days);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

    const client = await getGaClient();
    const property = ga4PropertyPath();
    const dateRange = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

    const [totalsResp, seriesResp, pagesResp, engagementResp, sectionEngagement, channelsResp, devicesResp, countriesResp] = await Promise.all([
        client.runReport({
            property, dateRanges: dateRange,
            metrics: [
                { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' },
                { name: 'screenPageViews' }, { name: 'averageSessionDuration' }, { name: 'bounceRate' },
            ],
        }),
        client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
        }),
        client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }],
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            dimensionFilter: EXCLUDE_NOISE_PAGES,
            limit: 10,
        }),
        // ── Time spent per page — GA4's userEngagementDuration is total
        // foreground/active seconds attributed to a page, the same number
        // GA4's own "Pages and screens" report divides by active users to
        // get "average engagement time." Requires page_view to fire on
        // every route change (it does, via AnalyticsTracker) — no GA4
        // console setup needed, unlike custom-event-based tracking.
        client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'userEngagementDuration' }, { name: 'screenPageViews' }, { name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'userEngagementDuration' }, desc: true }],
            dimensionFilter: EXCLUDE_NOISE_PAGES,
            limit: 15,
        }),
        getSectionEngagement(client, property, dateRange),
        client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 8,
        }),
        client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'deviceCategory' }],
            metrics: [{ name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        }),
        client.runReport({
            property, dateRanges: dateRange,
            dimensions: [{ name: 'country' }],
            metrics: [{ name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
            limit: 8,
        }),
    ]);

    const totalsRow = totalsResp[0].rows?.[0];
    const totals = {
        activeUsers: totalsRow ? metricValue(totalsRow, 0) : 0,
        newUsers: totalsRow ? metricValue(totalsRow, 1) : 0,
        sessions: totalsRow ? metricValue(totalsRow, 2) : 0,
        pageViews: totalsRow ? metricValue(totalsRow, 3) : 0,
        avgSessionSeconds: totalsRow ? Math.round(metricValue(totalsRow, 4)) : 0,
        bounceRate: totalsRow ? Math.round(metricValue(totalsRow, 5) * 1000) / 10 : 0, // GA4 returns a 0..1 fraction
    };

    const series = (seriesResp[0].rows || []).map((r) => ({
        date: formatGaDate(dimValue(r, 0)),
        users: metricValue(r, 0),
        sessions: metricValue(r, 1),
        pageViews: metricValue(r, 2),
    }));

    const topPages = (pagesResp[0].rows || []).map((r) => ({
        path: dimValue(r, 0),
        views: metricValue(r, 0),
    }));

    // avgEngagementSeconds = total engaged time on the page ÷ how many
    // active users landed on it — the same math GA4's own UI uses for
    // "average engagement time per active user" per page.
    const timeOnPage = (engagementResp[0].rows || []).map((r) => {
        const totalSeconds = metricValue(r, 0);
        const users = metricValue(r, 2);
        return {
            path: dimValue(r, 0),
            views: metricValue(r, 1),
            avgEngagementSeconds: users > 0 ? Math.round(totalSeconds / users) : 0,
        };
    });

    const channels = (channelsResp[0].rows || []).map((r) => {
        const raw = dimValue(r, 0);
        return { channel: CHANNEL_LABELS[raw] || raw, sessions: metricValue(r, 0) };
    });

    const devices = (devicesResp[0].rows || []).map((r) => ({
        device: dimValue(r, 0),
        users: metricValue(r, 0),
    }));

    const countries = (countriesResp[0].rows || []).map((r) => ({
        country: dimValue(r, 0),
        users: metricValue(r, 0),
    }));

    const result = { totals, series, topPages, timeOnPage, sectionEngagement, channels, devices, countries, fetchedAt: new Date().toISOString() };
    _cache.set(days, { data: result, ts: Date.now() });
    return result;
}
