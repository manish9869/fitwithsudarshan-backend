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
import logger from '../config/logger.js';

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
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        const notesMap = await getNotesMap(supabase, 'enrollment', [data.id]);
        return res.json({ enrollment: { ...data, note: notesMap[data.id] || null } });
    } catch (err) {
        logger.error(`[admin] getEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load enrollment.' });
    }
}

// ── PATCH /api/admin/enrollments/:id/status ─────────────────────────────────
const VALID_ENROLLMENT_STATUSES = ['paid', 'pending', 'failed', 'refunded'];
export async function updateEnrollmentStatus(req, res) {
    try {
        const { status } = req.body || {};
        if (!VALID_ENROLLMENT_STATUSES.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${VALID_ENROLLMENT_STATUSES.join(', ')}`,
            });
        }
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('enrollments')
            .update({ payment_status: status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        logger.info(`[admin] ${req.admin.username} set enrollment ${data.enrollment_id} → ${status}`);
        return res.json({ enrollment: data });
    } catch (err) {
        logger.error(`[admin] updateEnrollmentStatus failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update status.' });
    }
}

// ── GET /api/admin/enrollments/export ───────────────────────────────────────
// Returns ALL rows matching filters (no pagination) for CSV export client-side.
export async function exportEnrollments(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { search = '', coachingType = 'all', planType = 'all', status = 'all' } = req.query;

        let query = supabase.from('enrollments').select('*');
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
export async function listAssessments(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const {
            search = '',
            status = 'all',
            plan = 'all',
            sortField = 'created_at',
            sortDir = 'desc',
            page = 1,
            pageSize = PAGE_SIZE_DEFAULT,
        } = req.query;

        const ALLOWED_SORT = new Set(['created_at', 'first_name', 'status', 'commitment', 'plan']);
        const sortF = ALLOWED_SORT.has(sortField) ? sortField : 'created_at';
        const ps = clampPageSize(pageSize);
        const pg = Math.max(1, parseInt(page, 10) || 1);

        let query = supabase.from('assessments').select('*', { count: 'exact' });

        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(
                `first_name.ilike.%${s}%,last_name.ilike.%${s}%,whatsapp.ilike.%${s}%,email.ilike.%${s}%,city.ilike.%${s}%`
            );
        }
        if (status !== 'all') query = query.eq('status', status);
        if (plan !== 'all') query = query.eq('plan', plan);

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

        let query = supabase.from('assessments').select('*');
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
        if (!['enrollment', 'assessment'].includes(recordType) || !recordId) {
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
        ] = await Promise.all([
            supabase
                .from('enrollments')
                .select('id, amount_paid, original_amount, coupon_savings, coupon_code, coaching_type, plan_type, duration_months, payment_status, created_at, customer_name, program_name')
                .gte('created_at', since)
                .order('created_at', { ascending: true }),
            supabase
                .from('assessments')
                .select('id, status, plan, commitment, created_at, first_name, last_name')
                .gte('created_at', since)
                .order('created_at', { ascending: true }),
            supabase.from('enrollments').select('id', { count: 'exact', head: true }),
            supabase.from('assessments').select('id', { count: 'exact', head: true }),
        ]);

        if (e1 || e2 || e3 || e4) throw (e1 || e2 || e3 || e4);

        const paidEnrollments = (enrollments || []).filter((e) => (e.payment_status || 'paid') === 'paid');

        // ── KPIs ──────────────────────────────────────────────────────────────
        const totalRevenue = paidEnrollments.reduce((sum, e) => sum + (Number(e.amount_paid) || 0), 0);
        const totalSavings = paidEnrollments.reduce((sum, e) => sum + (Number(e.coupon_savings) || 0), 0);
        const avgOrderValue = paidEnrollments.length ? totalRevenue / paidEnrollments.length : 0;
        const couponUsageCount = paidEnrollments.filter((e) => e.coupon_code).length;
        const coupleCount = paidEnrollments.filter((e) => e.plan_type === 'couple').length;

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

        // new-vs-returning style: coupon usage over time isn't needed; add this instead:
        const conversionRate = (assessments || []).length
            ? Math.round((paidEnrollments.length / (assessments || []).length) * 100)
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
        const recentActivity = [...recentEnrollments, ...recentAssessments]
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
                conversionRate
            },
            charts: {
                revenueTrend,
                coachingTypeSplit,
                planTypeSplit,
                durationSplit,
                assessmentStatusSplit,
                revenueByCoachingType
            },
            recentActivity,
        });
    } catch (err) {
        logger.error(`[admin] getDashboard failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load dashboard.' });
    }
}