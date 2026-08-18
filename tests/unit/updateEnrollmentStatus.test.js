/**
 * Regression test for the revenue-mismatch bug: marking an enrollment
 * failed/refunded used to only flip payment_status, leaving amount_paid
 * frozen at its old value — which every revenue total that didn't
 * explicitly filter to payment_status='paid' kept counting forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { updateEnrollmentStatus } = await import('../../src/controllers/adminDataController.js');

const ADMIN = { id: 'admin-1', username: 'test-admin' };

describe('PATCH /api/admin/enrollments/:id/status', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000999', payment_status: 'paid',
                amount_paid: 3999, total_amount: 3999, balance_due: 0, payment_plan_status: 'full',
            }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('zeroes amount_paid and restores the balance when marking a paid enrollment "failed"', async () => {
        const res = createMockRes();
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'failed' }, admin: ADMIN }), res);

        expect(res.body.enrollment.payment_status).toBe('failed');
        expect(res.body.enrollment.amount_paid).toBe(0);
        expect(res.body.enrollment.balance_due).toBe(3999);
        expect(fake.tables.enrollments[0].amount_paid).toBe(0);
    });

    it('does the same for "refunded"', async () => {
        const res = createMockRes();
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'refunded' }, admin: ADMIN }), res);

        expect(res.body.enrollment.amount_paid).toBe(0);
        expect(res.body.enrollment.balance_due).toBe(3999);
    });

    it('leaves amount_paid untouched when setting status to "pending"', async () => {
        const res = createMockRes();
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'pending' }, admin: ADMIN }), res);

        expect(res.body.enrollment.payment_status).toBe('pending');
        expect(res.body.enrollment.amount_paid).toBe(3999); // unchanged
    });

    it('rejects an invalid status without touching the row', async () => {
        const res = createMockRes();
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'bogus' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(400);
        expect(fake.tables.enrollments[0].amount_paid).toBe(3999);
    });

    // Regression test for the "Paid with ₹0 collected" bug: this endpoint
    // used to accept status='paid' and only flip the label, leaving
    // amount_paid/balance_due exactly as they were — so an admin could mark
    // a never-actually-paid row "Paid" from the Status dropdown, and it
    // would simultaneously still count as outstanding balance. 'paid' must
    // now only ever be reachable by actually recording a payment.
    it('rejects "paid" — it can only be set by recording an actual payment, not by hand', async () => {
        const res = createMockRes();
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'paid' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/paid/i);
        expect(fake.tables.enrollments[0].payment_status).toBe('paid'); // untouched, was already paid
    });
});
