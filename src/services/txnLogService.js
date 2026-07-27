/**
 * src/services/txnLogService.js
 *
 * Central logger for every step of a payment/enrollment transaction.
 * Mirrors to winston (console/file) always; writes to the `transaction_logs`
 * Supabase table depending on the admin-controlled verbose-logging setting:
 *   - OFF (default): only "important" entries are persisted — any failure/
 *     warning, plus the final success of a real transaction (order created,
 *     payment confirmed). The many step-by-step "started"/intermediate
 *     entries (per checkout: order + confirm + webhook + client-side events
 *     can easily add up to 15-20+ rows) are skipped, cutting DB write load.
 *   - ON: every step is persisted, same as before — useful when actively
 *     debugging a specific customer's payment.
 * Toggle lives at Admin → Site Settings → Logging.
 *
 * CRITICAL: This must NEVER throw and must NEVER block or break the real
 * payment/enrollment flow. All failures here are swallowed and logged
 * to winston only.
 */
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { isVerboseLoggingEnabled } from './contentService.js';
import logger from '../config/logger.js';

// Steps whose SUCCESS/FAILURE marks the actual outcome of a transaction —
// always persisted regardless of the verbose setting. Their own "started"
// marker is still verbose-only (see shouldPersist below); only the outcome
// matters when verbose logging is off.
const ESSENTIAL_STEPS = new Set([
    'create_order',
    'confirm_payment:db_update',
    'webhook:db_update',
    'webhook:unhandled',
]);

function shouldPersist(step, status) {
    if (status === 'failed' || status === 'warning') return true; // errors/warnings always matter
    if (status === 'started') return false; // pure "began" markers — lowest value, highest volume
    return ESSENTIAL_STEPS.has(step); // a handful of real outcomes always kept; everything else is verbose-only
}

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
        if (!shouldPersist(step, status) && !(await isVerboseLoggingEnabled())) {
            return;
        }

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