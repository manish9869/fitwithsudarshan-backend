/**
 * recordPayment() is the single write path for every payment an admin
 * enters by hand (manual enrollment creation, Record Payment on an existing
 * row, balance-due follow-ups). Two accuracy guarantees it must hold:
 *
 *  1. A payment can't push amount_paid past total_amount (fat-finger /
 *     double-click / re-recording the same transfer twice) — this used to
 *     be entirely unchecked, so a typo'd extra zero silently inflated
 *     revenue and left balance_due wrong forever.
 *  2. Every accepted payment recomputes amount_paid/balance_due/
 *     payment_status from the ledger, so those three numbers can never
 *     drift apart from what was actually recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { recordPayment } = await import('../../src/services/paymentLedgerService.js');

describe('recordPayment() accuracy guards', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            enrollments: [{
                id: 'enr-1', enrollment_id: 'FIT-2026-000333',
                total_amount: 5000, amount_paid: 0, balance_due: 5000,
                payment_status: 'pending', payment_plan_status: 'pending',
            }],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('accepts a payment that exactly settles the balance and flips the row to paid', async () => {
        const updated = await recordPayment({ enrollmentId: 'enr-1', amount: 5000, method: 'upi' });

        expect(updated.amount_paid).toBe(5000);
        expect(updated.balance_due).toBe(0);
        expect(updated.payment_status).toBe('paid');
        expect(updated.payment_plan_status).toBe('paid_off');
    });

    it('accepts a partial payment and computes the correct remaining balance', async () => {
        const updated = await recordPayment({ enrollmentId: 'enr-1', amount: 2000, method: 'upi' });

        expect(updated.amount_paid).toBe(2000);
        expect(updated.balance_due).toBe(3000);
        expect(updated.payment_status).toBe('paid'); // amountPaid > 0
        expect(updated.payment_plan_status).toBe('partial');
    });

    it('rejects a payment that would exceed the outstanding balance', async () => {
        await expect(
            recordPayment({ enrollmentId: 'enr-1', amount: 5100, method: 'upi' })
        ).rejects.toThrow(/exceed the outstanding balance/i);

        // Nothing written — not the ledger, not the enrollment row.
        expect(fake.tables.enrollment_payments || []).toHaveLength(0);
        expect(fake.tables.enrollments[0].amount_paid).toBe(0);
    });

    it('rejects a second payment that would push the total past the balance, even though each one alone would fit', async () => {
        await recordPayment({ enrollmentId: 'enr-1', amount: 3000, method: 'upi' });

        await expect(
            recordPayment({ enrollmentId: 'enr-1', amount: 2500, method: 'upi' }) // only ₹2000 left
        ).rejects.toThrow(/exceed the outstanding balance/i);

        expect(fake.tables.enrollment_payments).toHaveLength(1); // second one never landed
        expect(fake.tables.enrollments[0].amount_paid).toBe(3000);
    });

    it('allows a payment within ₹1 rounding slack over the exact balance', async () => {
        const updated = await recordPayment({ enrollmentId: 'enr-1', amount: 5000.5, method: 'upi' });
        expect(updated.amount_paid).toBe(5000.5);
    });

    it('does not enforce the guard when total_amount is unknown (legacy rows)', async () => {
        fake.tables.enrollments[0].total_amount = null;
        const updated = await recordPayment({ enrollmentId: 'enr-1', amount: 999999, method: 'upi' });
        expect(updated.amount_paid).toBe(999999);
    });
});
