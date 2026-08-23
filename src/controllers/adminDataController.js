/**
 * backend/src/controllers/adminDataController.js
 *
 * All data endpoints for the admin panel. Every export here is mounted
 * behind requireAdminAuth in routes/admin.js — none of this should ever
 * be reachable without a valid admin JWT.
 *
 * Uses the service-role Supabase client (bypasses RLS) since these are
 * trusted, authenticated server-side queries.
 */
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { getSignedFileUrl } from '../services/assessmentService.js';
import { computePlanEndDate } from './manualEnrollmentController.js';
import logger from '../config/logger.js';

// Plans with this many days (or fewer) left are surfaced in the "Ending
// Soon" dashboard insight. Matches the frontend's own `expiringSoon`
// threshold in adminUtils.getLifecycleStatus() — keep both in sync.
const ENDING_SOON_DAYS = 7;
// How many "ending soon" rows to actually return to the dashboard; the
// true count (for the KPI/badge) is reported separately as `total`.
const ENDING_SOON_LIMIT = 8;

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

function clampPageSize(n) {
    const v = parseInt(n, 10) || PAGE_SIZE_DEFAULT;
    return Math.min(Math.max(v, 1), PAGE_SIZE_MAX);
}

// ════════════════════════════════════════════════════════════════════════════
// ENROLLMENTS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/enrollments ──────────────────────────────────────────────
// Query params: search, coachingType, planType, status, dateFrom, dateTo,
//               sortField, sortDir, page, pageSize
export async function listEnrollments(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const {
            search = '',
            coachingType = 'all',
            planType = 'all',
            status = 'all',
            dateFrom,
            dateTo,
            sortField = 'created_at',
            sortDir = 'desc',
            page = 1,
            pageSize = PAGE_SIZE_DEFAULT,
        } = req.query;

        const ALLOWED_SORT = new Set([
            'created_at', 'customer_name', 'amount_paid', 'payment_date',
            'payment_status', 'coaching_type', 'plan_type', 'duration_months',
        ]);
        const sortF = ALLOWED_SORT.has(sortField) ? sortField : 'created_at';
        const ps = clampPageSize(pageSize);
        const pg = Math.max(1, parseInt(page, 10) || 1);

        let query = supabase.from('enrollments').select('*', { count: 'exact' });

        if (req.query.includeDeleted !== 'true') {
            query = query.is('deleted_at', null);
        }
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(
                `customer_name.ilike.%${s}%,customer_email.ilike.%${s}%,customer_phone.ilike.%${s}%,enrollment_id.ilike.%${s}%,program_name.ilike.%${s}%`
            );
        }
        if (coachingType !== 'all') query = query.eq('coaching_type', coachingType);
        if (planType !== 'all') query = query.eq('plan_type', planType);
        if (status !== 'all') query = query.eq('payment_status', status);
        if (dateFrom) query = query.gte('created_at', dateFrom);
        if (dateTo) query = query.lte('created_at', dateTo);

        query = query
            .order(sortF, { ascending: sortDir === 'asc' })
            .range((pg - 1) * ps, pg * ps - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        // Attach notes in one batch query rather than N+1
        const ids = (data || []).map((r) => r.id);
        const notesMap = await getNotesMap(supabase, 'enrollment', ids);

        const rows = (data || []).map((r) => ({ ...r, note: notesMap[r.id] || null }));

        return res.json({ rows, total: count || 0, page: pg, pageSize: ps });
    } catch (err) {
        logger.error(`[admin] listEnrollments failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load enrollments.' });
    }
}

// ── GET /api/admin/enrollments/:id ──────────────────────────────────────────
export async function getEnrollment(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('enrollments')
            .select('*')
            .eq('id', req.params.id)
            .is('deleted_at', null)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        const notesMap = await getNotesMap(supabase, 'enrollment', [data.id]);
        return res.json({ enrollment: { ...data, note: notesMap[data.id] || null } });
    } catch (err) {
        logger.error(`[admin] getEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load enrollment.' });
    }
}

