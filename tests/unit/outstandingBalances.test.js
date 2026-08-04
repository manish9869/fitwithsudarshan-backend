/**
 * Regression test for the "pending/failed checkout shows up in Balance Due"
 * bug: a website checkout that was never actually completed — abandoned
 * (pending), the payment failing at Razorpay (failed), or later reversed
 * (refunded) — must not appear as an outstanding balance to chase down.
 * None of those are a payment plan; they're an attempt that didn't result
 * in a real, ongoing enrollment. A manually-created enrollment in ANY of
 * those states IS a deliberate entry an admin wants to see, and a website
 * enrollment that's genuinely mid-installment (payment_status stays 'paid'
 * even with balance_due > 0) must still show up too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { listOutstandingBalances } = await import('../../src/services/paymentLedgerService.js');

describe('listOutstandingBalances', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [
                {
                    id: 'website-pending', enrollment_id: 'FIT-2026-000001', source: 'website',
                    payment_status: 'pending', balance_due: 15000, deleted_at: null,
                },
                {
                    id: 'website-failed', enrollment_id: 'FIT-2026-000005', source: 'website',
                    payment_status: 'failed', balance_due: 3999, deleted_at: null,
                },
                {
                    id: 'website-refunded', enrollment_id: 'FIT-2026-000006', source: 'website',
                    payment_status: 'refunded', balance_due: 6299, deleted_at: null,
                },
                {
                    id: 'manual-unpaid', enrollment_id: 'FIT-2026-000002', source: 'manual',
                    payment_status: 'pending', balance_due: 20000, deleted_at: null,
                },
                {
                    id: 'manual-partial', enrollment_id: 'FIT-2026-000003', source: 'manual',
                    payment_status: 'paid', payment_plan_status: 'partial', balance_due: 5000, deleted_at: null,
                },
                {
                    id: 'website-partial', enrollment_id: 'FIT-2026-000007', source: 'website',
                    payment_status: 'paid', payment_plan_status: 'partial', balance_due: 2800, deleted_at: null,
                },
                {
                    id: 'website-paid-off', enrollment_id: 'FIT-2026-000004', source: 'website',
                    payment_status: 'paid', balance_due: 0, deleted_at: null,
                },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('excludes a never-completed website checkout (pending)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-pending')).toBeUndefined();
    });

    it('excludes a website checkout whose payment failed', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-failed')).toBeUndefined();
    });

    it('excludes a refunded website enrollment', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-refunded')).toBeUndefined();
    });

    it('still includes a manual enrollment sitting at $0 paid (a real, deliberate entry)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'manual-unpaid')).toBeDefined();
    });

    it('still includes a genuine partial payment awaiting the remainder (manual)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'manual-partial')).toBeDefined();
    });

    it('still includes a genuine partial payment on a website enrollment (payment_status stays paid)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-partial')).toBeDefined();
    });

    it('never includes a fully-paid enrollment (balance_due = 0 is filtered out regardless)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-paid-off')).toBeUndefined();
    });
});
