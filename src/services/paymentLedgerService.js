/**
 * src/services/paymentLedgerService.js
 *
 * Single source of truth for money received against an enrollment, no
 * matter the channel (website Razorpay, Razorpay payment link, UPI, bank
 * transfer, cash). enrollments.amount_paid / balance_due are ALWAYS
 * recomputed from this ledger — never hand-edited — so revenue reporting
 * can't drift out of sync with reality.
 */
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

export async function recordPayment({ enrollmentId, amount, method = 'other', reference, note, recordedBy, paidAt }) {
    const supabase = getSupabaseAdmin();
    const amt = Number(amount);
    if (!enrollmentId || !amt || amt <= 0) {
        throw new Error('enrollmentId and a positive amount are required.');
    }

    const { data: enrollment, error: fetchErr } = await supabase
        .from('enrollments')
        .select('id')
        .eq('id', enrollmentId)
        .single();
    if (fetchErr || !enrollment) throw new Error('Enrollment not found.');

    const { error: insertErr } = await supabase.from('enrollment_payments').insert([{
        enrollment_id: enrollmentId,
        amount: amt,
        method,
        reference: reference || null,
        note: note || null,
        recorded_by: recordedBy || null,
        paid_at: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
    }]);
    if (insertErr) throw new Error(`Failed to record payment: ${insertErr.message}`);

    return recomputeEnrollmentTotals(enrollmentId);
}

export async function recomputeEnrollmentTotals(enrollmentId) {
    const supabase = getSupabaseAdmin();

    const { data: payments, error: payErr } = await supabase
        .from('enrollment_payments')
        .select('amount')
        .eq('enrollment_id', enrollmentId);
    if (payErr) throw new Error(payErr.message);

    const amountPaid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);

    const { data: enrollment, error: fetchErr } = await supabase
        .from('enrollments')
        .select('total_amount, amount_paid')
        .eq('id', enrollmentId)
        .single();
    if (fetchErr || !enrollment) throw new Error('Enrollment not found.');

    const totalAmount = Number(enrollment.total_amount || enrollment.amount_paid || amountPaid);
    const balanceDue = Math.max(0, totalAmount - amountPaid);
    const planStatus = amountPaid <= 0 ? 'pending' : (balanceDue > 0 ? 'partial' : 'paid_off');

    const update = {
        amount_paid: amountPaid,
        total_amount: totalAmount,
        balance_due: balanceDue,
        payment_plan_status: planStatus,
        payment_status: amountPaid > 0 ? 'paid' : 'pending',
        next_payment_reminder_at: balanceDue > 0
            ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
            : null,
    };

    const { data, error } = await supabase
        .from('enrollments')
        .update(update)
        .eq('id', enrollmentId)
        .select()
        .single();
    if (error) throw new Error(error.message);

    return data;
}

export async function getPaymentsForEnrollment(enrollmentId) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('enrollment_payments')
        .select('*')
        .eq('enrollment_id', enrollmentId)
        .order('paid_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
}

export async function listOutstandingBalances({ dueOnly = false } = {}) {
    const supabase = getSupabaseAdmin();
    let query = supabase
        .from('enrollments')
        .select('*')
        .gt('balance_due', 0)
        .order('next_payment_reminder_at', { ascending: true });

    if (dueOnly) {
        query = query.lte('next_payment_reminder_at', new Date().toISOString());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
}