// ── POST /api/admin/enrollments/:id/refund ───────────────────────────────────
// The ONLY manual override of payment_status left — everything else is
// derived automatically (Record Payment / recomputeEnrollmentTotals for
// manual payments, confirmPayment/the webhook for the website checkout).
// There used to be a general Pending/Failed/Refunded dropdown here too, but
// none of those besides "refunded" have any legitimate manual use once
// paid/pending/failed are all system-derived — they only ever existed to
// let an admin correct a status, and every one of those corrections is
// better made by fixing the actual payment record instead. Refunding can't
// be derived from anything: nothing else in the app ever knows "the admin
// already sent this money back outside the system" except this action
// itself, so it stays manual, deliberate, and confirm-gated on the frontend.
//
// Only callable on a currently-'paid' row (refunding something not paid
// makes no sense), and only callable once — re-running it on an already-
// refunded row would zero out amount_paid a second time no-op harmlessly,
// but the frontend never offers the button once it's already refunded.
export async function refundEnrollment(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data: existing, error: fetchErr } = await supabase
            .from('enrollments').select('total_amount, amount_paid, payment_status').eq('id', req.params.id).maybeSingle();
        if (fetchErr || !existing) return res.status(404).json({ error: 'Enrollment not found.' });

        if ((existing.payment_status || 'paid') !== 'paid') {
            return res.status(400).json({
                error: `Only a paid enrollment can be refunded (this one is ${existing.payment_status}).`,
            });
        }

        const total = Number(existing.total_amount ?? existing.amount_paid ?? 0);
        const { data, error } = await supabase
            .from('enrollments')
            .update({ payment_status: 'refunded', amount_paid: 0, balance_due: total, payment_plan_status: 'pending' })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        logger.info(`[admin] ${req.admin.username} marked enrollment ${data.enrollment_id} refunded`);
        return res.json({ enrollment: data });
    } catch (err) {
        logger.error(`[admin] refundEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to mark enrollment refunded.' });
    }
}

// ── PATCH /api/admin/enrollments/:id/plan-start-date ────────────────────────
// Backfills plan_start_date on enrollments that never got one set by the
// normal flows — e.g. a website checkout whose gateway timed out (so
// confirmPayment/the webhook never ran) and was later marked paid by hand
// after the customer paid the admin directly. Nothing else ever writes this
// column after creation, so without this endpoint that row's Active/Expired
// badge stays blank forever. Works on any enrollment regardless of source
// (unlike updateManualEnrollment, which is only reachable for source='manual'
// rows from the Manual Enrollments page).
export async function updatePlanStartDate(req, res) {
    try {
        const { planStartDate } = req.body || {};
        if (!planStartDate || isNaN(new Date(planStartDate).getTime())) {
            return res.status(400).json({ error: 'A valid planStartDate is required.' });
        }
        const supabase = getSupabaseAdmin();

        const { data, error } = await supabase
            .from('enrollments')
            .update({ plan_start_date: new Date(planStartDate).toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        logger.info(`[admin] ${req.admin.username} set plan_start_date on ${data.enrollment_id}`);
        return res.json({ enrollment: data });
    } catch (err) {
        logger.error(`[admin] updatePlanStartDate failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update plan start date.' });
    }
}

// ── GET /api/admin/enrollments/export ───────────────────────────────────────
// Returns ALL rows matching filters (no pagination) for CSV export client-side.
export async function exportEnrollments(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { search = '', coachingType = 'all', planType = 'all', status = 'all' } = req.query;

        let query = supabase.from('enrollments').select('*').is('deleted_at', null);
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(
                `customer_name.ilike.%${s}%,customer_email.ilike.%${s}%,enrollment_id.ilike.%${s}%`
            );
        }
        if (coachingType !== 'all') query = query.eq('coaching_type', coachingType);
        if (planType !== 'all') query = query.eq('plan_type', planType);
        if (status !== 'all') query = query.eq('payment_status', status);
        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;

        return res.json({ rows: data || [] });
    } catch (err) {
        logger.error(`[admin] exportEnrollments failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to export enrollments.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// ASSESSMENTS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/assessments ──────────────────────────────────────────────
// Query params now also accept `reviewed` ('true' | 'false') so the frontend
// can filter to "not yet reviewed" — this is what powers the dashboard's
// "Today's To-Do" list and the Assessments page filter.
export async function listAssessments(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const {
            search = '',
            status = 'all',
            plan = 'all',
            reviewed,
            sortField = 'created_at',
            sortDir = 'desc',
            page = 1,
            pageSize = PAGE_SIZE_DEFAULT,
        } = req.query;

        const ALLOWED_SORT = new Set(['created_at', 'first_name', 'status', 'commitment', 'plan', 'reviewed']);
        const sortF = ALLOWED_SORT.has(sortField) ? sortField : 'created_at';
        const ps = clampPageSize(pageSize);
        const pg = Math.max(1, parseInt(page, 10) || 1);

        let query = supabase.from('assessments').select('*', { count: 'exact' });
        if (req.query.includeDeleted !== 'true') {
            query = query.is('deleted_at', null);
        }
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(
                `first_name.ilike.%${s}%,last_name.ilike.%${s}%,whatsapp.ilike.%${s}%,email.ilike.%${s}%,city.ilike.%${s}%`
            );
        }
        if (status !== 'all') query = query.eq('status', status);
        if (plan !== 'all') query = query.eq('plan', plan);

        if (reviewed === 'true') query = query.eq('reviewed', true);
        else if (reviewed === 'false') query = query.eq('reviewed', false);

        query = query
            .order(sortF, { ascending: sortDir === 'asc' })
            .range((pg - 1) * ps, pg * ps - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        const ids = (data || []).map((r) => r.id);
        const notesMap = await getNotesMap(supabase, 'assessment', ids);
        const rows = (data || []).map((r) => ({ ...r, note: notesMap[r.id] || null }));

        return res.json({ rows, total: count || 0, page: pg, pageSize: ps });
    } catch (err) {
        logger.error(`[admin] listAssessments failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load assessments.' });
    }
}

