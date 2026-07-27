/**
 * Regression test: these three endpoints were removed because each had
 * zero real callers (verified against the frontend) and each was an abuse
 * vector while unauthenticated:
 *   - POST /api/coupons/redeem   — let anyone burn a coupon's usage cap
 *                                   without ever paying
 *   - POST /api/send-enrollment-emails — same "trust the client body"
 *                                   invoice-forgery issue as the old
 *                                   /api/invoice, plus no caller
 *   - POST /api/payment-receipt (public) — moved under admin auth instead
 *
 * These tests assert the removal stuck at the router-wiring level, so a
 * future edit can't accidentally re-expose them.
 */
import { describe, it, expect } from 'vitest';

describe('removed public endpoints stay removed', () => {
    it('couponController no longer exports a redeemCoupon handler', async () => {
        const couponController = await import('../../src/controllers/couponController.js');
        expect(couponController.redeemCoupon).toBeUndefined();
    });

    it('emailController no longer exports sendEnrollmentEmails', async () => {
        const emailController = await import('../../src/controllers/emailController.js');
        expect(emailController.sendEnrollmentEmails).toBeUndefined();
    });

    it('paymentController no longer exports a public downloadPaymentReceipt handler', async () => {
        const paymentController = await import('../../src/controllers/paymentController.js');
        expect(paymentController.downloadPaymentReceipt).toBeUndefined();
    });

    it('the public payment router does not wire up /coupons/redeem, /send-enrollment-emails, or /payment-receipt', async () => {
        const routerModule = await import('../../src/routes/payment.js');
        const router = routerModule.default;
        const paths = router.stack
            .filter((layer) => layer.route)
            .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));

        expect(paths).not.toContain('POST /coupons/redeem');
        expect(paths).not.toContain('POST /send-enrollment-emails');
        expect(paths).not.toContain('POST /payment-receipt');
        // The routes that should still be there:
        expect(paths).toContain('POST /create-order');
        expect(paths).toContain('POST /confirm-payment');
        expect(paths).toContain('POST /invoice');
        expect(paths).toContain('POST /coupons/validate');
    });

    it('the admin router exposes the authenticated invoice/receipt download routes instead', async () => {
        const routerModule = await import('../../src/routes/admin.js');
        const router = routerModule.default;
        const paths = router.stack
            .filter((layer) => layer.route)
            .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));

        expect(paths).toContain('GET /enrollments/:id/invoice');
        expect(paths).toContain('GET /enrollments/:id/payments/:paymentId/receipt');
    });
});
