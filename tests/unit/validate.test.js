import { describe, it, expect } from 'vitest';
import { validateCreateOrder, validateVerifyPayment } from '../../src/utils/validate.js';

const VALID_COACHING_TYPES = ['online', 'video', 'personal'];

describe('validateCreateOrder', () => {
    const validBody = {
        coachingType: 'online',
        planType: 'individual',
        durationMonths: '3',
        customerName: 'Jane Doe',
        customerEmail: 'jane@example.com',
    };

    it('accepts a fully valid checkout payload', () => {
        expect(validateCreateOrder(validBody, VALID_COACHING_TYPES)).toEqual([]);
    });

    it('rejects a coaching type not in the server-provided allow-list', () => {
        const errors = validateCreateOrder({ ...validBody, coachingType: 'vip-secret-tier' }, VALID_COACHING_TYPES);
        expect(errors.some((e) => e.includes('coachingType'))).toBe(true);
    });

    it('rejects an invalid planType', () => {
        const errors = validateCreateOrder({ ...validBody, planType: 'enterprise' }, VALID_COACHING_TYPES);
        expect(errors.some((e) => e.includes('planType'))).toBe(true);
    });

    it('rejects an out-of-range durationMonths for a non-basic plan', () => {
        const errors = validateCreateOrder({ ...validBody, durationMonths: '2' }, VALID_COACHING_TYPES);
        expect(errors.some((e) => e.includes('durationMonths'))).toBe(true);
    });

    it('does not require durationMonths for basic (one-time) plans', () => {
        const errors = validateCreateOrder(
            { ...validBody, planType: 'basic_individual', durationMonths: undefined },
            VALID_COACHING_TYPES
        );
        expect(errors).toEqual([]);
    });

    it('rejects a missing/blank customerName', () => {
        expect(validateCreateOrder({ ...validBody, customerName: '   ' }, VALID_COACHING_TYPES))
            .toEqual(expect.arrayContaining([expect.stringContaining('customerName')]));
    });

    it('rejects an email without an @', () => {
        expect(validateCreateOrder({ ...validBody, customerEmail: 'not-an-email' }, VALID_COACHING_TYPES))
            .toEqual(expect.arrayContaining([expect.stringContaining('customerEmail')]));
    });

    it('collects every violation at once, not just the first', () => {
        const errors = validateCreateOrder(
            { coachingType: '', planType: '', durationMonths: '99', customerName: '', customerEmail: '' },
            VALID_COACHING_TYPES
        );
        expect(errors.length).toBeGreaterThanOrEqual(4);
    });
});

describe('validateVerifyPayment', () => {
    it('accepts a complete set of Razorpay callback fields', () => {
        const errors = validateVerifyPayment({
            razorpay_order_id: 'order_1',
            razorpay_payment_id: 'pay_1',
            razorpay_signature: 'sig_1',
        });
        expect(errors).toEqual([]);
    });

    it('flags each missing field individually', () => {
        expect(validateVerifyPayment({})).toEqual([
            'razorpay_order_id is required',
            'razorpay_payment_id is required',
            'razorpay_signature is required',
        ]);
    });
});
