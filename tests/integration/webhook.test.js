/**
 * tests/integration/webhook.test.js
 *
 * The Razorpay webhook is the OTHER way an enrollment gets marked paid
 * (browser tab closed right after paying, slow network, etc). It must:
 *   - reject anything without a valid HMAC signature
 *   - be safe to replay (Razorpay retries on any non-2xx response)
 *   - do the exact same ledger/coupon writes as the browser path
 *   - fail closed (never silently "verify" anything) if misconfigured
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';
import { signWebhookBody } from '../helpers/razorpayTestUtils.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('../../src/services/invoiceService.js', () => ({
    generateInvoiceBuffer: vi.fn(() => Promise.resolve(Buffer.from('%PDF-fake'))),
}));

const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { handleRazorpayWebhook } = await import('../../src/controllers/webhookController.js');

const nodemailer = (await import('nodemailer')).default;
nodemailer.createTransport.mockReturnValue({ sendMail: vi.fn(() => Promise.resolve({})) });

function paymentCapturedEvent({ orderId, paymentId, amountPaise }) {
    return JSON.stringify({
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id: paymentId,
                    order_id: orderId,
                    amount: amountPaise,
                    created_at: Math.floor(Date.now() / 1000),
                },
            },
        },
    });
}

describe('Razorpay webhook (POST /api/webhooks/razorpay)', () => {
    let fake;
    const ORDER_ID = 'order_webhook_test';
    const PAYMENT_ID = 'pay_webhook_test';
    const AMOUNT_PAISE = 999900;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1',
                enrollment_id: 'FIT-2026-000111',
                razorpay_order_id: ORDER_ID,
                razorpay_payment_id: null,
                payment_status: 'pending',
                amount_paid: 9999,
                customer_email: 'webhook-customer@example.com',
                customer_name: 'Webhook Customer',
                coupon_code: null,
            }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('rejects a request with an invalid signature and makes no DB changes', async () => {
        const rawBody = paymentCapturedEvent({ orderId: ORDER_ID, paymentId: PAYMENT_ID, amountPaise: AMOUNT_PAISE });
        const req = createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': 'totally-wrong' } });
        const res = createMockRes();

        await handleRazorpayWebhook(req, res);

        expect(res.statusCode).toBe(400);
        expect(fake.tables.enrollments[0].payment_status).toBe('pending');
    });

    it('accepts a validly-signed payment.captured event and finalizes the enrollment', async () => {
        const rawBody = paymentCapturedEvent({ orderId: ORDER_ID, paymentId: PAYMENT_ID, amountPaise: AMOUNT_PAISE });
        const signature = signWebhookBody(rawBody);
        const req = createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': signature } });
        const res = createMockRes();

        await handleRazorpayWebhook(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.received).toBe(true);
        expect(fake.tables.enrollments[0].payment_status).toBe('paid');
        expect(fake.tables.enrollments[0].amount_paid).toBe(AMOUNT_PAISE / 100);

        await vi.waitFor(() => expect(fake.tables.enrollment_payments).toHaveLength(1));
        expect(fake.tables.enrollment_payments[0].reference).toBe(PAYMENT_ID);
    });

    it('is safe to replay (Razorpay retries webhooks) — second delivery is a no-op, not a double charge', async () => {
        const rawBody = paymentCapturedEvent({ orderId: ORDER_ID, paymentId: PAYMENT_ID, amountPaise: AMOUNT_PAISE });
        const signature = signWebhookBody(rawBody);

        await handleRazorpayWebhook(
            createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': signature } }),
            createMockRes()
        );
        await vi.waitFor(() => expect(fake.tables.enrollment_payments).toHaveLength(1));

        const secondRes = createMockRes();
        await handleRazorpayWebhook(
            createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': signature } }),
            secondRes
        );

        expect(secondRes.statusCode).toBe(200);
        expect(secondRes.body.alreadyProcessed).toBe(true);
        expect(fake.tables.enrollment_payments).toHaveLength(1); // not duplicated
    });

    it('ignores events other than payment.captured (e.g. payment.failed) without touching the DB', async () => {
        const rawBody = JSON.stringify({ event: 'payment.failed', payload: {} });
        const signature = signWebhookBody(rawBody);
        const res = createMockRes();

        await handleRazorpayWebhook(createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': signature } }), res);

        expect(res.statusCode).toBe(200);
        expect(fake.tables.enrollments[0].payment_status).toBe('pending');
    });

    it('fails closed — refuses to "verify" anything if RAZORPAY_WEBHOOK_SECRET is not configured', async () => {
        vi.resetModules();
        const previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        delete process.env.RAZORPAY_WEBHOOK_SECRET;

        try {
            const { handleRazorpayWebhook: handlerWithoutSecret } = await import('../../src/controllers/webhookController.js');
            const rawBody = paymentCapturedEvent({ orderId: ORDER_ID, paymentId: PAYMENT_ID, amountPaise: AMOUNT_PAISE });
            const res = createMockRes();

            await handlerWithoutSecret(
                createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': 'anything' } }),
                res
            );

            expect(res.statusCode).toBe(500);
            expect(res.body.error).toMatch(/not configured/i);
        } finally {
            process.env.RAZORPAY_WEBHOOK_SECRET = previousSecret;
            vi.resetModules();
        }
    });
});
