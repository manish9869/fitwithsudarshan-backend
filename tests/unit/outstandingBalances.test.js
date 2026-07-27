/**
 * Regression test for the "pending checkout shows as fully paid / clutters
 * balance-due follow-ups" bug: a website checkout that was started but
 * never completed must not appear as an outstanding balance to chase down
 * (it's an abandoned cart, not a payment plan) — but a manually-created
 * enrollment sitting at $0 paid IS a deliberate entry an admin wants to see.
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
                    id: 'manual-unpaid', enrollment_id: 'FIT-2026-000002', source: 'manual',
                    payment_status: 'pending', balance_due: 20000, deleted_at: null,
                },
                {
                    id: 'manual-partial', enrollment_id: 'FIT-2026-000003', source: 'manual',
                    payment_status: 'paid', payment_plan_status: 'partial', balance_due: 5000, deleted_at: null,
                },
                {
                    id: 'website-paid-off', enrollment_id: 'FIT-2026-000004', source: 'website',
                    payment_status: 'paid', balance_due: 0, deleted_at: null,
                },
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('excludes a never-completed website checkout', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-pending')).toBeUndefined();
    });

    it('still includes a manual enrollment sitting at $0 paid (a real, deliberate entry)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'manual-unpaid')).toBeDefined();
    });

    it('still includes a genuine partial payment awaiting the remainder', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'manual-partial')).toBeDefined();
    });

    it('never includes a fully-paid enrollment (balance_due = 0 is filtered out regardless)', async () => {
        const rows = await listOutstandingBalances();
        expect(rows.find((r) => r.id === 'website-paid-off')).toBeUndefined();
    });
});
