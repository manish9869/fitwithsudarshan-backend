/**
 * Regression test for the "Active badge never appears" gap: a website
 * checkout whose gateway timed out gets a pending row with no
 * plan_start_date (that column is only ever set by confirmPayment/the
 * webhook). If the admin later records the customer's direct UPI transfer
 * by hand, payment_status flips to 'paid' but plan_start_date stays null
 * forever — nothing else in the app ever writes it after creation, so the
 * Active/Expired badge silently never renders. This endpoint is the only
 * way to backfill it, and it must work regardless of enrollment source
 * (unlike updateManualEnrollment, which only ever reaches source='manual' rows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { updatePlanStartDate } = await import('../../src/controllers/adminDataController.js');

const ADMIN = { id: 'admin-1', username: 'test-admin' };

describe('PATCH /api/admin/enrollments/:id/plan-start-date', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000222', source: 'website',
                payment_status: 'paid', duration_months: '1', plan_start_date: null,
            }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('backfills plan_start_date on a website-sourced enrollment', async () => {
        const res = createMockRes();
        await updatePlanStartDate(
            createMockReq({ params: { id: 'enr-1' }, body: { planStartDate: '2026-08-11T18:52:00.000Z' }, admin: ADMIN }),
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.enrollment.plan_start_date).toBe('2026-08-11T18:52:00.000Z');
        expect(fake.tables.enrollments[0].plan_start_date).toBe('2026-08-11T18:52:00.000Z');
    });

    it('rejects a missing/invalid date without touching the row', async () => {
        const res = createMockRes();
        await updatePlanStartDate(createMockReq({ params: { id: 'enr-1' }, body: {}, admin: ADMIN }), res);

        expect(res.statusCode).toBe(400);
        expect(fake.tables.enrollments[0].plan_start_date).toBe(null);

        const res2 = createMockRes();
        await updatePlanStartDate(createMockReq({ params: { id: 'enr-1' }, body: { planStartDate: 'not-a-date' }, admin: ADMIN }), res2);
        expect(res2.statusCode).toBe(400);
    });

    it('404s for a non-existent enrollment', async () => {
        const res = createMockRes();
        await updatePlanStartDate(
            createMockReq({ params: { id: 'does-not-exist' }, body: { planStartDate: '2026-01-01T00:00:00.000Z' }, admin: ADMIN }),
            res
        );
        expect(res.statusCode).toBe(404);
    });
});
