/**
 * POST /api/admin/enrollments/:id/recompute-status
 *
 * The safe undo for "accidentally clicked Pending/Failed/Refunded on a row
 * that was actually already paid" — 'paid' can no longer be hand-picked
 * from the Status dropdown (see updateEnrollmentStatus), so without this
 * there'd be no way back. Re-derives payment_status/amount_paid/balance_due
 * from the SUM of what's actually on the enrollment_payments ledger, which
 * a status-dropdown click never touches in either direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { updateEnrollmentStatus, recomputeEnrollmentStatus } = await import('../../src/controllers/adminDataController.js');

const ADMIN = { id: 'admin-1', username: 'test-admin' };

describe('POST /api/admin/enrollments/:id/recompute-status', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000444',
                payment_status: 'paid', total_amount: 3999, amount_paid: 3999, balance_due: 0,
                payment_plan_status: 'paid_off',
            }],
            enrollment_payments: [{
                id: 'pay-1', enrollment_id: 'enr-1', amount: 3999, paid_at: '2026-08-01T00:00:00.000Z',
            }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('recovers a row accidentally flipped to "pending" — the ledger still shows it fully paid', async () => {
        // The mistake: admin meant to view the row, clicked Pending instead.
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'pending' }, admin: ADMIN }), createMockRes());
        expect(fake.tables.enrollments[0].payment_status).toBe('pending');
        expect(fake.tables.enrollments[0].amount_paid).toBe(3999); // untouched by the click itself

        const res = createMockRes();
        await recomputeEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.enrollment.payment_status).toBe('paid');
        expect(res.body.enrollment.amount_paid).toBe(3999);
        expect(res.body.enrollment.balance_due).toBe(0);
    });

    it('recovers a row accidentally flipped to "failed" — which also zeroed amount_paid, but not the ledger', async () => {
        await updateEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, body: { status: 'failed' }, admin: ADMIN }), createMockRes());
        expect(fake.tables.enrollments[0].amount_paid).toBe(0); // zeroed by the failed transition
        expect(fake.tables.enrollment_payments[0].amount).toBe(3999); // ledger itself untouched

        const res = createMockRes();
        await recomputeEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.body.enrollment.payment_status).toBe('paid');
        expect(res.body.enrollment.amount_paid).toBe(3999); // restored from the ledger, not re-typed
        expect(res.body.enrollment.balance_due).toBe(0);
    });

    it('does NOT fabricate "paid" for a row that is genuinely pending with no payment ever recorded', async () => {
        fake.tables.enrollment_payments = []; // no ledger history at all
        fake.tables.enrollments[0].payment_status = 'pending';
        fake.tables.enrollments[0].amount_paid = 0;

        const res = createMockRes();
        await recomputeEnrollmentStatus(createMockReq({ params: { id: 'enr-1' }, admin: ADMIN }), res);

        expect(res.body.enrollment.payment_status).toBe('pending');
        expect(res.body.enrollment.amount_paid).toBe(0);
    });
});
