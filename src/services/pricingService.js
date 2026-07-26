// src/services/pricingService.js
// This is the ONLY price the server trusts; it never comes from the client.
//
// Deliberately UNCACHED. This used to keep its own 30s in-memory cache,
// separate from contentService's cache — admin price/sale edits invalidate
// the latter but had no way to reach this module's private cache, so a
// customer could complete checkout at the old price for up to 30s after an
// admin saved a new one. Order creation is low-frequency; correctness here
// matters far more than saving one DB round-trip per order.
import { getPricingTable, listRows } from './contentService.js';

export async function getCachedPricingTable() {
    return getPricingTable();
}

export async function getValidCoachingTypeIds() {
    const rows = await listRows('coaching_types');
    return rows.filter((r) => r.active).map((r) => r.id);
}

export async function resolvePrice({ coachingType, planType, durationMonths }) {
    const table = await getCachedPricingTable();
    const price = table[coachingType]?.[planType]?.[String(durationMonths)];
    if (price == null) {
        throw new Error('Invalid coaching type, plan type, or duration combination.');
    }
    return price;
}