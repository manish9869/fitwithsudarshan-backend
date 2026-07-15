/**
 * src/controllers/manualEnrollmentController.js
 *
 * Manual enrollment entry (friends/direct-transfer clients who never hit the
 * website), on-demand enrollment emails, and the 7-day follow-up system.
 * Everything here sits behind requireAdminAuth (mounted in routes/admin.js).
 */
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { getTransporter } from './emailController.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function generateEnrollmentId() {
    const year = new Date().getFullYear();
    const random = Math.floor(100000 + Math.random() * 900000);
    return `FIT-${year}-${random}`;
}

// Map a snake_case DB row → the camelCase shape emailTemplates.js expects
function toTemplateData(row) {
    return {
        enrollmentId: row.enrollment_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone,
        programName: row.program_name,
        planType: row.plan_type,
        durationMonths: row.duration_months,
        coachingType: row.coaching_type,
        amountPaid: row.amount_paid,
        originalAmount: row.original_amount,
        couponCode: row.coupon_code,
        couponSavings: row.coupon_savings,
        razorpayOrderId: row.razorpay_order_id,
        razorpayPaymentId: row.razorpay_payment_id,
        paymentDate: row.payment_date,
        goals: row.goals,
        partnerGoals: row.partner_goals,
    };
}

// ── POST /api/admin/enrollments/manual ───────────────────────────────────────
export async function createManualEnrollment(req, res) {
    try {
        const b = req.body || {};

        if (!b.customerName || !b.programName || b.amountPaid == null) {
            return res.status(400).json({ error: 'customerName, programName and amountPaid are required.' });
        }

        const supabase = getSupabaseAdmin();
        const paymentDate = b.paymentDate ? new Date(b.paymentDate).toISOString() : new Date().toISOString();

        const row = {
            enrollment_id: generateEnrollmentId(),
            customer_name: b.customerName,
            customer_email: b.customerEmail || null,
            customer_phone: b.customerPhone || null,
            program_name: b.programName,
            plan_type: b.planType || 'individual',
            coaching_type: b.coachingType || 'online',
            duration_months: b.durationMonths || null,
            amount_paid: Number(b.amountPaid),
            original_amount: b.originalAmount != null ? Number(b.originalAmount) : Number(b.amountPaid),
            coupon_code: b.couponCode || null,
            coupon_savings: b.couponSavings ? Number(b.couponSavings) : 0,
            razorpay_order_id: null,
            razorpay_payment_id: b.paymentReference || null, // UTR / UPI ref / Razorpay payment ID
            payment_date: paymentDate,
            payment_status: b.paymentStatus || 'paid',
            age: b.age || null,
            city: b.city || null,
            weight: b.weight || null,
            goals: Array.isArray(b.goals) ? b.goals : (b.goals ? [b.goals] : []),
            medical_issue: b.medicalIssue || null,
            medical_note: b.medicalNote || null,
            partner_name: b.partnerName || null,
            partner_age: b.partnerAge || null,
            partner_weight: b.partnerWeight || null,
            partner_goals: Array.isArray(b.partnerGoals) ? b.partnerGoals : (b.partnerGoals ? [b.partnerGoals] : null),
            partner_medical_issue: b.partnerMedicalIssue || null,
            partner_medical_note: b.partnerMedicalNote || null,
            source: 'manual',
            payment_method: b.paymentMethod || 'other',
            admin_note: b.adminNote || null,
            followup_status: 'active',
            next_followup_at: new Date(new Date(paymentDate).getTime() + SEVEN_DAYS_MS).toISOString(),
        };

        let { data, error } = await supabase.from('enrollments').insert([row]).select().single();

        // Extremely rare enrollment_id collision — retry once with a fresh ID
        if (error?.code === '23505') {
            row.enrollment_id = generateEnrollmentId();
            ({ data, error } = await supabase.from('enrollments').insert([row]).select().single());
        }
        if (error) throw error;

        logger.info(`[admin] ${req.admin.username} created manual enrollment ${data.enrollment_id}`);
        return res.status(201).json({ enrollment: data });
    } catch (err) {
        logger.error(`[admin] createManualEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to create manual enrollment.' });
    }
}

// ── PATCH /api/admin/enrollments/manual/:id ──────────────────────────────────
// Lets the admin edit a manual enrollment (or any enrollment) after creation.
export async function updateManualEnrollment(req, res) {
    try {
        const b = req.body || {};

        if (!b.customerName || !b.programName || b.amountPaid == null) {
            return res.status(400).json({ error: 'customerName, programName and amountPaid are required.' });
        }

        const supabase = getSupabaseAdmin();

        const { data: existing, error: fetchErr } = await supabase
            .from('enrollments')
            .select('id')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !existing) {
            return res.status(404).json({ error: 'Enrollment not found.' });
        }

        const update = {
            customer_name: b.customerName,
            customer_email: b.customerEmail || null,
            customer_phone: b.customerPhone || null,
            program_name: b.programName,
            plan_type: b.planType || 'individual',
            coaching_type: b.coachingType || 'online',
            duration_months: b.durationMonths || null,
            amount_paid: Number(b.amountPaid),
            original_amount: b.originalAmount != null ? Number(b.originalAmount) : Number(b.amountPaid),
            coupon_code: b.couponCode || null,
            coupon_savings: b.couponSavings ? Number(b.couponSavings) : 0,
            razorpay_payment_id: b.paymentReference || null,
            payment_date: b.paymentDate ? new Date(b.paymentDate).toISOString() : new Date().toISOString(),
            payment_status: b.paymentStatus || 'paid',
            age: b.age || null,
            city: b.city || null,
            weight: b.weight || null,
            goals: Array.isArray(b.goals) ? b.goals : (b.goals ? [b.goals] : []),
            medical_issue: b.medicalIssue || null,
            medical_note: b.medicalNote || null,
            partner_name: b.partnerName || null,
            partner_age: b.partnerAge || null,
            partner_weight: b.partnerWeight || null,
            partner_goals: Array.isArray(b.partnerGoals) ? b.partnerGoals : (b.partnerGoals ? [b.partnerGoals] : null),
            partner_medical_issue: b.partnerMedicalIssue || null,
            partner_medical_note: b.partnerMedicalNote || null,
            payment_method: b.paymentMethod || 'other',
            admin_note: b.adminNote || null,
        };

        const { data, error } = await supabase
            .from('enrollments')
            .update(update)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        logger.info(`[admin] ${req.admin.username} updated manual enrollment ${data.enrollment_id}`);
        return res.json({ enrollment: data });
    } catch (err) {
        logger.error(`[admin] updateManualEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update enrollment.' });
    }
}

// ── POST /api/admin/enrollments/:id/send-email ──────────────────────────────
// body: { type: 'customer' | 'coach' | 'both' }  — default 'customer'
export async function sendEnrollmentEmail(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data: row, error } = await supabase
            .from('enrollments')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !row) return res.status(404).json({ error: 'Enrollment not found.' });

        const type = req.body?.type || 'customer';
        if ((type === 'customer' || type === 'both') && !row.customer_email) {
            return res.status(400).json({ error: 'This enrollment has no customer email on file.' });
        }

        if (!config.email.gmailUser || !config.email.gmailAppPassword) {
            return res.status(500).json({ error: 'Email is not configured on the server.' });
        }

        const transporter = getTransporter();
        const templateData = toTemplateData(row);
        const coachEmail = config.email.coachEmail || config.email.gmailUser;
        const sent = [];

        if (type === 'customer' || type === 'both') {
            const { subject, html } = renderTemplate('enrollment_customer', templateData);
            await transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: row.customer_email,
                replyTo: coachEmail,
                subject,
                html,
            });
            sent.push('customer');
        }

        if (type === 'coach' || type === 'both') {
            const { subject, html } = renderTemplate('enrollment_coach', templateData);
            await transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: coachEmail,
                subject,
                html,
            });
            sent.push('coach');
        }

        logger.info(`[admin] ${req.admin.username} manually sent enrollment email(s) [${sent.join(', ')}] for ${row.enrollment_id}`);
        return res.json({ success: true, sent });
    } catch (err) {
        logger.error(`[admin] sendEnrollmentEmail failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to send email.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/follow-ups ────────────────────────────────────────────────
// Query params: due ('true' = only overdue/today), search, page, pageSize
export async function listFollowUps(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { due, search = '', page = 1, pageSize = 50 } = req.query;
        const pg = Math.max(1, parseInt(page, 10) || 1);
        const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 50));

        let query = supabase
            .from('enrollments')
            .select('*', { count: 'exact' })
            .eq('followup_status', 'active')
            .eq('payment_status', 'paid')
            .not('next_followup_at', 'is', null);

        if (due === 'true') {
            query = query.lte('next_followup_at', new Date().toISOString());
        }
        if (search.trim()) {
            const s = search.trim().replace(/[%,]/g, '');
            query = query.or(`customer_name.ilike.%${s}%,customer_email.ilike.%${s}%,enrollment_id.ilike.%${s}%`);
        }

        query = query.order('next_followup_at', { ascending: true }).range((pg - 1) * ps, pg * ps - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        return res.json({ rows: data || [], total: count || 0, page: pg, pageSize: ps });
    } catch (err) {
        logger.error(`[admin] listFollowUps failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load follow-ups.' });
    }
}

