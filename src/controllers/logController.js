/**
 * src/controllers/logController.js
 *
 * POST /api/log-event — lets the FRONTEND record transaction steps too
 * (checkout opened, handler fired, user dismissed modal, etc). A lot of
 * enrollment failures originate client-side before the backend is even
 * called, so this is essential for full-picture debugging.
 *
 * Intentionally unauthenticated (same trust level as /create-order) but
 * rate-limited implicitly by the global limiter in security.js. Never
 * trust this data for anything except debugging/observability.
 */
import { logTxnStep } from '../services/txnLogService.js';
import { getTxnTimeline } from '../services/txnLogService.js';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

export async function logClientEvent(req, res) {
    try {
        const { orderId, paymentId, enrollmentId, step, status, message, metadata } = req.body || {};

        if (!step || typeof step !== 'string') {
            return res.status(400).json({ error: '`step` is required (string).' });
        }
        if (!status || !['started', 'success', 'failed', 'warning'].includes(status)) {
            return res.status(400).json({ error: '`status` must be one of: started, success, failed, warning.' });
        }

        // Fire-and-forget from the route's perspective, but we still await
        // it here since logTxnStep itself never throws.
        await logTxnStep({
            orderId,
            paymentId,
            enrollmentId,
            step: `client:${step}`,
            status,
            message,
            metadata,
            source: 'frontend',
        });

        return res.json({ success: true });
    } catch (err) {
        // Even this outer catch should never actually fire since logTxnStep
        // swallows its own errors, but belt-and-suspenders here too.
        logger.error(`[logClientEvent] unexpected error: ${err.message}`);
        return res.json({ success: false });
    }
}

/**
 * GET /api/admin/txn-timeline?orderId=... | ?paymentId=... | ?enrollmentId=...
 * Admin-only (mounted behind requireAdminAuth) helper to inspect a single
 * transaction's full step-by-step history without touching Supabase directly.
 */
export async function getTxnTimelineHandler(req, res) {
    try {
        const { orderId, paymentId, enrollmentId } = req.query;

        if (!orderId && !paymentId && !enrollmentId) {
            return res.status(400).json({ error: 'Provide orderId, paymentId, or enrollmentId as a query param.' });
        }

        const timeline = await getTxnTimeline({ orderId, paymentId, enrollmentId });
        return res.json({ timeline });
    } catch (err) {
        logger.error(`[getTxnTimelineHandler] failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load transaction timeline.' });
    }
}

/**
 * GET /api/admin/logs — the general "browse recent logs" view, as opposed
 * to getTxnTimelineHandler above which looks up ONE specific order/payment/
 * enrollment. Query params: status ('all'|'started'|'success'|'failed'|
 * 'warning'), source ('all'|'backend'|'frontend'), search (matches step or
 * message), dateFrom, dateTo, page, pageSize.
 */
export async function listLogsHandler(req, res) {
    try {
        const {
            status = 'all',
            source = 'all',
            search = '',
            dateFrom,
            dateTo,
            page = 1,
            pageSize = PAGE_SIZE_DEFAULT,
        } = req.query;

        const ps = Math.min(Math.max(parseInt(pageSize, 10) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
        const pg = Math.max(1, parseInt(page, 10) || 1);

        const supabase = getSupabaseAdmin();
        let query = supabase.from('transaction_logs').select('*', { count: 'exact' });

        if (status !== 'all') query = query.eq('status', status);
        if (source !== 'all') query = query.eq('source', source);
        if (dateFrom) query = query.gte('created_at', dateFrom);
        if (dateTo) query = query.lte('created_at', dateTo);
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(`step.ilike.%${s}%,message.ilike.%${s}%,enrollment_id.ilike.%${s}%`);
        }

        query = query.order('created_at', { ascending: false }).range((pg - 1) * ps, pg * ps - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        return res.json({ rows: data || [], total: count || 0, page: pg, pageSize: ps });
    } catch (err) {
        logger.error(`[listLogsHandler] failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load logs.' });
    }
}