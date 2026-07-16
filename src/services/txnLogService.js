/**
 * src/services/txnLogService.js
 *
 * Central logger for every step of a payment/enrollment transaction.
 * Writes to the `transaction_logs` Supabase table AND mirrors to winston,
 * so you have both a queryable audit trail per order/payment/enrollment
 * AND real-time console/file visibility.
 *
 * CRITICAL: This must NEVER throw and must NEVER block or break the real
 * payment/enrollment flow. All failures here are swallowed and logged
 * to winston only.
 */
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';

/**
 * @param {object} opts
 * @param {string} [opts.orderId]        - razorpay_order_id
 * @param {string} [opts.paymentId]      - razorpay_payment_id
 * @param {string} [opts.enrollmentId]   - our enrollment_id (FIT-YYYY-XXXXXX)
 * @param {string} opts.step             - e.g. 'create_order', 'create_enrollment:db_insert'
 * @param {string} opts.status           - 'started' | 'success' | 'failed' | 'warning'
 * @param {string} [opts.message]        - human readable detail
 * @param {object} [opts.metadata]       - any extra structured data (JSON-serializable)
 * @param {string} [opts.source]         - 'backend' | 'frontend', defaults to 'backend'
 */
export async function logTxnStep({
    orderId,
    paymentId,
    enrollmentId,
    step,
    status,
    message,
    metadata,
    source = 'backend',
}) {
    const line = `[txn:${step}] ${status} — order=${orderId || '-'} payment=${paymentId || '-'} enrollment=${enrollmentId || '-'}${message ? ' — ' + message : ''}`;

    if (status === 'failed') {
        logger.error(line);
    } else if (status === 'warning') {
        logger.warn(line);
    } else {
        logger.info(line);
    }

    try {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase.from('transaction_logs').insert([
            {
                razorpay_order_id: orderId || null,
                razorpay_payment_id: paymentId || null,
                enrollment_id: enrollmentId || null,
                step,
                status,
                message: message || null,
                metadata: metadata || null,
                source,
            },
        ]);

        if (error) {
            logger.error(`[txnLog] insert failed for step="${step}": ${error.message}`);
        }
    } catch (err) {
        // If Supabase config itself is broken (e.g. missing env vars), this
        // will throw — swallow it. The winston line above already captured
        // the important information so nothing is truly lost.
        logger.error(`[txnLog] could not persist log for step="${step}": ${err.message}`);
    }
}

/**
 * Convenience wrapper: fetch ALL logged steps for a given order/payment/
 * enrollment id, in chronological order. Useful for building an admin
 * "transaction timeline" view later if you want one.
 */
export async function getTxnTimeline({ orderId, paymentId, enrollmentId }) {
    const supabase = getSupabaseAdmin();
    let query = supabase.from('transaction_logs').select('*').order('created_at', { ascending: true });

    if (orderId) query = query.eq('razorpay_order_id', orderId);
    else if (paymentId) query = query.eq('razorpay_payment_id', paymentId);
    else if (enrollmentId) query = query.eq('enrollment_id', enrollmentId);
    else throw new Error('getTxnTimeline requires orderId, paymentId, or enrollmentId.');

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}