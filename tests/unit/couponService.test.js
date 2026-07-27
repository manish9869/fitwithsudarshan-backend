import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { validateCouponCode, incrementCouponUsage } = await import('../../src/services/couponService.js');

function baseCoupon(overrides = {}) {
    return {
        id: 'coupon-1',
        code: 'SAVE10',
        active: true,
        type: 'PERCENT',
        percent: 10,
        used_count: 0,
        max_uses: null,
        applicable_coaching_types: null,
        applicable_plan_types: null,
        applicable_durations: null,
        starts_at: null,
        expires_at: null,
        label: 'Save 10%',
        description: '10% off',
        ...overrides,
    };
}

describe('validateCouponCode', () => {
    it('applies a PERCENT discount correctly', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon()] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'save10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });

        expect(result.valid).toBe(true);
        expect(result.discountedPrice).toBe(13500);
        expect(result.savings).toBe(1500);
    });

    it('applies a FLAT discount and never goes negative', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ type: 'FLAT', flat: 50000 })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'SAVE10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });

        expect(result.discountedPrice).toBe(0);
    });

    it('rejects a code that does not exist', async () => {
        const fake = createFakeSupabase({ coupons: [] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'NOPE', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });
        expect(result.valid).toBe(false);
    });

    it('rejects an inactive coupon', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ active: false })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'SAVE10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });
        expect(result.valid).toBe(false);
    });

    it('rejects a coupon that has hit its usage cap', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ max_uses: 5, used_count: 5 })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'SAVE10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/usage limit/i);
    });

    it('rejects a coupon outside its active date window', async () => {
        const future = new Date(Date.now() + 86400000).toISOString();
        const fake = createFakeSupabase({ coupons: [baseCoupon({ starts_at: future })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'SAVE10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });
        expect(result.valid).toBe(false);
    });

    it('rejects a coupon restricted to a different coaching type', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ applicable_coaching_types: ['personal'] })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'SAVE10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });
        expect(result.valid).toBe(false);
    });

    it('is case-insensitive on the code', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ code: 'WELCOME10' })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const result = await validateCouponCode({
            code: 'welcome10', coachingType: 'online', planType: 'individual', durationMonths: '3', originalPrice: 15000,
        });
        expect(result.valid).toBe(true);
    });
});

describe('incrementCouponUsage', () => {
    it('increments used_count via the atomic RPC', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ used_count: 3 })] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        await incrementCouponUsage('SAVE10');

        expect(fake.client.rpc).toHaveBeenCalledWith('increment_coupon_usage', { coupon_id: 'coupon-1' });
        expect(fake.tables.coupons[0].used_count).toBe(4);
    });

    it('falls back to a direct update if the RPC is unavailable, so usage tracking never silently stops', async () => {
        const fake = createFakeSupabase({ coupons: [baseCoupon({ used_count: 3 })] });
        fake.client.rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: 'function does not exist' } }));
        getSupabaseAdmin.mockReturnValue(fake.client);

        await incrementCouponUsage('SAVE10');

        expect(fake.tables.coupons[0].used_count).toBe(4);
    });

    it('is a no-op for a code that does not exist (never throws)', async () => {
        const fake = createFakeSupabase({ coupons: [] });
        getSupabaseAdmin.mockReturnValue(fake.client);

        await expect(incrementCouponUsage('GHOST-CODE')).resolves.toBeUndefined();
    });
});