// ── DELETE /api/admin/enrollments/:id — soft delete ──────────────────────────
export async function softDeleteEnrollment(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('enrollments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        logger.info(`[admin] ${req.admin.username} soft-deleted enrollment ${data.enrollment_id}`);
        return res.json({ success: true, enrollment: data });
    } catch (err) {
        logger.error(`[admin] softDeleteEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to delete enrollment.' });
    }
}

// ── DELETE /api/admin/assessments/:id — soft delete ───────────────────────────
export async function softDeleteAssessment(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('assessments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Assessment not found.' });

        logger.info(`[admin] ${req.admin.username} soft-deleted assessment ${data.id}`);
        return res.json({ success: true, assessment: data });
    } catch (err) {
        logger.error(`[admin] softDeleteAssessment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to delete assessment.' });
    }
}

// ── GET /api/admin/assessments/:id ──────────────────────────────────────────
// Includes freshly-signed URLs for photos/blood report (bucket is private).
export async function getAssessment(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('assessments')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Assessment not found.' });

        const [photoFrontUrl, photoSideUrl, bloodReportUrl] = await Promise.all([
            getSignedFileUrl(data.photo_front_path),
            getSignedFileUrl(data.photo_side_path),
            getSignedFileUrl(data.blood_report_path),
        ]);

        const notesMap = await getNotesMap(supabase, 'assessment', [data.id]);

        return res.json({
            assessment: {
                ...data,
                photoFrontUrl,
                photoSideUrl,
                bloodReportUrl,
                note: notesMap[data.id] || null,
            },
        });
    } catch (err) {
        logger.error(`[admin] getAssessment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load assessment.' });
    }
}

export async function exportAssessments(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { search = '', status = 'all', plan = 'all', dateFrom, dateTo } = req.query;

        let query = supabase.from('assessments').select('*').is('deleted_at', null);
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,whatsapp.ilike.%${s}%,email.ilike.%${s}%`);
        }
        if (status !== 'all') query = query.eq('status', status);
        if (plan !== 'all') query = query.eq('plan', plan);
        if (dateFrom) query = query.gte('created_at', dateFrom);
        if (dateTo) query = query.lte('created_at', dateTo);
        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;
        return res.json({ rows: data || [] });
    } catch (err) {
        logger.error(`[admin] exportAssessments failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to export assessments.' });
    }
}

export async function getFunnelAudit(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const { data: opened, error: e1 } = await supabase
            .from('transaction_logs')
            .select('razorpay_order_id')
            .in('step', ['create_order', 'client:checkout_opened'])
            .gte('created_at', since);

        const { data: captured, error: e2 } = await supabase
            .from('transaction_logs')
            .select('razorpay_order_id')
            .eq('step', 'confirm_payment:db_update')
            .eq('status', 'success')
            .gte('created_at', since);

        const { data: paidRows, error: e3 } = await supabase
            .from('enrollments')
            .select('id, enrollment_id, customer_name, customer_email, amount_paid, razorpay_order_id, created_at')
            .is('deleted_at', null)
            .eq('payment_status', 'paid')
            .gte('created_at', since);

        if (e1 || e2 || e3) throw (e1 || e2 || e3);

        const capturedOrderIds = new Set((captured || []).map((c) => c.razorpay_order_id).filter(Boolean));
        const paidByOrderId = new Map((paidRows || []).map((p) => [p.razorpay_order_id, p]));

        const loggedButNotPaid = [...capturedOrderIds].filter((id) => !paidByOrderId.has(id));

        const paidButNotLogged = (paidRows || [])
            .filter((p) => p.razorpay_order_id && !capturedOrderIds.has(p.razorpay_order_id))
            .map((p) => ({
                enrollmentId: p.enrollment_id,
                customerName: p.customer_name,
                customerEmail: p.customer_email,
                amountPaid: p.amount_paid,
                razorpayOrderId: p.razorpay_order_id,
                createdAt: p.created_at,
            }));

        return res.json({
            rangeDays: days,
            totals: {
                checkoutOpened: (opened || []).length,
                capturedAndLogged: capturedOrderIds.size,
                paidInDb: paidByOrderId.size,
            },
            issues: {
                loggedButNotPaid,
                paidButNotLogged,
            },
        });
    } catch (err) {
        logger.error(`[admin] getFunnelAudit failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to build funnel audit.' });
    }
}

