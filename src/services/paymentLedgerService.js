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

// ── NEW: edit the amount/method/reference/date of the most recent payment
// on an enrollment's ledger, or record the first payment if none exists.
// This is what powers "edit amount" + "payment id/date not filling on
// edit" on the Manual Enrollment page — previously those form fields were
// captured but never actually written anywhere.
export async function upsertLatestPayment({ enrollmentId, amount, method, reference, paidAt, recordedBy }) {
    const supabase = getSupabaseAdmin();

    const { data: latest, error: fetchErr } = await supabase
        .from('enrollment_payments')
        .select('*')
        .eq('enrollment_id', enrollmentId)
        .order('paid_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);

    if (latest) {
        const update = {};
        if (amount != null && !Number.isNaN(amount)) update.amount = amount;
        if (method) update.method = method;
        if (reference !== undefined) update.reference = reference || null;
        if (paidAt) update.paid_at = new Date(paidAt).toISOString();
        if (Object.keys(update).length === 0) return;

        const { error } = await supabase.from('enrollment_payments').update(update).eq('id', latest.id);
        if (error) throw new Error(`Failed to update payment: ${error.message}`);
    } else if (amount != null && amount > 0) {
        const { error } = await supabase.from('enrollment_payments').insert([{
            enrollment_id: enrollmentId,
            amount,
            method: method || 'other',
            reference: reference || null,
            note: null,
            recorded_by: recordedBy || null,
            paid_at: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
        }]);
        if (error) throw new Error(`Failed to record payment: ${error.message}`);
    }
}

export async function recomputeEnrollmentTotals(enrollmentId) {
    const supabase = getSupabaseAdmin();

    const { data: payments, error: payErr } = await supabase
        .from('enrollment_payments')
        .select('amount, paid_at')
        .eq('enrollment_id', enrollmentId)
        .order('paid_at', { ascending: true });
    if (payErr) throw new Error(payErr.message);

    const amountPaid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    // FIX: payment_date was never propagated from the ledger for manual
    // (or ledger-corrected) enrollments — this is why "Date" showed blank
    // in the table whenever the row's source wasn't the direct Razorpay
    // checkout flow.
    const latestPaidAt = payments && payments.length ? payments[payments.length - 1].paid_at : null;

    const { data: enrollment, error: fetchErr } = await supabase
        .from('enrollments')
        .select('total_amount, amount_paid, payment_date')
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
    if (latestPaidAt) update.payment_date = latestPaidAt;

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
        .is('deleted_at', null)
        .gt('balance_due', 0)
        .order('next_payment_reminder_at', { ascending: true });

    if (dueOnly) {
        query = query.lte('next_payment_reminder_at', new Date().toISOString());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
}

