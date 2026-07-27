/**
 * tests/integration/fullEnrollmentFlow.test.js
 *
 * Walks through the exact journey a real website visitor takes:
 *   1. Selects a plan + fills their details on the checkout page
 *   2. Clicks Pay → POST /api/create-order (server resolves the real price)
 *   3. Completes a (mocked) Razorpay test payment
 *   4. The success handler calls POST /api/confirm-payment
 *   5. Coach + customer confirmation emails go out
 *   6. Customer downloads their invoice from the success page
 *
 * Only the true I/O boundaries are mocked: the Supabase client (via an
 * in-memory fake DB), the Razorpay HTTP API (global fetch), the PDF
 * generator (real headless Chrome would be far too slow/heavy for a unit
 * test), and the email transporter. Every application function in between —
 * price resolution, coupon math, signature verification, the pending→paid
 * state transition, the ledger insert, the email templates — runs for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';
import { signOrderPayment, mockRazorpayFetch } from '../helpers/razorpayTestUtils.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('../../src/services/invoiceService.js', () => ({
    generateInvoiceBuffer: vi.fn(() => Promise.resolve(Buffer.from('%PDF-fake-invoice'))),
}));

const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { createOrder, confirmPayment, downloadInvoice } =
    await import('../../src/controllers/paymentController.js');

const nodemailer = (await import('nodemailer')).default;
const sendMailMock = vi.fn(() => Promise.resolve({ messageId: 'test-message-id' }));
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

function seedContent() {
    return {
        coaching_types: [{ id: 'online', active: true, sort_order: 1, name: 'Online Coaching' }],
        pricing: [
            { id: 'price-1', coaching_type_id: 'online', plan_type: 'individual', duration_months: '3', price: 15000 },
        ],
        coupons: [{
            id: 'coupon-1', code: 'WELCOME10', active: true, type: 'PERCENT', percent: 10,
            used_count: 0, max_uses: 100,
            applicable_coaching_types: null, applicable_plan_types: null, applicable_durations: null,
            starts_at: null, expires_at: null, label: 'Welcome10', description: '10% off',
        }],
    };
}

const CHECKOUT_PAYLOAD = {
    coachingType: 'online',
    planType: 'individual',
    durationMonths: '3',
    couponCode: 'WELCOME10',
    customerName: 'jane doe',
    customerEmail: 'jane@example.com',
    customerPhone: '9876543210',
    programName: 'RECODE Online Coaching — Individual — 3 Months',
    age: '29',
    city: 'Mumbai',
    weight: '70',
    goals: ['fat_loss'],
};

// 15000 - 10% = 13500
const EXPECTED_AMOUNT_RUPEES = 13500;
const EXPECTED_AMOUNT_PAISE = EXPECTED_AMOUNT_RUPEES * 100;

const RAZORPAY_ORDER = { id: 'order_test_abc123', amount: EXPECTED_AMOUNT_PAISE, currency: 'INR', status: 'created' };
const RAZORPAY_PAYMENT = {
    id: 'pay_test_xyz789',
    order_id: RAZORPAY_ORDER.id,
    status: 'captured',
    amount: EXPECTED_AMOUNT_PAISE,
    created_at: Math.floor(Date.now() / 1000),
};

describe('Full website enrollment journey', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase(seedContent());
        getSupabaseAdmin.mockReturnValue(fake.client);
        global.fetch = mockRazorpayFetch({ order: RAZORPAY_ORDER, payment: RAZORPAY_PAYMENT });
        sendMailMock.mockClear();
    });

    it('takes a customer from plan selection through payment to a confirmed, emailed, invoiceable enrollment', async () => {
        // ── 1. Customer picks a plan, fills the form, clicks "Pay" ──────────
        const createReq = createMockReq({ body: { ...CHECKOUT_PAYLOAD } });
        const createRes = createMockRes();

        await createOrder(createReq, createRes, (err) => { throw err; });

        expect(createRes.statusCode).toBe(201);
        expect(createRes.body.order_id).toBe(RAZORPAY_ORDER.id);
        expect(createRes.body.couponApplied).toEqual({ code: 'WELCOME10', savings: 1500 });
        const { enrollmentId } = createRes.body;
        expect(enrollmentId).toMatch(/^FIT-\d{4}-\d{6}$/);

        // ── Price-tampering check: the amount actually sent to Razorpay must
        //    be the server-computed discounted price, in paise, regardless of
        //    anything the client might claim. ─────────────────────────────
        const orderCreateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/v1/orders'));
        expect(orderCreateCall).toBeDefined();
        const sentBody = JSON.parse(orderCreateCall[1].body);
        expect(sentBody.amount).toBe(EXPECTED_AMOUNT_PAISE);

        // ── A pending row now exists, tracking the checkout before payment ──
        expect(fake.tables.enrollments).toHaveLength(1);
        const pendingRow = fake.tables.enrollments[0];
        expect(pendingRow.payment_status).toBe('pending');
        expect(pendingRow.razorpay_order_id).toBe(RAZORPAY_ORDER.id);
        // amount_paid must be 0 until a payment actually lands — it used to
        // be pre-filled with the expected price, which made the admin
        // panel's "Amount Paid" / balance-due / fully-paid displays treat a
        // never-completed checkout as already fully paid. The expected
        // price belongs in total_amount/balance_due instead.
        expect(pendingRow.amount_paid).toBe(0);
        expect(pendingRow.total_amount).toBe(EXPECTED_AMOUNT_RUPEES);
        expect(pendingRow.balance_due).toBe(EXPECTED_AMOUNT_RUPEES);
        expect(pendingRow.coupon_code).toBe('WELCOME10');
        expect(pendingRow.customer_name).toBe('Jane Doe'); // title-cased

        // ── 2. Customer completes a test payment in the Razorpay widget;
        //    the browser calls back with order/payment ids + signature ────
        const signature = signOrderPayment(RAZORPAY_ORDER.id, RAZORPAY_PAYMENT.id);
        const confirmReq = createMockReq({
            body: {
                razorpay_order_id: RAZORPAY_ORDER.id,
                razorpay_payment_id: RAZORPAY_PAYMENT.id,
                razorpay_signature: signature,
            },
        });
        const confirmRes = createMockRes();

        await confirmPayment(confirmReq, confirmRes, (err) => { throw err; });

        expect(confirmRes.statusCode).toBe(201);
        expect(confirmRes.body.success).toBe(true);
        const paidEnrollment = confirmRes.body.enrollment;
        expect(paidEnrollment.payment_status).toBe('paid');
        expect(paidEnrollment.amount_paid).toBe(EXPECTED_AMOUNT_RUPEES);
        expect(paidEnrollment.razorpay_payment_id).toBe(RAZORPAY_PAYMENT.id);

        // ── Ledger + coupon usage — both fire-and-forget from confirmPayment
        //    (not awaited by the request handler, so it can respond fast).
        //    vi.waitFor polls instead of guessing a fixed number of
        //    microtask ticks. ─────────────────────────────────────────────
        await vi.waitFor(() => {
            expect(fake.tables.enrollment_payments).toHaveLength(1);
            expect(fake.tables.coupons[0].used_count).toBe(1);
        });
        expect(fake.tables.enrollment_payments[0]).toMatchObject({
            amount: EXPECTED_AMOUNT_RUPEES,
            method: 'razorpay',
            reference: RAZORPAY_PAYMENT.id,
        });

        // ── 3. Confirmation emails — also fire-and-forget (waitUntil) from
        //    the same confirmPayment call, using the exact same function
        //    the webhook path uses. ──────────────────────────────────────
        await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(2));

        const coachCall = sendMailMock.mock.calls[0][0];
        expect(coachCall.to).toBe(process.env.COACH_EMAIL);
        expect(coachCall.subject).toContain(enrollmentId);

        const customerCall = sendMailMock.mock.calls[1][0];
        expect(customerCall.to).toBe('jane@example.com');
        expect(customerCall.subject.toLowerCase()).toContain('enrolled');
        expect(customerCall.attachments).toHaveLength(1);
        expect(customerCall.attachments[0].filename).toBe(`RECODE-Invoice-${enrollmentId}.pdf`);

        // ── 4. Customer downloads their invoice from the success page ──────
        const invoiceReq = createMockReq({
            body: { enrollmentId, razorpayPaymentId: RAZORPAY_PAYMENT.id },
        });
        const invoiceRes = createMockRes();

        await downloadInvoice(invoiceReq, invoiceRes, (err) => { throw err; });

        expect(invoiceRes.headers['Content-Type']).toBe('application/pdf');
        expect(invoiceRes.send).toHaveBeenCalledWith(Buffer.from('%PDF-fake-invoice'));

        // ── 5. A retried/duplicated confirm-payment call (double-click, or
        //    the webhook racing in after the browser already won) must be a
        //    safe no-op — not a second charge record. ──────────────────────
        const retryRes = createMockRes();
        await confirmPayment(confirmReq, retryRes, (err) => { throw err; });

        expect(retryRes.body.alreadyProcessed).toBe(true);
        expect(fake.tables.enrollment_payments).toHaveLength(1); // still just one
        expect(fake.tables.coupons[0].used_count).toBe(1); // not incremented twice
    });

    it('rejects a would-be invoice-forgery attempt (right enrollment id, wrong/guessed payment id)', async () => {
        const createReq = createMockReq({ body: { ...CHECKOUT_PAYLOAD, couponCode: undefined } });
        const createRes = createMockRes();
        await createOrder(createReq, createRes, (err) => { throw err; });
        const { enrollmentId } = createRes.body;

        const signature = signOrderPayment(RAZORPAY_ORDER.id, RAZORPAY_PAYMENT.id);
        const confirmRes = createMockRes();
        await confirmPayment(
            createMockReq({ body: { razorpay_order_id: RAZORPAY_ORDER.id, razorpay_payment_id: RAZORPAY_PAYMENT.id, razorpay_signature: signature } }),
            confirmRes,
            (err) => { throw err; }
        );
        expect(confirmRes.statusCode).toBe(201);

        const forgedRes = createMockRes();
        await downloadInvoice(
            createMockReq({ body: { enrollmentId, razorpayPaymentId: 'pay_guessed_wrong_id' } }),
            forgedRes,
            (err) => { throw err; }
        );

        expect(forgedRes.statusCode).toBe(404);
        expect(forgedRes.send).not.toHaveBeenCalled();
    });

    it('rejects a payment-completion attempt with a forged/mismatched signature', async () => {
        const createReq = createMockReq({ body: { ...CHECKOUT_PAYLOAD, couponCode: undefined } });
        const createRes = createMockRes();
        await createOrder(createReq, createRes, (err) => { throw err; });

        const badRes = createMockRes();
        await confirmPayment(
            createMockReq({
                body: {
                    razorpay_order_id: RAZORPAY_ORDER.id,
                    razorpay_payment_id: RAZORPAY_PAYMENT.id,
                    razorpay_signature: 'not-a-real-signature',
                },
            }),
            badRes,
            (err) => { throw err; }
        );

        expect(badRes.statusCode).toBe(400);
        expect(badRes.body.success).toBe(false);
        expect(fake.tables.enrollments[0].payment_status).toBe('pending'); // untouched
    });

    it('cannot be tricked into charging a different amount than the server resolved, even if the client sends its own `amount`', async () => {
        const tamperedReq = createMockReq({
            body: { ...CHECKOUT_PAYLOAD, couponCode: undefined, amount: 1 }, // attacker-supplied field
        });
        const res = createMockRes();
        await createOrder(tamperedReq, res, (err) => { throw err; });

        const orderCreateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/v1/orders'));
        const sentBody = JSON.parse(orderCreateCall[1].body);
        expect(sentBody.amount).toBe(15000 * 100); // full server price, coupon-free — never `1`
    });
});
