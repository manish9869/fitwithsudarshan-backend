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

export async function getAnalyticsOverview(days = 30) {
    assertGa4Configured();

    const cached = _cache.get(days);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

    const client = getGaClient();
    const property = ga4PropertyPath();
    const dateRange = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

    const [totalsResp, seriesResp, pagesResp, channelsResp, devicesResp, countriesResp] = await Promise.all([
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
            limit: 10,
        }),
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

    const result = { totals, series, topPages, channels, devices, countries, fetchedAt: new Date().toISOString() };
    _cache.set(days, { data: result, ts: Date.now() });
    return result;
}
