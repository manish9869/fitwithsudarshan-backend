import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyPaymentSignature, timingSafeEqualStr } from '../../src/utils/razorpay.js';

describe('verifyPaymentSignature', () => {
    const orderId = 'order_abc';
    const paymentId = 'pay_xyz';
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const validSignature = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    it('accepts a correctly computed signature', () => {
        expect(verifyPaymentSignature({ orderId, paymentId, signature: validSignature })).toBe(true);
    });

    it('rejects a signature computed for a different payment id (cannot replay one payment onto another order)', () => {
        const wrongSignature = crypto.createHmac('sha256', secret).update(`${orderId}|pay_other`).digest('hex');
        expect(verifyPaymentSignature({ orderId, paymentId, signature: wrongSignature })).toBe(false);
    });

    it('rejects a signature computed with the wrong secret', () => {
        const wrongSecretSignature = crypto.createHmac('sha256', 'not-the-real-secret').update(`${orderId}|${paymentId}`).digest('hex');
        expect(verifyPaymentSignature({ orderId, paymentId, signature: wrongSecretSignature })).toBe(false);
    });

    it('rejects garbage input without throwing', () => {
        expect(verifyPaymentSignature({ orderId, paymentId, signature: 'not-hex-at-all' })).toBe(false);
        expect(verifyPaymentSignature({ orderId, paymentId, signature: undefined })).toBe(false);
    });
});

describe('timingSafeEqualStr', () => {
    it('returns true for identical strings', () => {
        expect(timingSafeEqualStr('abc123', 'abc123')).toBe(true);
    });

    it('returns false for different strings of the same length (does not throw)', () => {
        expect(timingSafeEqualStr('abc123', 'abc124')).toBe(false);
    });

    it('returns false for different-length strings instead of throwing', () => {
        // crypto.timingSafeEqual() throws on length mismatch — the wrapper
        // must guard against that itself, since an attacker fully controls
        // the length of the header/field being compared.
        expect(() => timingSafeEqualStr('short', 'a-much-longer-string')).not.toThrow();
        expect(timingSafeEqualStr('short', 'a-much-longer-string')).toBe(false);
    });

    it('treats null/undefined as empty strings rather than throwing', () => {
        expect(timingSafeEqualStr(undefined, undefined)).toBe(true);
        expect(timingSafeEqualStr(null, 'x')).toBe(false);
    });
});