// ── PATCH /api/admin/assessments/:id/status ─────────────────────────────────
const VALID_ASSESSMENT_STATUSES = ['new', 'reviewed', 'plan_sent', 'completed', 'archived'];
export async function updateAssessmentStatus(req, res) {
    try {
        const { status } = req.body || {};
        if (!VALID_ASSESSMENT_STATUSES.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${VALID_ASSESSMENT_STATUSES.join(', ')}`,
            });
        }
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('assessments')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Assessment not found.' });

        logger.info(`[admin] ${req.admin.username} set assessment ${data.id} → ${status}`);
        return res.json({ assessment: data });
    } catch (err) {
        logger.error(`[admin] updateAssessmentStatus failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update status.' });
    }
}

// ── PATCH /api/admin/assessments/:id/reviewed ───────────────────────────────
// NEW: standalone "reviewed" flag, independent of the status pipeline.
// Body: { reviewed: boolean }
// This is what the frontend's ReviewedToggle / setAssessmentReviewed() call
// and the dashboard's "Today's To-Do" list depend on — previously missing.
export async function updateAssessmentReviewed(req, res) {
    try {
        const { reviewed } = req.body || {};
        if (typeof reviewed !== 'boolean') {
            return res.status(400).json({ error: '`reviewed` must be a boolean (true or false).' });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('assessments')
            .update({ reviewed })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Assessment not found.' });

        logger.info(`[admin] ${req.admin.username} set assessment ${data.id} reviewed=${reviewed}`);
        return res.json({ assessment: data });
    } catch (err) {
        logger.error(`[admin] updateAssessmentReviewed failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update reviewed flag.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// LEADS — "Apply For Coaching" hero-modal cold enquiries
// ════════════════════════════════════════════════════════════════════════════

const VALID_LEAD_STATUSES = ['new', 'contacted', 'converted', 'not_interested'];

// ── GET /api/admin/leads ────────────────────────────────────────────────────
export async function listLeads(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const {
            search = '',
            status = 'all',
            sortField = 'created_at',
            sortDir = 'desc',
            page = 1,
            pageSize = PAGE_SIZE_DEFAULT,
        } = req.query;

        const ALLOWED_SORT = new Set(['created_at', 'name', 'status', 'goal']);
        const sortF = ALLOWED_SORT.has(sortField) ? sortField : 'created_at';
        const ps = clampPageSize(pageSize);
        const pg = Math.max(1, parseInt(page, 10) || 1);

        let query = supabase.from('leads').select('*', { count: 'exact' });
        if (req.query.includeDeleted !== 'true') {
            query = query.is('deleted_at', null);
        }
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
        }
        if (status !== 'all') query = query.eq('status', status);

        query = query
            .order(sortF, { ascending: sortDir === 'asc' })
            .range((pg - 1) * ps, pg * ps - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        const ids = (data || []).map((r) => r.id);
        const notesMap = await getNotesMap(supabase, 'lead', ids);
        const rows = (data || []).map((r) => ({ ...r, note: notesMap[r.id] || null }));

        return res.json({ rows, total: count || 0, page: pg, pageSize: ps });
    } catch (err) {
        logger.error(`[admin] listLeads failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load leads.' });
    }
}

// ── PATCH /api/admin/leads/:id/status ───────────────────────────────────────
export async function updateLeadStatus(req, res) {
    try {
        const { status } = req.body || {};
        if (!VALID_LEAD_STATUSES.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${VALID_LEAD_STATUSES.join(', ')}`,
            });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('leads')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Lead not found.' });

        logger.info(`[admin] ${req.admin.username} set lead ${data.id} → ${status}`);
        return res.json({ lead: data });
    } catch (err) {
        logger.error(`[admin] updateLeadStatus failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update status.' });
    }
}

// ── DELETE /api/admin/leads/:id — soft delete ───────────────────────────────
export async function softDeleteLead(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('leads')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Lead not found.' });

        logger.info(`[admin] ${req.admin.username} soft-deleted lead ${data.id}`);
        return res.json({ success: true, lead: data });
    } catch (err) {
        logger.error(`[admin] softDeleteLead failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to delete lead.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// NOTES (server-side, shared across admins — replaces localStorage notes)
// ════════════════════════════════════════════════════════════════════════════

async function getNotesMap(supabase, recordType, ids) {
    if (!ids || ids.length === 0) return {};
    const { data, error } = await supabase
        .from('admin_notes')
        .select('record_id, note, updated_at')
        .eq('record_type', recordType)
        .in('record_id', ids);

    if (error) {
        logger.warn(`[admin] getNotesMap failed: ${error.message}`);
        return {};
    }
    const map = {};
    (data || []).forEach((n) => { map[n.record_id] = { text: n.note, updatedAt: n.updated_at }; });
    return map;
}

// ── PUT /api/admin/notes ────────────────────────────────────────────────────
// Body: { recordType: 'enrollment'|'assessment', recordId, note }
export async function upsertNote(req, res) {
    try {
        const { recordType, recordId, note } = req.body || {};
        if (!['enrollment', 'assessment', 'lead'].includes(recordType) || !recordId) {
            return res.status(400).json({ error: 'recordType and recordId are required.' });
        }

        const supabase = getSupabaseAdmin();
        const text = (note || '').trim();

        if (!text) {
            // Empty note = delete it
            await supabase
                .from('admin_notes')
                .delete()
                .eq('record_type', recordType)
                .eq('record_id', recordId);
            return res.json({ note: null });
        }

        const { data, error } = await supabase
            .from('admin_notes')
            .upsert(
                {
                    record_type: recordType,
                    record_id: recordId,
                    note: text,
                    created_by: req.admin.id,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'record_type,record_id' }
            )
            .select()
            .single();

        if (error) throw error;

        return res.json({ note: { text: data.note, updatedAt: data.updated_at } });
    } catch (err) {
        logger.error(`[admin] upsertNote failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to save note.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/dashboard ─────────────────────────────────────────────────
// One call, everything the dashboard needs. Computed in JS after a couple of
// lightweight queries rather than relying on Postgres views, since the
// existing schema has no views/functions and we want this to work as-is.
export async function getDashboard(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { range = '90' } = req.query; // days
        const days = Math.min(Math.max(parseInt(range, 10) || 90, 7), 365);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const [
            { data: enrollments, error: e1 },
            { data: assessments, error: e2 },
            { count: totalEnrollments, error: e3 },
            { count: totalAssessments, error: e4 },
            { data: dietPlansInRangeRows, error: e6 },
            { count: totalDietPlans, error: e7 },
            { data: leadsInRangeRows, error: e8 },
            { count: totalLeads, error: e9 },
            { count: newLeadsCount, error: e10 },
        ] = await Promise.all([

            supabase
                .from('enrollments')
                .select('id, amount_paid, original_amount, coupon_savings, coupon_code, coaching_type, plan_type, duration_months, payment_status, created_at, customer_name, program_name, source, root_enrollment_id')
                .is('deleted_at', null)
                .gte('created_at', since)
                .order('created_at', { ascending: true }),
            supabase
                .from('assessments')
                .select('id, status, plan, commitment, reviewed, created_at, first_name, last_name')
                .is('deleted_at', null)
                .gte('created_at', since)
                .order('created_at', { ascending: true }),
            // BUG FIX: these two "all-time" counts previously had no
            // .is('deleted_at', null) filter (every other query in this file
            // does), so soft-deleted enrollments/assessments inflated the
            // Lifetime Strip and KPI sub-labels.
            supabase.from('enrollments').select('id', { count: 'exact', head: true }).is('deleted_at', null),
            supabase.from('assessments').select('id', { count: 'exact', head: true }).is('deleted_at', null),
            supabase
                .from('diet_plans')
                .select('id, enrollment_id, created_at')
                .gte('created_at', since),
            supabase.from('diet_plans').select('id', { count: 'exact', head: true }),
            supabase
                .from('leads')
                .select('id, name, goal, status, created_at')
                .is('deleted_at', null)
                .gte('created_at', since)
                .order('created_at', { ascending: true }),
            supabase.from('leads').select('id', { count: 'exact', head: true }).is('deleted_at', null),
            // Not range-scoped, same reasoning as followUpsDue/pendingReviewCount
            // below — "leads I still haven't touched" is a standing to-do, not
            // something that should disappear just because the range picker
            // moved past when they came in.
            supabase.from('leads').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'new'),
        ]);

        if (e1 || e2 || e3 || e4 || e6 || e7 || e8 || e9 || e10) throw (e1 || e2 || e3 || e4 || e6 || e7 || e8 || e9 || e10);

        // Outstanding balance — excludes never-completed website checkouts
        // (pending, failed, or refunded — none represent money genuinely
        // outstanding, just an abandoned/unsuccessful/reversed attempt). A
        // manual enrollment in any status is a deliberate entry and still
        // counts. See the matching exclusion in listOutstandingBalances().
        const { data: balanceRows, error: eBal } = await supabase
            .from('enrollments')
            .select('balance_due')
            .is('deleted_at', null)
            .gt('balance_due', 0)
            .or('source.neq.website,payment_status.eq.paid');

        if (eBal) throw eBal;

        const totalOutstandingBalance = (balanceRows || []).reduce(
            (s, r) => s + (Number(r.balance_due) || 0),
            0
        );


        const { count: followUpsDue, error: e5 } = await supabase
            .from('enrollments')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('followup_status', 'active')
            .eq('payment_status', 'paid')
            .lte('next_followup_at', new Date().toISOString());

        const paidEnrollments = (enrollments || []).filter((e) => (e.payment_status || 'paid') === 'paid');

        // ── Renewals + Ending Soon ───────────────────────────────────────────
        // Deliberately NOT scoped to the `since` range — a plan started 11
        // months ago that expires in 3 days must still surface here even
        // when the dashboard is filtered to "7D". Renewals are modeled as
        // brand-new rows chained via root_enrollment_id (see
        // createEnrollmentExtension), not a counter column, so the "how many
        // times has this client renewed" figure has to be derived by
        // grouping every paid, non-deleted row into its chain.
        const { data: activePlanRows, error: eActive } = await supabase
            .from('enrollments')
            .select('id, enrollment_id, root_enrollment_id, customer_name, program_name, plan_start_date, duration_months, payment_status, created_at')
            .is('deleted_at', null)
            .eq('payment_status', 'paid');
        if (eActive) throw eActive;

        const chains = new Map();
        (activePlanRows || []).forEach((row) => {
            const rootId = row.root_enrollment_id || row.id;
            if (!chains.has(rootId)) chains.set(rootId, []);
            chains.get(rootId).push(row);
        });

        let renewedAllTime = 0;
        const endingSoonAll = [];
        chains.forEach((rows) => {
            const extensionsCount = rows.length - 1;
            if (extensionsCount > 0) renewedAllTime += 1;

            // The chain's current period is whichever row started most
            // recently — for an extended chain that's always the latest
            // extension, since each new period is chained onto the
            // previous one's end date (never "today").
            const current = rows.reduce((latest, r) => (
                !latest || new Date(r.plan_start_date) > new Date(latest.plan_start_date) ? r : latest
            ), null);

            const end = current && computePlanEndDate(current.plan_start_date, current.duration_months);
            if (!end) return;
            const daysRemaining = Math.ceil((end.getTime() - Date.now()) / 86400000);
            if (daysRemaining < 0 || daysRemaining > ENDING_SOON_DAYS) return;

            endingSoonAll.push({
                id: current.id,
                enrollmentId: current.enrollment_id,
                customerName: current.customer_name || 'Unknown',
                programName: current.program_name || '',
                endDate: end.toISOString(),
                daysRemaining,
                extensionsCount,
                isRenewed: extensionsCount > 0,
            });
        });
        endingSoonAll.sort((a, b) => a.daysRemaining - b.daysRemaining);

        // Renewal *events* (extension rows) created within the selected
        // range — same "InRange" convention as the other KPI cards.
        const renewedInRange = paidEnrollments.filter((e) => e.root_enrollment_id).length;

        // ── KPIs ──────────────────────────────────────────────────────────────
        const totalRevenue = paidEnrollments.reduce((sum, e) => sum + (Number(e.amount_paid) || 0), 0);
        const totalSavings = paidEnrollments.reduce((sum, e) => sum + (Number(e.coupon_savings) || 0), 0);
        const avgOrderValue = paidEnrollments.length ? totalRevenue / paidEnrollments.length : 0;
        const couponUsageCount = paidEnrollments.filter((e) => e.coupon_code).length;
        const coupleCount = paidEnrollments.filter((e) => e.plan_type === 'couple').length;

        // ── Diet plans ────────────────────────────────────────────────────────
        const dietPlansInRange = (dietPlansInRangeRows || []).length;
        const dietPlansLinkedInRange = (dietPlansInRangeRows || []).filter((p) => p.enrollment_id).length;

        // ── Enrollment source split (manual entry vs website checkout) ──────
        const sourceCounts = { website: 0, manual: 0 };
        const sourceRevenue = { website: 0, manual: 0 };
        paidEnrollments.forEach((e) => {
            const k = e.source === 'manual' ? 'manual' : 'website';
            sourceCounts[k] += 1;
            sourceRevenue[k] += Number(e.amount_paid) || 0;
        });
        const enrollmentSourceSplit = [
            { name: 'Website Checkout', value: sourceCounts.website, revenue: Math.round(sourceRevenue.website) },
            { name: 'Manual Entry', value: sourceCounts.manual, revenue: Math.round(sourceRevenue.manual) },
        ];

        // ── Revenue trend — bucket by day ────────────────────────────────────
        const dayMap = {};
        paidEnrollments.forEach((e) => {
            const day = e.created_at.slice(0, 10);
            dayMap[day] = (dayMap[day] || 0) + (Number(e.amount_paid) || 0);
        });
        const revenueTrend = Object.entries(dayMap)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([date, amount]) => ({ date, amount: Math.round(amount) }));

        // ── Coaching type split ──────────────────────────────────────────────
        const coachingCounts = {};
        paidEnrollments.forEach((e) => {
            const k = e.coaching_type || 'unknown';
            coachingCounts[k] = (coachingCounts[k] || 0) + 1;
        });
        const coachingTypeSplit = Object.entries(coachingCounts).map(([name, value]) => ({ name, value }));

        const revenueByCoaching = {};
        paidEnrollments.forEach((e) => {
            const k = e.coaching_type || 'unknown';
            revenueByCoaching[k] = (revenueByCoaching[k] || 0) + (Number(e.amount_paid) || 0);
        });
        const revenueByCoachingType = Object.entries(revenueByCoaching).map(([name, value]) => ({ name, value: Math.round(value) }));

        // Rough conversion signal: paid enrollments vs. assessments started in
        // the same window. NOT a strict per-person funnel — most enrollments
        // on this site come from direct checkout with no assessment at all,
        // so paidEnrollments and assessments are independently-counted sets,
        // not "assessment X led to enrollment X". When paid enrollments
        // outnumber assessments in a window (common — direct checkout is the
        // main path), the raw ratio can exceed 100%, which is meaningless for
        // a percentage; it's capped here rather than shown uncapped.
        const conversionRate = (assessments || []).length
            ? Math.min(100, Math.round((paidEnrollments.length / (assessments || []).length) * 100))
            : null;


        // ── Plan type split ───────────────────────────────────────────────────
        const planCounts = {};
        paidEnrollments.forEach((e) => {
            const k = e.plan_type || 'unknown';
            planCounts[k] = (planCounts[k] || 0) + 1;
        });
        const planTypeSplit = Object.entries(planCounts).map(([name, value]) => ({ name, value }));

        // ── Duration distribution ────────────────────────────────────────────
        const durationCounts = {};
        paidEnrollments.forEach((e) => {
            const k = e.duration_months ? `${e.duration_months}mo` : 'unknown';
            durationCounts[k] = (durationCounts[k] || 0) + 1;
        });
        const durationSplit = Object.entries(durationCounts).map(([name, value]) => ({ name, value }));

        // ── Assessment status funnel ─────────────────────────────────────────
        const statusCounts = {};
        (assessments || []).forEach((a) => {
            const k = a.status || 'new';
            statusCounts[k] = (statusCounts[k] || 0) + 1;
        });
        const assessmentStatusSplit = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

        // ── Avg commitment score ─────────────────────────────────────────────
        const commitmentScores = (assessments || []).map((a) => a.commitment).filter((c) => typeof c === 'number');
        const avgCommitment = commitmentScores.length
            ? commitmentScores.reduce((s, c) => s + c, 0) / commitmentScores.length
            : null;

        // ── Reviewed vs pending assessments ──────────────────────────────────
        const reviewedCount = (assessments || []).filter((a) => a.reviewed).length;
        const pendingReviewCount = (assessments || []).length - reviewedCount;

        // ── Lead status funnel (cold enquiries — "Apply For Coaching" modal) ─
        const leadStatusCounts = {};
        (leadsInRangeRows || []).forEach((l) => {
            const k = l.status || 'new';
            leadStatusCounts[k] = (leadStatusCounts[k] || 0) + 1;
        });
        const leadStatusSplit = Object.entries(leadStatusCounts).map(([name, value]) => ({ name, value }));

        // ── Recent activity feed (mixed enrollments + assessments) ──────────
        const recentEnrollments = (enrollments || [])
            .slice(-8)
            .reverse()
            .map((e) => ({
                type: 'enrollment',
                id: e.id,
                title: e.customer_name || 'Unknown',
                subtitle: e.program_name || '',
                amount: e.amount_paid,
                timestamp: e.created_at,
            }));
        const recentAssessments = (assessments || [])
            .slice(-8)
            .reverse()
            .map((a) => ({
                type: 'assessment',
                id: a.id,
                title: [a.first_name, a.last_name].filter(Boolean).join(' ') || 'Unknown',
                subtitle: a.plan || '',
                timestamp: a.created_at,
            }));
        const recentLeads = (leadsInRangeRows || [])
            .slice(-8)
            .reverse()
            .map((l) => ({
                type: 'lead',
                id: l.id,
                title: l.name || 'Unknown',
                subtitle: l.goal || 'New enquiry',
                timestamp: l.created_at,
            }));
        const recentActivity = [...recentEnrollments, ...recentAssessments, ...recentLeads]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 10);

        return res.json({
            rangeDays: days,
            kpis: {
                totalRevenue,
                totalSavings,
                avgOrderValue,
                enrollmentsInRange: paidEnrollments.length,
                assessmentsInRange: (assessments || []).length,
                couponUsageCount,
                coupleCount,
                avgCommitment,
                totalEnrollmentsAllTime: totalEnrollments || 0,
                totalAssessmentsAllTime: totalAssessments || 0,
                conversionRate,
                followUpsDue: followUpsDue || 0,
                reviewedCount,
                pendingReviewCount,
                totalOutstandingBalance,
                clientsWithBalance: (balanceRows || []).length,
                dietPlansInRange,
                dietPlansLinkedInRange,
                totalDietPlansAllTime: totalDietPlans || 0,
                renewedInRange,
                renewedAllTime,
                endingSoonCount: endingSoonAll.length,
                leadsInRange: (leadsInRangeRows || []).length,
                totalLeadsAllTime: totalLeads || 0,
                newLeadsCount: newLeadsCount || 0,
            },
            charts: {
                revenueTrend,
                leadStatusSplit,
                coachingTypeSplit,
                planTypeSplit,
                durationSplit,
                assessmentStatusSplit,
                revenueByCoachingType,
                enrollmentSourceSplit,
            },
            endingSoon: endingSoonAll.slice(0, ENDING_SOON_LIMIT),
            recentActivity,
        });
    } catch (err) {
        logger.error(`[admin] getDashboard failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load dashboard.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// DATA AUDIT — independent verification of every calculation shown elsewhere
// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/data-audit
//
// Every number this admin panel shows (revenue, balance due, Active/
// Expiring/Expired counts…) is computed client-side from whatever rows the
// frontend happens to have cached. This endpoint recomputes the same things
// from a fresh, independent server-side pass over the raw tables — so if
// the two ever disagree, that disagreement itself is the signal something's
// wrong (a stale cache, a frontend bug, or bad underlying data), not
// something you have to take on faith. Read-only — it flags problems, it
// never fixes them, since every fix here needs a human decision (see
// updatePlanStartDate / refundEnrollment / recordPayment for the actual
// correction tools).
const AMOUNT_SLACK = 1; // ₹1 — floating-point/rounding tolerance, not a real mismatch

export async function getDataAudit(req, res) {
    try {
        const supabase = getSupabaseAdmin();

        const [{ data: enrollments, error: eEnroll }, { data: payments, error: ePay }] = await Promise.all([
            supabase
                .from('enrollments')
                .select('id, enrollment_id, customer_name, customer_email, customer_phone, source, payment_status, total_amount, amount_paid, balance_due, plan_start_date, duration_months, root_enrollment_id, created_at')
                .is('deleted_at', null),
            supabase.from('enrollment_payments').select('enrollment_id, amount'),
        ]);
        if (eEnroll) throw eEnroll;
        if (ePay) throw ePay;

        const rows = enrollments || [];

        const ledgerByEnrollment = new Map();
        (payments || []).forEach((p) => {
            ledgerByEnrollment.set(p.enrollment_id, (ledgerByEnrollment.get(p.enrollment_id) || 0) + Number(p.amount || 0));
        });

        // ── Per-row integrity checks ────────────────────────────────────────
        const issues = [];
        const flag = (row, type, message) => issues.push({
            type, message,
            enrollmentId: row.enrollment_id, id: row.id, customerName: row.customer_name || 'Unknown',
        });

        rows.forEach((row) => {
            const status = row.payment_status || 'paid';
            const total = Number(row.total_amount ?? row.amount_paid ?? 0);
            const amountPaid = Number(row.amount_paid || 0);
            const balanceDue = Number(row.balance_due || 0);
            const ledgerSum = ledgerByEnrollment.get(row.id) || 0;

            if (status === 'paid' && !row.plan_start_date) {
                flag(row, 'missing_plan_start_date', 'Paid but has no plan_start_date — Active/Expired badge can never appear for this row.');
            }
            if (status === 'paid' && amountPaid <= 0) {
                flag(row, 'paid_with_zero_amount', 'Marked Paid but amount_paid is ₹0 — shows as paid while contributing nothing to revenue.');
            }
            // Refunded is EXCLUDED here on purpose — its ledger is supposed
            // to still show the original payment (that's the historical
            // record refundEnrollment deliberately leaves alone), so a
            // "mismatch" there is the expected, correct state, not a bug.
            if (status !== 'refunded' && Math.abs(ledgerSum - amountPaid) > AMOUNT_SLACK) {
                flag(row, 'ledger_mismatch', `amount_paid (₹${amountPaid}) doesn't match the payment ledger's sum (₹${ledgerSum}).`);
            }
            if (Math.abs(Math.max(0, total - amountPaid) - balanceDue) > AMOUNT_SLACK) {
                flag(row, 'balance_mismatch', `balance_due (₹${balanceDue}) should be ₹${Math.max(0, total - amountPaid)} given total_amount and amount_paid.`);
            }
        });

        // ── Duplicate customers — the same email/phone spanning more than
        // one DISTINCT ENROLLMENT CHAIN, the exact "website + admin, same
        // client" gap createManualEnrollment's duplicate-warning guards
        // against at creation time. Reported here as a standing check too,
        // since that guard only fires at the moment of creation.
        //
        // Grouped by chain root (root_enrollment_id || id), NOT by raw row —
        // a legitimately renewed client has two rows (the original +
        // createEnrollmentExtension's extension row) that share an email
        // and are both 'paid', which looked identical to a real duplicate
        // until this was fixed. Only contacts with rows in TWO OR MORE
        // separate chains are genuine duplicates; two rows in the SAME
        // chain are one customer on their second period, not two customers.
        const liveRows = rows.filter((r) => ['pending', 'paid'].includes(r.payment_status || 'paid'));
        const byContact = new Map(); // contact -> Map(chainRootId -> Set(rowIds))
        liveRows.forEach((row) => {
            const chainRoot = row.root_enrollment_id || row.id;
            [row.customer_email, row.customer_phone].filter(Boolean).forEach((key) => {
                if (!byContact.has(key)) byContact.set(key, new Map());
                const chains = byContact.get(key);
                if (!chains.has(chainRoot)) chains.set(chainRoot, new Set());
                chains.get(chainRoot).add(row.id);
            });
        });
        const duplicateGroups = [];
        const seenGroups = new Set();
        byContact.forEach((chains, key) => {
            if (chains.size < 2) return; // one chain (possibly renewed) — not a duplicate
            const idSet = new Set();
            chains.forEach((ids) => ids.forEach((id) => idSet.add(id)));
            const groupKey = [...idSet].sort().join(',');
            if (seenGroups.has(groupKey)) return;
            seenGroups.add(groupKey);
            const groupRows = rows.filter((r) => idSet.has(r.id));
            duplicateGroups.push({
                contact: key,
                enrollments: groupRows.map((r) => ({
                    id: r.id, enrollmentId: r.enrollment_id, customerName: r.customer_name,
                    paymentStatus: r.payment_status, source: r.source, createdAt: r.created_at,
                })),
            });
        });

        // ── Revenue reconciliation — two independent ways to total "money
        // actually collected right now," which must agree exactly. ─────────
        const paidRows = rows.filter((r) => (r.payment_status || 'paid') === 'paid');
        const revenueFromRows = paidRows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
        const revenueFromLedger = paidRows.reduce((s, r) => s + (ledgerByEnrollment.get(r.id) || 0), 0);

        // ── Lifecycle counts — an independent server-side re-derivation of
        // the same Active/Expiring/Expired/Renewed/No-Plan buckets the
        // Enrollments page computes client-side, so the two can be compared.
        // Grouped per CUSTOMER exactly like the frontend does (a renewed
        // client's multiple rows count once, under whichever period is live).
        const rank = (lc) => (!lc ? 0 : lc.tag === 'expired' ? 1 : lc.expiringSoon ? 2 : 3);
        const lifecycleOf = (row) => {
            if ((row.payment_status || 'paid') !== 'paid' || !row.plan_start_date || !row.duration_months) return null;
            const end = computePlanEndDate(row.plan_start_date, row.duration_months);
            if (!end) return null;
            const daysRemaining = Math.ceil((end.getTime() - Date.now()) / 86400000);
            if (daysRemaining < 0) return { tag: 'expired', daysRemaining };
            return { tag: row.root_enrollment_id ? 'active_renewed' : 'active', daysRemaining, expiringSoon: daysRemaining <= 7 };
        };
        const byCustomer = new Map();
        rows.forEach((row) => {
            const key = row.customer_email || row.customer_phone || row.id;
            const lc = lifecycleOf(row);
            const prev = byCustomer.get(key);
            if (!prev || rank(lc) >= rank(prev)) byCustomer.set(key, lc);
        });
        const lifecycle = { active: 0, expiringSoon: 0, expired: 0, renewed: 0, noPlan: 0 };
        byCustomer.forEach((lc) => {
            if (!lc) { lifecycle.noPlan += 1; return; }
            if (lc.tag === 'expired') { lifecycle.expired += 1; return; }
            lifecycle.active += 1;
            if (lc.expiringSoon) lifecycle.expiringSoon += 1;
            if (lc.tag === 'active_renewed') lifecycle.renewed += 1;
        });

        const statusCounts = rows.reduce((acc, r) => {
            const s = r.payment_status || 'paid';
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, {});

        return res.json({
            generatedAt: new Date().toISOString(),
            totals: {
                enrollmentCount: rows.length,
                ledgerEntryCount: (payments || []).length,
                statusCounts,
            },
            revenue: {
                fromEnrollmentRows: revenueFromRows,
                fromPaymentLedger: revenueFromLedger,
                matches: Math.abs(revenueFromRows - revenueFromLedger) <= AMOUNT_SLACK,
            },
            lifecycle,
            duplicateGroups,
            issues,
        });
    } catch (err) {
        logger.error(`[admin] getDataAudit failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load data audit.' });
    }
}