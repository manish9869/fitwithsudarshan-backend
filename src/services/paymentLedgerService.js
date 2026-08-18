import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';
import { logTxnStep } from './txnLogService.js';
import { incrementCouponUsage } from './couponService.js';

// ── Shared "mark this enrollment paid" finalization ─────────────────────────
// Both confirmPayment() (browser callback) and handleRazorpayWebhook() reach
// this exact point after independently winning the "flip pending → paid"
// race, and both need to do the same two follow-up writes: bump the
// coupon's used_count and drop a row in the payment ledger. This used to be
// copy-pasted in both controllers — kept here once so the two paths can't
// drift out of sync. `source` is only used for log tagging.
export async function finalizePaidEnrollment(row, { source } = {}) {
    const supabase = getSupabaseAdmin();
    const ctx = { orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id };

    if (row.coupon_code) {
        incrementCouponUsage(row.coupon_code).catch((e) => {
            logger.error(`[${source}] ⚠️ coupon usage increment failed for ${row.coupon_code}: ${e.message}`);
            logTxnStep({ ...ctx, step: `${source}:coupon_increment`, status: 'failed', message: e.message });
        });
    }

    supabase.from('enrollment_payments').insert([{
        enrollment_id: row.id,
        amount: row.amount_paid,
        method: 'razorpay',
        reference: row.razorpay_payment_id,
        paid_at: row.payment_date,
    }]).then(({ error: ledgerErr }) => {
        if (ledgerErr) {
            logger.warn(`[${source}] ledger insert failed: ${ledgerErr.message}`);
            logTxnStep({ ...ctx, step: `${source}:ledger_insert`, status: 'failed', message: ledgerErr.message });
        }
    }).catch((e) => {
        logger.warn(`[${source}] ledger insert threw: ${e.message}`);
        logTxnStep({ ...ctx, step: `${source}:ledger_insert`, status: 'failed', message: e.message });
    });
}

// ── A real Razorpay payment captures for an order whose enrollment was
// ALREADY marked paid via a DIFFERENT payment (razorpay_payment_id differs,
// or is null because it was recorded manually) — e.g. the customer's
// checkout looked timed out, they paid the admin directly by UPI, the admin
// recorded that manually, and THEN the original gateway charge actually
// captured anyway. That real money moved through Razorpay and — before this
// — nothing else in the system would ever record or surface it: the
// idempotency guard treated it as "already processed" and silently dropped
// it. This is NOT that case (a true retry/replay of the SAME payment is
// still a safe no-op, handled by the caller) — this is a second, different
// payment. Both confirmPayment and the webhook hit this, so it lives here
// once rather than drifting between the two like finalizePaidEnrollment.
export async function flagPossibleDuplicatePayment(row, { paymentId, amount, paidAt, source }) {
    const supabase = getSupabaseAdmin();
    logger.warn(
        `[${source}] ⚠️ POSSIBLE DOUBLE PAYMENT — Razorpay payment ${paymentId} (₹${amount}) captured for ` +
        `${row.enrollment_id} (${row.customer_name}), which was already marked paid via a different payment ` +
        `(${row.razorpay_payment_id || 'manual entry'}). Recording it and flagging for manual review.`
    );

    supabase.from('enrollment_payments').insert([{
        enrollment_id: row.id,
        amount,
        method: 'razorpay',
        reference: paymentId,
        note: 'Captured after this enrollment was already marked paid via a different payment — possible duplicate charge, verify with customer.',
        paid_at: paidAt,
    }]).then(({ error }) => {
        if (error) logger.error(`[${source}] duplicate-payment ledger insert failed: ${error.message}`);
    });

    // Surface it on the generic admin_notes record (shown in the enrollment
    // detail drawer regardless of source) rather than the manual-enrollment-
    // only admin_note column, which a website-sourced row never shows —
    // append, don't overwrite, since a real note may already be there.
    try {
        const { data: existingNote } = await supabase
            .from('admin_notes').select('note').eq('record_type', 'enrollment').eq('record_id', row.id).maybeSingle();
        const flag = `⚠️ ${new Date().toISOString().slice(0, 10)}: Razorpay payment ${paymentId} (₹${amount}) captured ` +
            `AFTER this enrollment was already marked paid — possible double payment, verify with the customer.`;
        const text = existingNote?.note ? `${existingNote.note}\n\n${flag}` : flag;
        await supabase.from('admin_notes').upsert(
            { record_type: 'enrollment', record_id: row.id, note: text, updated_at: new Date().toISOString() },
            { onConflict: 'record_type,record_id' }
        );
    } catch (e) {
        logger.error(`[${source}] duplicate-payment note flag failed: ${e.message}`);
    }
}

export async function recordPayment({ enrollmentId, amount, method = 'other', reference, note, recordedBy, paidAt }) {
    const supabase = getSupabaseAdmin();
    const amt = Number(amount);
    if (!enrollmentId || !amt || amt <= 0) {
        throw new Error('enrollmentId and a positive amount are required.');
    }

    const { data: enrollment, error: fetchErr } = await supabase
        .from('enrollments')
        .select('id, total_amount, amount_paid')
        .eq('id', enrollmentId)
        .single();
    if (fetchErr || !enrollment) throw new Error('Enrollment not found.');

    // Guard against a fat-fingered or duplicated entry pushing amount_paid
    // past what's actually owed (e.g. re-recording the same UPI transfer
    // twice, or a typo adding a zero). total_amount is the number set
    // deliberately at checkout/creation, so it's trusted over re-deriving
    // one from the ledger. Only enforced when total_amount is actually
    // known — older rows without one fall through, same as
    // recomputeEnrollmentTotals's own fallback below.
    const total = Number(enrollment.total_amount || 0);
    if (total > 0) {
        const remaining = total - Number(enrollment.amount_paid || 0);
        if (amt > remaining + 1) { // ₹1 slack for rounding
            throw new Error(
                `This payment (₹${amt.toLocaleString('en-IN')}) would exceed the outstanding balance of ₹${Math.max(0, remaining).toLocaleString('en-IN')}. Correct the total amount first if this is intentional.`
            );
        }
    }

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
        // A website checkout that was never completed — abandoned mid-
        // checkout (pending), the payment itself failing at Razorpay
        // (failed), or later reversed (refunded) — also ends up with
        // balance_due > 0 (the full expected price, nothing collected).
        // None of those are a payment plan to actively follow up on, unlike
        // a manually-created enrollment that intentionally starts at $0
        // paid, or a website enrollment that's genuinely mid-installment
        // (payment_status stays 'paid' for a partial payment — only the
        // amount differs). So: for website-sourced rows, only a currently
        // 'paid' status belongs here; a manual entry in any status still does.
        .or('source.neq.website,payment_status.eq.paid')
        .order('next_payment_reminder_at', { ascending: true });

    if (dueOnly) {
        query = query.lte('next_payment_reminder_at', new Date().toISOString());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
}

