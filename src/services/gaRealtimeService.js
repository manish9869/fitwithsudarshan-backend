// src/services/gaRealtimeService.js
// Powers the admin dashboard's "Live Visitors" widget by calling GA4's
// Realtime Data API — the same "active users right now" number GA shows in
// its own Realtime report, not a separate visitor-tracking system of our
// own. Requires a Google Cloud service account with Viewer access on the
// GA4 property (see config.ga4 in config/env.js for the three env vars).
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { config } from '../config/env.js';

const CACHE_TTL_MS = 15_000;
let _cache = { data: null, ts: 0 };
let _client = null;

export function isGa4Configured() {
    return !!(config.ga4.propertyId && config.ga4.clientEmail && config.ga4.privateKey);
}

function getClient() {
    if (!_client) {
        _client = new BetaAnalyticsDataClient({
            credentials: {
                client_email: config.ga4.clientEmail,
                private_key: config.ga4.privateKey,
            },
        });
    }
    return _client;
}

// GA4's Realtime API reports users active in roughly the last 30 minutes,
// refreshed on GA's end every ~60s — polling this more often than our own
// cache TTL just burns API quota for a number that hasn't moved yet.
export async function getLiveUsers() {
    if (!isGa4Configured()) {
        const err = new Error('GA4 is not configured');
        err.code = 'GA4_NOT_CONFIGURED';
        throw err;
    }

    if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) {
        return _cache.data;
    }

    const client = getClient();
    const [response] = await client.runRealtimeReport({
        property: `properties/${config.ga4.propertyId}`,
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }],
    });

    const rows = response.rows || [];
    const total = rows.reduce((sum, r) => sum + (Number(r.metricValues?.[0]?.value) || 0), 0);
    const topPages = rows
        .map((r) => ({ page: r.dimensionValues?.[0]?.value || '(not set)', users: Number(r.metricValues?.[0]?.value) || 0 }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 5);

    const result = { total, topPages, fetchedAt: new Date().toISOString() };
    _cache = { data: result, ts: Date.now() };
    return result;
}
