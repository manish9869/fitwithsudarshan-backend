/**
 * POST /api/admin/enrollments/:id/refund
 *
 * The only manual override of payment_status left in the admin panel —
 * everything else (paid/pending) is derived automatically from Record
 * Payment or the website checkout (Razorpay confirm/webhook). This replaces
 * the old general Pending/Failed/Refunded status dropdown entirely: none of
 * those besides refunding had any legitimate manual use once paid/pending
 * are fully system-derived, and refunding can never be automatic since
 * nothing else in the app ever learns "the admin already sent this money
 * back outside the system."
 *
 * The frontend gates this behind a confirm/cancel step (see
 * AdminEnrollments.jsx's DetailDrawer) — Cancel is a pure no-op that never
 * calls this endpoint at all, so there's nothing to assert server-side for
 * that path; what matters here is that Confirm behaves correctly and that
 * every invalid attempt is rejected without mutating anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { refundEnrollment } = await import('../../src/controllers/adminDataController.js');

const ADMIN = { id: 'admin-1', username: 'test-admin' };

describe('POST /api/admin/enrollments/:id/refund', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000555',
                payment_status: 'paid', total_amount: 3999, amount_paid: 3999, balance_due: 0,
                payment_plan_status: 'paid_off',
            }],
            enrollment_payments: [{
                id: 'pay-1', enrollment_id: 'enr-1', amount: 3999, paid_at: '2026-08-01T00:00:00.000Z',
            }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('marks a paid enrollment refunded — zeroes amount_paid, restores the full balance', async () => {
        const res = createMockRes();
        await refundEnrollment(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.enrollment.payment_status).toBe('refunded');
        expect(res.body.enrollment.amount_paid).toBe(0);
        expect(res.body.enrollment.balance_due).toBe(3999);
        expect(res.body.enrollment.payment_plan_status).toBe('pending');
    });

    it('leaves the payment ledger completely untouched — it stays the historical record of what was collected', async () => {
        await refundEnrollment(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), createMockRes());

        expect(fake.tables.enrollment_payments).toHaveLength(1);
        expect(fake.tables.enrollment_payments[0].amount).toBe(3999);
    });

    it('rejects refunding a pending enrollment (nothing was ever collected to refund)', async () => {
        fake.tables.enrollments[0].payment_status = 'pending';
        const res = createMockRes();
        await refundEnrollment(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/only a paid enrollment/i);
        expect(fake.tables.enrollments[0].payment_status).toBe('pending'); // untouched
    });

    it('rejects refunding an already-refunded enrollment — no double-zeroing, no confusing re-trigger', async () => {
        fake.tables.enrollments[0].payment_status = 'refunded';
        fake.tables.enrollments[0].amount_paid = 0;
        fake.tables.enrollments[0].balance_due = 3999;

        const res = createMockRes();
        await refundEnrollment(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/only a paid enrollment/i);
    });

    it('rejects refunding a failed enrollment', async () => {
        fake.tables.enrollments[0].payment_status = 'failed';
        const res = createMockRes();
        await refundEnrollment(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('failed');
    });

    it('404s for a non-existent enrollment without touching anything', async () => {
        const res = createMockRes();
        await refundEnrollment(createMockReq({ params: { id: 'does-not-exist' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(404);
        expect(fake.tables.enrollments[0].payment_status).toBe('paid'); // original row unaffected
    });

    it('falls back to amount_paid as the refund total when total_amount is unset (legacy rows)', async () => {
        fake.tables.enrollments[0].total_amount = null;
        fake.tables.enrollments[0].amount_paid = 2500;

        const res = createMockRes();
        await refundEnrollment(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.body.enrollment.balance_due).toBe(2500);
    });
});