// ── GET /api/admin/follow-ups/count ──────────────────────────────────────────
export async function followUpsDueCount(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { count, error } = await supabase
            .from('enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('followup_status', 'active')
            .eq('payment_status', 'paid')
            .lte('next_followup_at', new Date().toISOString());

        if (error) throw error;
        return res.json({ count: count || 0 });
    } catch (err) {
        logger.error(`[admin] followUpsDueCount failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load follow-up count.' });
    }
}

// ── POST /api/admin/enrollments/:id/followup ─────────────────────────────────
// body: { action: 'completed' | 'snoozed' | 'stopped', note?, days? }
export async function markFollowUp(req, res) {
    try {
        const { action, note, days } = req.body || {};
        if (!['completed', 'snoozed', 'stopped'].includes(action)) {
            return res.status(400).json({ error: 'action must be completed, snoozed, or stopped.' });
        }

        const supabase = getSupabaseAdmin();
        const now = new Date();
        let update = {};
        let nextDueAt = null;

        if (action === 'stopped') {
            update = { followup_status: 'stopped', next_followup_at: null };
        } else {
            const addDays = action === 'snoozed' ? (Number(days) || 7) : 7;
            nextDueAt = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000).toISOString();
            update = {
                last_followup_at: action === 'completed' ? now.toISOString() : undefined,
                next_followup_at: nextDueAt,
                followup_status: 'active',
            };
        }

        const { data, error } = await supabase
            .from('enrollments')
            .update(update)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error || !data) return res.status(404).json({ error: 'Enrollment not found.' });

        await supabase.from('follow_ups').insert([{
            enrollment_id: req.params.id,
            note: note || null,
            action,
            next_due_at: nextDueAt,
            created_by: req.admin.id,
        }]);

        logger.info(`[admin] ${req.admin.username} logged follow-up "${action}" for ${data.enrollment_id}`);
        return res.json({ enrollment: data });
    } catch (err) {
        logger.error(`[admin] markFollowUp failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update follow-up.' });
    }
}