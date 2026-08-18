/**
 * tests/integration/duplicatePaymentRace.test.js
 *
 * The scenario this covers: a customer starts the website checkout, the
 * gateway looks like it timed out (browser never gets a captured payment),
 * so they send the money directly to the admin by UPI instead. The admin
 * records that manually against the still-pending website row. Then —
 * because the original Razorpay charge actually went through after all —
 * confirmPayment or the webhook later fires for the SAME order with a
 * genuinely captured payment.
 *
 * Before the fix, both confirmPayment and the webhook treated "row is
 * already payment_status='paid'" as proof the SAME payment had already been
 * processed, and silently no-op'd — so real money Razorpay actually
 * captured was never recorded anywhere and nobody was ever told about it.
 * The fix distinguishes "the same payment retried" (still a safe no-op)
 * from "a genuinely different payment landed on an already-paid row" (must
 * be recorded + flagged for manual review).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';
import { signOrderPayment, signWebhookBody, mockRazorpayFetch } from '../helpers/razorpayTestUtils.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('../../src/services/invoiceService.js', () => ({
    generateInvoiceBuffer: vi.fn(() => Promise.resolve(Buffer.from('%PDF-fake'))),
}));

const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { createOrder, confirmPayment } = await import('../../src/controllers/paymentController.js');
const { handleRazorpayWebhook } = await import('../../src/controllers/webhookController.js');
const { recordPayment } = await import('../../src/services/paymentLedgerService.js');

const nodemailer = (await import('nodemailer')).default;
nodemailer.createTransport.mockReturnValue({ sendMail: vi.fn(() => Promise.resolve({})) });

function seedContent() {
    return {
        coaching_types: [{ id: 'online', active: true, sort_order: 1, name: 'Online Coaching' }],
        pricing: [{ id: 'price-1', coaching_type_id: 'online', plan_type: 'individual', duration_months: '1', price: 199 }],
    };
}

const CHECKOUT_PAYLOAD = {
    coachingType: 'online', planType: 'individual', durationMonths: '1',
    customerName: 'om anand', customerEmail: 'om@example.com', customerPhone: '9661995076',
    programName: 'RECODE Online Coaching — Individual — 1 Month',
};

const RAZORPAY_ORDER = { id: 'order_timeout_test', amount: 19900, currency: 'INR', status: 'created' };
const RAZORPAY_PAYMENT = {
    id: 'pay_captured_late', order_id: RAZORPAY_ORDER.id, status: 'captured',
    amount: 19900, created_at: Math.floor(Date.now() / 1000),
};

describe('Website checkout timeout + manual payment, then the real gateway charge lands late', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase(seedContent());
        getSupabaseAdmin.mockReturnValue(fake.client);
        global.fetch = mockRazorpayFetch({ order: RAZORPAY_ORDER, payment: RAZORPAY_PAYMENT });
    });

    async function createPendingRowAndPayManually() {
        const createRes = createMockRes();
        await createOrder(createMockReq({ body: CHECKOUT_PAYLOAD }), createRes, (err) => { throw err; });
        const pendingRow = fake.tables.enrollments[0];
        expect(pendingRow.payment_status).toBe('pending');
        expect(pendingRow.plan_start_date).toBeUndefined(); // never set for a pending website row

        // Admin records the customer's direct UPI transfer against this row.
        const paid = await recordPayment({
            enrollmentId: pendingRow.id, amount: 199, method: 'upi', reference: 'UPI-manual-ref',
        });
        expect(paid.payment_status).toBe('paid');
        expect(paid.razorpay_payment_id).toBeFalsy(); // paid manually, no Razorpay payment on it
        return pendingRow;
    }

    it('confirmPayment: flags a genuinely different Razorpay payment landing on an already-paid row instead of silently dropping it', async () => {
        await createPendingRowAndPayManually();

        const signature = signOrderPayment(RAZORPAY_ORDER.id, RAZORPAY_PAYMENT.id);
        const confirmRes = createMockRes();
        await confirmPayment(
            createMockReq({ body: { razorpay_order_id: RAZORPAY_ORDER.id, razorpay_payment_id: RAZORPAY_PAYMENT.id, razorpay_signature: signature } }),
            confirmRes,
            (err) => { throw err; }
        );

        // Customer still sees success — their payment DID go through.
        expect(confirmRes.statusCode).toBe(200);
        expect(confirmRes.body.success).toBe(true);
        expect(confirmRes.body.alreadyProcessed).toBe(true);

        // But it's not a silent no-op: the real captured payment is now on
        // the ledger (alongside the manual one) so the money isn't invisible.
        await vi.waitFor(() => expect(fake.tables.enrollment_payments).toHaveLength(2));
        const refs = fake.tables.enrollment_payments.map((p) => p.reference);
        expect(refs).toContain('UPI-manual-ref');
        expect(refs).toContain(RAZORPAY_PAYMENT.id);

        // And it's flagged somewhere an admin looking at THIS enrollment
        // (any source) will actually see it.
        await vi.waitFor(() => expect(fake.tables.admin_notes).toHaveLength(1));
        expect(fake.tables.admin_notes[0].note).toMatch(/double payment/i);
        expect(fake.tables.admin_notes[0].note).toContain(RAZORPAY_PAYMENT.id);
    });

    it('webhook: same flagging behavior when the webhook (not the browser) is what delivers the late capture', async () => {
        await createPendingRowAndPayManually();

        const rawBody = JSON.stringify({
            event: 'payment.captured',
            payload: { payment: { entity: { id: RAZORPAY_PAYMENT.id, order_id: RAZORPAY_ORDER.id, amount: 19900, created_at: RAZORPAY_PAYMENT.created_at } } },
        });
        const signature = signWebhookBody(rawBody);
        const res = createMockRes();
        await handleRazorpayWebhook(createMockReq({ body: rawBody, headers: { 'x-razorpay-signature': signature } }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.alreadyProcessed).toBe(true);

        await vi.waitFor(() => expect(fake.tables.enrollment_payments).toHaveLength(2));
        await vi.waitFor(() => expect(fake.tables.admin_notes).toHaveLength(1));
        expect(fake.tables.admin_notes[0].note).toMatch(/double payment/i);
    });

    it('does NOT flag a true retry of the SAME already-recorded Razorpay payment', async () => {
        const createRes = createMockRes();
        await createOrder(createMockReq({ body: CHECKOUT_PAYLOAD }), createRes, (err) => { throw err; });

        const signature = signOrderPayment(RAZORPAY_ORDER.id, RAZORPAY_PAYMENT.id);
        const firstConfirm = createMockReq({ body: { razorpay_order_id: RAZORPAY_ORDER.id, razorpay_payment_id: RAZORPAY_PAYMENT.id, razorpay_signature: signature } });
        await confirmPayment(firstConfirm, createMockRes(), (err) => { throw err; });
        await vi.waitFor(() => expect(fake.tables.enrollment_payments).toHaveLength(1));

        // Retry (double-click / webhook racing in after the browser already won).
        const retryRes = createMockRes();
        await confirmPayment(firstConfirm, retryRes, (err) => { throw err; });

        expect(retryRes.body.alreadyProcessed).toBe(true);
        expect(fake.tables.enrollment_payments).toHaveLength(1); // still just one — no phantom flag
        expect(fake.tables.admin_notes ?? []).toHaveLength(0);
    });
});
