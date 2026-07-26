// src/services/pricingService.js
// Replaces src/data/serverPricing.js entirely — delete that file.
// This is the ONLY price the server trusts; it never comes from the client.
import { getPricingTable, listRows } from './contentService.js';

const CACHE_TTL_MS = 30_000;
let _cache = { table: null, ts: 0 };
let _typesCache = { ids: null, ts: 0 };

export async function getCachedPricingTable() {
    const now = Date.now();
    if (_cache.table && now - _cache.ts < CACHE_TTL_MS) return _cache.table;
    const table = await getPricingTable();
    _cache = { table, ts: now };
    return table;
}

export async function getValidCoachingTypeIds() {
    const now = Date.now();
    if (_typesCache.ids && now - _typesCache.ts < CACHE_TTL_MS) return _typesCache.ids;
    const rows = await listRows('coaching_types');
    const ids = rows.filter((r) => r.active).map((r) => r.id);
    _typesCache = { ids, ts: now };
    return ids;
}

export async function resolvePrice({ coachingType, planType, durationMonths }) {
    const table = await getCachedPricingTable();
    const price = table[coachingType]?.[planType]?.[String(durationMonths)];
    if (price == null) {
        throw new Error('Invalid coaching type, plan type, or duration combination.');
    }
    return price;
}