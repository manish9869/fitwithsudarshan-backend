/**
 * This is the ONLY price the server trusts for checkout — these tests exist
 * specifically to pin down that behavior: a valid combination resolves to
 * the DB-stored price, and anything else (wrong type/duration, or a table
 * that hasn't been seeded) throws rather than silently defaulting to 0/undefined.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { resolvePrice, getValidCoachingTypeIds } = await import('../../src/services/pricingService.js');

describe('resolvePrice', () => {
    beforeEach(() => {
        const fake = createFakeSupabase({
            pricing: [
                { id: '1', coaching_type_id: 'online', plan_type: 'individual', duration_months: '3', price: 15000 },
                { id: '2', coaching_type_id: 'online', plan_type: 'couple', duration_months: '3', price: 25000 },
                { id: '3', coaching_type_id: 'personal', plan_type: 'individual', duration_months: '1', price: 20000 },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('resolves the exact price for a valid coachingType/planType/durationMonths combination', async () => {
        await expect(resolvePrice({ coachingType: 'online', planType: 'individual', durationMonths: '3' }))
            .resolves.toBe(15000);
    });

    it('is keyed independently per plan type — couple pricing does not leak into individual', async () => {
        await expect(resolvePrice({ coachingType: 'online', planType: 'couple', durationMonths: '3' }))
            .resolves.toBe(25000);
    });

    it('rejects a duration that was never priced for that plan (no silent fallback to 0)', async () => {
        await expect(resolvePrice({ coachingType: 'online', planType: 'individual', durationMonths: '12' }))
            .rejects.toThrow(/invalid coaching type, plan type, or duration/i);
    });

    it('rejects an unknown coaching type entirely', async () => {
        await expect(resolvePrice({ coachingType: 'made-up-tier', planType: 'individual', durationMonths: '3' }))
            .rejects.toThrow();
    });

    it('coerces a numeric durationMonths the same way a string one resolves', async () => {
        // The client may send durationMonths as either type across call sites;
        // resolvePrice keys on String(durationMonths) specifically so both work.
        await expect(resolvePrice({ coachingType: 'personal', planType: 'individual', durationMonths: 1 }))
            .resolves.toBe(20000);
    });
});

describe('getValidCoachingTypeIds', () => {
    it('returns only coaching types marked active', async () => {
        const fake = createFakeSupabase({
            coaching_types: [
                { id: 'online', active: true, sort_order: 1 },
                { id: 'video', active: true, sort_order: 2 },
                { id: 'personal', active: false, sort_order: 3 },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        await expect(getValidCoachingTypeIds()).resolves.toEqual(['online', 'video']);
    });
});
