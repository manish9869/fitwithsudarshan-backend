// src/services/gaRealtimeService.js
// Powers the admin dashboard's "Live Visitors" widget by calling GA4's
// Realtime Data API — the same "active users right now" number GA shows in
// its own Realtime report, not a separate visitor-tracking system of our
// own.
import { getGaClient, ga4PropertyPath, assertGa4Configured, isGa4Configured } from '../utils/gaClient.js';

export { isGa4Configured };

const CACHE_TTL_MS = 15_000;
let _cache = { data: null, ts: 0 };

// GA4's Realtime API reports users active in roughly the last 30 minutes,
// refreshed on GA's end every ~60s — polling this more often than our own
// cache TTL just burns API quota for a number that hasn't moved yet.
export async function getLiveUsers() {
    assertGa4Configured();

    if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) {
        return _cache.data;
    }

    const client = getGaClient();
    const [response] = await client.runRealtimeReport({
        property: ga4PropertyPath(),
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
