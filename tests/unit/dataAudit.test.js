/**
 * GET /api/admin/data-audit
 *
 * Independent, server-side re-derivation of every number the admin panel
 * shows elsewhere (revenue, lifecycle counts) plus row-level integrity
 * checks (ledger vs amount_paid, balance_due math, missing plan_start_date,
 * paid-with-zero-collected, duplicate customers). Read-only — this test
 * suite is really a spec for what counts as "wrong data" in this system.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { getDataAudit } = await import('../../src/controllers/adminDataController.js');

function daysAgoISO(days) {
    return new Date(Date.now() - days * 86400000).toISOString();
}
function daysFromNowISO(days) {
    return new Date(Date.now() + days * 86400000).toISOString();
}

describe('GET /api/admin/data-audit', () => {
    let fake;

    async function run() {
        const res = createMockRes();
        await getDataAudit(createMockReq({}), res);
        return res;
    }

    it('reports zero issues and matching revenue for entirely clean data', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000001', customer_name: 'Clean Client',
                customer_email: 'clean@example.com', payment_status: 'paid',
                total_amount: 1000, amount_paid: 1000, balance_due: 0,
                plan_start_date: daysAgoISO(10), duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-1', amount: 1000 }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.statusCode).toBe(200);
        expect(res.body.issues).toHaveLength(0);
        expect(res.body.duplicateGroups).toHaveLength(0);
        expect(res.body.revenue.fromEnrollmentRows).toBe(1000);
        expect(res.body.revenue.fromPaymentLedger).toBe(1000);
        expect(res.body.revenue.matches).toBe(true);
        expect(res.body.lifecycle.active).toBe(1);
    });

    it('flags a paid row with no plan_start_date (the "Active badge never appears" bug)', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000002', customer_name: 'Om Anand',
                payment_status: 'paid', total_amount: 199, amount_paid: 199, balance_due: 0,
                plan_start_date: null, duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-1', amount: 199 }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        const types = res.body.issues.map((i) => i.type);
        expect(types).toContain('missing_plan_start_date');
        expect(res.body.lifecycle.noPlan).toBe(1); // can't compute lifecycle without a start date
    });

    it('flags a paid row with ₹0 amount_paid (the status-dropdown bug)', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000003', customer_name: 'Mistake Client',
                payment_status: 'paid', total_amount: 500, amount_paid: 0, balance_due: 500,
                plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.issues.map((i) => i.type)).toContain('paid_with_zero_amount');
    });

    it('flags amount_paid not matching the ledger sum', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000004', customer_name: 'Drift Client',
                payment_status: 'paid', total_amount: 1000, amount_paid: 1000, balance_due: 0,
                plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-1', amount: 400 }], // ledger says only 400
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        const issue = res.body.issues.find((i) => i.type === 'ledger_mismatch');
        expect(issue).toBeDefined();
        expect(res.body.revenue.matches).toBe(false); // revenue reconciliation catches it too
    });

    it('does NOT flag a refunded row for the ledger still showing the original payment — that is expected', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000005', customer_name: 'Refunded Client',
                payment_status: 'refunded', total_amount: 1000, amount_paid: 0, balance_due: 1000,
                plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-1', amount: 1000 }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.issues.map((i) => i.type)).not.toContain('ledger_mismatch');
    });

    it('flags balance_due not matching total_amount minus amount_paid', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000006', customer_name: 'Balance Client',
                payment_status: 'paid', total_amount: 1000, amount_paid: 400, balance_due: 999, // should be 600
                plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-1', amount: 400 }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.issues.map((i) => i.type)).toContain('balance_mismatch');
    });

    it('groups duplicate customers sharing an email across two live enrollments', async () => {
        fake = createFakeSupabase({
            enrollments: [
                {
                    id: 'enr-1', enrollment_id: 'FIT-2026-000007', customer_name: 'Dup Client',
                    customer_email: 'dup@example.com', payment_status: 'pending',
                    total_amount: 500, amount_paid: 0, balance_due: 500, deleted_at: null,
                },
                {
                    id: 'enr-2', enrollment_id: 'FIT-2026-000008', customer_name: 'Dup Client',
                    customer_email: 'dup@example.com', payment_status: 'paid',
                    total_amount: 500, amount_paid: 500, balance_due: 0,
                    plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
                },
            ],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-2', amount: 500 }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.duplicateGroups).toHaveLength(1);
        expect(res.body.duplicateGroups[0].contact).toBe('dup@example.com');
        expect(res.body.duplicateGroups[0].enrollments).toHaveLength(2);
    });

    it('does NOT treat a renewed client (root + extension, same chain) as a duplicate customer', async () => {
        fake = createFakeSupabase({
            enrollments: [
                {
                    id: 'root-1', enrollment_id: 'FIT-2026-158385', customer_name: 'Vishwa',
                    customer_email: 'vishwa@example.com', payment_status: 'paid',
                    total_amount: 500, amount_paid: 500, balance_due: 0,
                    plan_start_date: daysAgoISO(90), duration_months: '3', deleted_at: null,
                },
                { // the extension — same chain, root_enrollment_id points back to root-1
                    id: 'ext-1', enrollment_id: 'FIT-2026-659310', customer_name: 'Vishwa',
                    customer_email: 'vishwa@example.com', payment_status: 'paid',
                    root_enrollment_id: 'root-1',
                    total_amount: 500, amount_paid: 500, balance_due: 0,
                    plan_start_date: daysAgoISO(5), duration_months: '3', deleted_at: null,
                },
            ],
            enrollment_payments: [
                { id: 'p1', enrollment_id: 'root-1', amount: 500 },
                { id: 'p2', enrollment_id: 'ext-1', amount: 500 },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.duplicateGroups).toHaveLength(0);
    });

    it('DOES flag two genuinely separate chains for the same contact (a real duplicate alongside a renewal)', async () => {
        fake = createFakeSupabase({
            enrollments: [
                {
                    id: 'root-1', enrollment_id: 'FIT-2026-100001', customer_name: 'Real Dup',
                    customer_email: 'realdup@example.com', payment_status: 'paid',
                    total_amount: 500, amount_paid: 500, balance_due: 0,
                    plan_start_date: daysAgoISO(90), duration_months: '3', deleted_at: null,
                },
                { // legitimate renewal of root-1 — same chain, must not count toward "separate chains"
                    id: 'ext-1', enrollment_id: 'FIT-2026-100002', customer_name: 'Real Dup',
                    customer_email: 'realdup@example.com', payment_status: 'paid',
                    root_enrollment_id: 'root-1',
                    total_amount: 500, amount_paid: 500, balance_due: 0,
                    plan_start_date: daysAgoISO(5), duration_months: '3', deleted_at: null,
                },
                { // a totally separate, independently-created enrollment — different chain entirely
                    id: 'other-1', enrollment_id: 'FIT-2026-100003', customer_name: 'Real Dup',
                    customer_email: 'realdup@example.com', payment_status: 'pending',
                    total_amount: 500, amount_paid: 0, balance_due: 500, deleted_at: null,
                },
            ],
            enrollment_payments: [
                { id: 'p1', enrollment_id: 'root-1', amount: 500 },
                { id: 'p2', enrollment_id: 'ext-1', amount: 500 },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.duplicateGroups).toHaveLength(1);
        // All 3 rows surface (the renewal chain plus the separate one) so the
        // admin can see the full picture, not just the two that "clashed."
        expect(res.body.duplicateGroups[0].enrollments.map((e) => e.enrollmentId).sort()).toEqual([
            'FIT-2026-100001', 'FIT-2026-100002', 'FIT-2026-100003',
        ]);
    });

    it('does not treat failed/refunded rows sharing an email as duplicates', async () => {
        fake = createFakeSupabase({
            enrollments: [
                {
                    id: 'enr-1', enrollment_id: 'FIT-2026-000009', customer_name: 'Old Attempt',
                    customer_email: 'retry@example.com', payment_status: 'failed',
                    total_amount: 500, amount_paid: 0, balance_due: 500, deleted_at: null,
                },
                {
                    id: 'enr-2', enrollment_id: 'FIT-2026-000010', customer_name: 'Old Attempt',
                    customer_email: 'retry@example.com', payment_status: 'paid',
                    total_amount: 500, amount_paid: 500, balance_due: 0,
                    plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
                },
            ],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-2', amount: 500 }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.duplicateGroups).toHaveLength(0);
    });

    it('computes lifecycle counts across active, expiring soon, expired, renewed, and no-plan buckets', async () => {
        fake = createFakeSupabase({
            enrollments: [
                { // active, plenty of time left
                    id: 'e1', enrollment_id: 'FIT-1', customer_email: 'a@x.com', payment_status: 'paid',
                    total_amount: 100, amount_paid: 100, balance_due: 0,
                    plan_start_date: daysAgoISO(5), duration_months: '3', deleted_at: null,
                },
                { // expiring within 7 days
                    id: 'e2', enrollment_id: 'FIT-2', customer_email: 'b@x.com', payment_status: 'paid',
                    total_amount: 100, amount_paid: 100, balance_due: 0,
                    plan_start_date: daysAgoISO(28), duration_months: '1', deleted_at: null,
                },
                { // expired
                    id: 'e3', enrollment_id: 'FIT-3', customer_email: 'c@x.com', payment_status: 'paid',
                    total_amount: 100, amount_paid: 100, balance_due: 0,
                    plan_start_date: daysAgoISO(40), duration_months: '1', deleted_at: null,
                },
                { // renewed — root + extension, extension is current
                    id: 'e4', enrollment_id: 'FIT-4', customer_email: 'd@x.com', payment_status: 'paid',
                    total_amount: 100, amount_paid: 100, balance_due: 0,
                    plan_start_date: daysAgoISO(60), duration_months: '1', deleted_at: null,
                },
                {
                    id: 'e5', enrollment_id: 'FIT-5', customer_email: 'd@x.com', payment_status: 'paid',
                    root_enrollment_id: 'e4', total_amount: 100, amount_paid: 100, balance_due: 0,
                    plan_start_date: daysAgoISO(5), duration_months: '3', deleted_at: null,
                },
                { // no plan at all — still pending
                    id: 'e6', enrollment_id: 'FIT-6', customer_email: 'f@x.com', payment_status: 'pending',
                    total_amount: 100, amount_paid: 0, balance_due: 100, deleted_at: null,
                },
            ],
            enrollment_payments: [
                { id: 'p1', enrollment_id: 'e1', amount: 100 },
                { id: 'p2', enrollment_id: 'e2', amount: 100 },
                { id: 'p3', enrollment_id: 'e3', amount: 100 },
                { id: 'p4', enrollment_id: 'e4', amount: 100 },
                { id: 'p5', enrollment_id: 'e5', amount: 100 },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.lifecycle).toEqual({
            active: 3, // e1, e2 (expiring but still active), e4/e5's chain
            expiringSoon: 1, // e2
            expired: 1, // e3
            renewed: 1, // d@x.com's chain
            noPlan: 1, // e6
        });
    });

    it('never lets amount comparisons trip on floating-point rounding noise', async () => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000011', customer_name: 'Rounding Client',
                payment_status: 'paid', total_amount: 199.995, amount_paid: 199.995, balance_due: 0,
                plan_start_date: daysAgoISO(1), duration_months: '1', deleted_at: null,
            }],
            enrollment_payments: [{ id: 'p1', enrollment_id: 'enr-1', amount: 199.99 }], // 0.005 off
        });
        getSupabaseAdmin.mockReturnValue(fake.client);

        const res = await run();
        expect(res.body.issues.map((i) => i.type)).not.toContain('ledger_mismatch');
    });
});
