/**
 * src/controllers/manualEnrollmentController.js
 *
 * Manual enrollment entry (friends/direct-transfer clients who never hit the
 * website), on-demand enrollment emails, the 7-day follow-up system, and
 * the payment ledger (partial payments / balance-due reminders).
 */
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { getTransporter } from './emailController.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { recordPayment, getPaymentsForEnrollment, listOutstandingBalances, recomputeEnrollmentTotals, upsertLatestPayment, deleteEnrollmentWithPayments } from '../services/paymentLedgerService.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import { fetchPdfAttachment, DEFAULT_RESOURCE_VAULT_PDF_URL } from '../services/pdfAttachmentService.js';
import { generatePaymentReceiptBuffer } from '../services/paymentReceiptService.js';
import { toTitleCase } from '../utils/textFormat.js';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function generateEnrollmentId() {
    const year = new Date().getFullYear();
    const random = Math.floor(100000 + Math.random() * 900000);
    return `FIT-${year}-${random}`;
}

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
        totalAmount: row.total_amount,
        balanceDue: row.balance_due,
    };
}

export const ENROLLMENT_EMAIL_TEMPLATES = {
    enrollment_customer: { recipient: 'customer', label: 'Enrollment Confirmation' },
    welcome: { recipient: 'customer', label: 'Welcome / Onboarding' },
    resource_vault: { recipient: 'customer', label: 'Comeback Blueprint Resources' }, // ← new
    payment_reminder: { recipient: 'customer', label: 'Payment Reminder' },
    payment_failed: { recipient: 'customer', label: 'Payment Failed Notice' },
    balance_due_reminder: { recipient: 'customer', label: 'Balance Due Reminder' },
    enrollment_coach: { recipient: 'coach', label: 'New Enrollment Alert (Coach)' },
};

// ── POST /api/admin/enrollments/manual ───────────────────────────────────────
// Always writes through the ledger — amount_paid is never hand-typed, it's
// the sum of recorded payments. Supports partial payment at creation time
// via initialPaymentAmount (defaults to the full totalAmount).
export async function createManualEnrollment(req, res) {
    try {
        const b = req.body || {};
        if (!b.customerName || !b.programName || b.totalAmount == null) {
            return res.status(400).json({ error: 'customerName, programName and totalAmount are required.' });
        }

        const supabase = getSupabaseAdmin();
        const paymentDate = b.paymentDate ? new Date(b.paymentDate).toISOString() : new Date().toISOString();
        const totalAmount = Number(b.totalAmount);
        const initialPayment = b.initialPaymentAmount != null && b.initialPaymentAmount !== ''
            ? Number(b.initialPaymentAmount)
            : totalAmount;

        const row = {
            enrollment_id: generateEnrollmentId(),
            customer_name: toTitleCase(b.customerName),
            customer_email: b.customerEmail || null,
            customer_phone: b.customerPhone || null,
            program_name: b.programName,
            plan_type: b.planType || 'individual',
            coaching_type: b.coachingType || 'online',
            duration_months: b.durationMonths || null,
            amount_paid: 0,
            original_amount: b.originalAmount != null ? Number(b.originalAmount) : totalAmount,
            total_amount: totalAmount,
            balance_due: totalAmount,
            payment_plan_status: 'pending',
            coupon_code: b.couponCode || null,
            coupon_savings: b.couponSavings ? Number(b.couponSavings) : 0,
            razorpay_order_id: null,
            razorpay_payment_id: null,
            payment_date: null,
            payment_status: 'pending',
            age: b.age || null,
            city: b.city || null,
            weight: b.weight || null,
            goals: Array.isArray(b.goals) ? b.goals : (b.goals ? [b.goals] : []),
            medical_issue: b.medicalIssue || null,
            medical_note: b.medicalNote || null,
            partner_name: b.partnerName ? toTitleCase(b.partnerName) : null,
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
        if (error?.code === '23505') {
            row.enrollment_id = generateEnrollmentId();
            ({ data, error } = await supabase.from('enrollments').insert([row]).select().single());
        }
        if (error) throw error;

        let final = data;
        if (initialPayment > 0) {
            final = await recordPayment({
                enrollmentId: data.id,
                amount: initialPayment,
                method: b.paymentMethod || 'other',
                reference: b.paymentReference || null,
                note: b.adminNote || null,
                recordedBy: req.admin.id,
                paidAt: paymentDate,
            });
        }

        logger.info(`[admin] ${req.admin.username} created manual enrollment ${final.enrollment_id}`);
        return res.status(201).json({ enrollment: final });
    } catch (err) {
        logger.error(`[admin] createManualEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to create manual enrollment.' });
    }
}

// ── PATCH /api/admin/enrollments/manual/:id ──────────────────────────────────
export async function updateManualEnrollment(req, res) {
    try {
        const b = req.body || {};
        if (!b.customerName || !b.programName || b.totalAmount == null) {
            return res.status(400).json({ error: 'customerName, programName and totalAmount are required.' });
        }

        const supabase = getSupabaseAdmin();
        const { data: existing, error: fetchErr } = await supabase
            .from('enrollments').select('id').eq('id', req.params.id).single();
        if (fetchErr || !existing) return res.status(404).json({ error: 'Enrollment not found.' });

        const update = {
            customer_name: toTitleCase(b.customerName),
            customer_email: b.customerEmail || null,
            customer_phone: b.customerPhone || null,
            program_name: b.programName,
            plan_type: b.planType || 'individual',
            coaching_type: b.coachingType || 'online',
            duration_months: b.durationMonths || null,
            total_amount: Number(b.totalAmount),
            original_amount: b.originalAmount != null ? Number(b.originalAmount) : Number(b.totalAmount),
            coupon_code: b.couponCode || null,
            coupon_savings: b.couponSavings ? Number(b.couponSavings) : 0,
            age: b.age || null,
            city: b.city || null,
            weight: b.weight || null,
            goals: Array.isArray(b.goals) ? b.goals : (b.goals ? [b.goals] : []),
            medical_issue: b.medicalIssue || null,
            medical_note: b.medicalNote || null,
            partner_name: b.partnerName ? toTitleCase(b.partnerName) : null,
            partner_age: b.partnerAge || null,
            partner_weight: b.partnerWeight || null,
            partner_goals: Array.isArray(b.partnerGoals) ? b.partnerGoals : (b.partnerGoals ? [b.partnerGoals] : null),
            partner_medical_issue: b.partnerMedicalIssue || null,
            partner_medical_note: b.partnerMedicalNote || null,
            payment_method: b.paymentMethod || 'other',
            admin_note: b.adminNote || null,
        };

        const { error } = await supabase.from('enrollments').update(update).eq('id', req.params.id);
        if (error) throw error;

        // ── Edit the payment ledger — lets the admin correct the amount,
        // method, reference or date of the most recent payment (or record
        // the very first payment if none exists yet). Previously these
        // fields were accepted by this endpoint and silently discarded.
        if (b.paymentAmount !== undefined || b.paymentMethod !== undefined || b.paymentReference !== undefined || b.paymentDate !== undefined) {
            await upsertLatestPayment({
                enrollmentId: req.params.id,
                amount: b.paymentAmount !== undefined && b.paymentAmount !== '' ? Number(b.paymentAmount) : undefined,
                method: b.paymentMethod || undefined,
                reference: b.paymentReference !== undefined ? b.paymentReference : undefined,
                paidAt: b.paymentDate || undefined,
                recordedBy: req.admin.id,
            });
        }

        const final = await recomputeEnrollmentTotals(req.params.id);
        logger.info(`[admin] ${req.admin.username} updated manual enrollment ${final.enrollment_id}`);
        return res.json({ enrollment: final });
    } catch (err) {
        logger.error(`[admin] updateManualEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to update enrollment.' });
    }
}

// ── DELETE /api/admin/enrollments/manual/:id ──────────────────────────────
export async function deleteManualEnrollment(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data: existing, error: fetchErr } = await supabase
            .from('enrollments').select('id, enrollment_id, customer_name').eq('id', req.params.id).single();
        if (fetchErr || !existing) return res.status(404).json({ error: 'Enrollment not found.' });

        const { data, error } = await supabase
            .from('enrollments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;

        logger.info(`[admin] ${req.admin.username} soft-deleted enrollment ${existing.enrollment_id} (${existing.customer_name})`);
        return res.json({ success: true, enrollment: data });
    } catch (err) {
        logger.error(`[admin] deleteManualEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: err.message || 'Failed to delete enrollment.' });
    }
}

// ── GET /api/admin/enrollments/search?query=... ───────────────────────────────
// Searches ACROSS ALL sources (website + manual). Use this before creating a
// manual entry — if a matching pending row already exists, record the
// payment against it instead of creating a duplicate. This is the fix for
// the revenue mismatch.
export async function searchEnrollmentsByContact(req, res) {
    try {
        const q = (req.query.query || '').trim();
        if (!q) return res.json({ rows: [] });
        const supabase = getSupabaseAdmin();
        const s = q.replace(/[%,]/g, '');
        const { data, error } = await supabase
            .from('enrollments')
            .select('*')
            .is('deleted_at', null)
            .or(`customer_name.ilike.%${s}%,customer_email.ilike.%${s}%,customer_phone.ilike.%${s}%,enrollment_id.ilike.%${s}%`)
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) throw error;
        return res.json({ rows: data || [] });
    } catch (err) {
        logger.error(`[admin] searchEnrollmentsByContact failed: ${err.message}`);
        return res.status(500).json({ error: 'Search failed.' });
    }
}

// ── GET /api/admin/enrollments/:id/payments ───────────────────────────────────
export async function getEnrollmentPayments(req, res) {
    try {
        const rows = await getPaymentsForEnrollment(req.params.id);
        return res.json({ payments: rows });
    } catch (err) {
        logger.error(`[admin] getEnrollmentPayments failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load payments.' });
    }
}

// ── POST /api/admin/enrollments/:id/payments ──────────────────────────────────
// body: { amount, method, reference, note, paidAt }
export async function addEnrollmentPayment(req, res) {
    try {
        const { amount, method, reference, note, paidAt } = req.body || {};
        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ error: 'A positive amount is required.' });
        }
        const enrollment = await recordPayment({
            enrollmentId: req.params.id,
            amount, method, reference, note, paidAt,
            recordedBy: req.admin.id,
        });
        logger.info(`[admin] ${req.admin.username} recorded payment of ${amount} for ${enrollment.enrollment_id}`);
        return res.status(201).json({ enrollment });
    } catch (err) {
        logger.error(`[admin] addEnrollmentPayment failed: ${err.message}`);
        return res.status(400).json({ error: err.message || 'Failed to record payment.' });
    }
}

// ── GET /api/admin/balance-due ────────────────────────────────────────────────
export async function listBalanceDue(req, res) {
    try {
        const dueOnly = req.query.due === 'true';
        const rows = await listOutstandingBalances({ dueOnly });
        return res.json({ rows, total: rows.length });
    } catch (err) {
        logger.error(`[admin] listBalanceDue failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load outstanding balances.' });
    }
}

// ── POST /api/admin/enrollments/:id/send-balance-reminder ─────────────────────
export async function sendBalanceReminder(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data: row, error } = await supabase.from('enrollments').select('*').eq('id', req.params.id).single();
        if (error || !row) return res.status(404).json({ error: 'Enrollment not found.' });
        if (!row.customer_email) return res.status(400).json({ error: 'This enrollment has no customer email on file.' });
        if (!(Number(row.balance_due) > 0)) return res.status(400).json({ error: 'This enrollment has no outstanding balance.' });

        if (!config.email.gmailUser || !config.email.gmailAppPassword) {
            return res.status(500).json({ error: 'Email is not configured on the server.' });
        }

        const transporter = getTransporter();
        const coachEmail = config.email.coachEmail || config.email.gmailUser;
        const { subject, html } = renderTemplate('balance_due_reminder', toTemplateData(row));

        await transporter.sendMail({
            from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
            to: row.customer_email,
            replyTo: coachEmail,
            subject, html,
        });

        await supabase.from('enrollments').update({
            last_payment_reminder_at: new Date().toISOString(),
            next_payment_reminder_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        }).eq('id', req.params.id);

        logger.info(`[admin] ${req.admin.username} sent balance reminder for ${row.enrollment_id}`);
        return res.json({ success: true });
    } catch (err) {
        logger.error(`[admin] sendBalanceReminder failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to send reminder.' });
    }
}


// ── POST /api/admin/enrollments/:id/payments/:paymentId/send-receipt ─────────
// Emails a PDF receipt for ONE specific payment/installment on this
// enrollment. Works identically whether the enrollment came from the
// website checkout or was entered manually — both live in the same
// enrollments + enrollment_payments tables.
export async function sendPaymentReceiptEmail(req, res) {
    try {
        const supabase = getSupabaseAdmin();

        const { data: enrollment, error: eErr } = await supabase
            .from('enrollments').select('*').eq('id', req.params.id).single();
        if (eErr || !enrollment) return res.status(404).json({ error: 'Enrollment not found.' });
        if (!enrollment.customer_email) {
            return res.status(400).json({ error: 'This enrollment has no customer email on file.' });
        }

        const { data: payment, error: pErr } = await supabase
            .from('enrollment_payments')
            .select('*')
            .eq('id', req.params.paymentId)
            .eq('enrollment_id', req.params.id)
            .single();
        if (pErr || !payment) return res.status(404).json({ error: 'Payment not found.' });

        // Sum every payment up to and including this one (ledger is
        // chronological) so the receipt shows an accurate running balance
        // even if this isn't the most recent payment.
        const { data: allPayments, error: apErr } = await supabase
            .from('enrollment_payments')
            .select('id, amount, paid_at')
            .eq('enrollment_id', req.params.id)
            .order('paid_at', { ascending: true });
        if (apErr) throw apErr;

        const idx = (allPayments || []).findIndex((p) => p.id === payment.id);
        const paidToDate = (allPayments || [])
            .slice(0, idx === -1 ? allPayments.length : idx + 1)
            .reduce((s, p) => s + Number(p.amount || 0), 0);

        if (!config.email.gmailUser || !config.email.gmailAppPassword) {
            return res.status(500).json({ error: 'Email is not configured on the server.' });
        }

        const buffer = await generatePaymentReceiptBuffer(enrollment, payment, paidToDate);
        const transporter = getTransporter();
        const coachEmail = config.email.coachEmail || config.email.gmailUser;

        const totalAmount = Number(enrollment.total_amount ?? enrollment.amount_paid ?? 0);
        const balanceDue = Math.max(0, totalAmount - paidToDate);

        const { subject, html } = renderTemplate('payment_receipt_email', {
            customerName: enrollment.customer_name,
            programName: enrollment.program_name,
            amountPaid: payment.amount,
            paidToDate,
            totalAmount,
            balanceDue,
            paymentDate: payment.paid_at,
            method: payment.method,
            reference: payment.reference,
            enrollmentId: enrollment.enrollment_id,
        });

        await transporter.sendMail({
            from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
            to: enrollment.customer_email,
            replyTo: coachEmail,
            subject,
            html,
            attachments: [{
                filename: `RECODE-Receipt-${enrollment.enrollment_id}.pdf`,
                content: buffer,
                contentType: 'application/pdf',
            }],
        });

        logger.info(`[admin] ${req.admin.username} emailed payment receipt for ${enrollment.enrollment_id} (payment ${payment.id})`);
        return res.json({ success: true });
    } catch (err) {
        logger.error(`[admin] sendPaymentReceiptEmail failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to send receipt email.' });
    }
}

// ── POST /api/admin/enrollments/:id/send-email (unchanged) ───────────────────
export async function sendEnrollmentEmail(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data: row, error } = await supabase
            .from('enrollments')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !row) return res.status(404).json({ error: 'Enrollment not found.' });

        let templates = [];

        if (req.body?.template) {
            const tmpl = req.body.template;
            if (!ENROLLMENT_EMAIL_TEMPLATES[tmpl]) {
                return res.status(400).json({
                    error: `Unknown template "${tmpl}". Valid: ${Object.keys(ENROLLMENT_EMAIL_TEMPLATES).join(', ')}`,
                });
            }
            templates = [tmpl];
        } else {
            const type = req.body?.type || 'customer';
            if (type === 'customer') templates = ['enrollment_customer'];
            else if (type === 'coach') templates = ['enrollment_coach'];
            else if (type === 'both') templates = ['enrollment_customer', 'enrollment_coach'];
        }

        if (!templates.length) {
            return res.status(400).json({ error: 'No valid template resolved from request.' });
        }

        const needsCustomerEmail = templates.some((t) => ENROLLMENT_EMAIL_TEMPLATES[t].recipient === 'customer');
        if (needsCustomerEmail && !row.customer_email) {
            return res.status(400).json({ error: 'This enrollment has no customer email on file.' });
        }

        if (!config.email.gmailUser || !config.email.gmailAppPassword) {
            return res.status(500).json({ error: 'Email is not configured on the server.' });
        }

        const transporter = getTransporter();
        const templateData = toTemplateData(row);
        const coachEmail = config.email.coachEmail || config.email.gmailUser;
        const sent = [];

        for (const tmpl of templates) {
            const { html: rawHtml, subject } = renderTemplate(tmpl, templateData);
            const recipient = ENROLLMENT_EMAIL_TEMPLATES[tmpl].recipient === 'coach' ? coachEmail : row.customer_email;

            let attachments = [];
            let html = rawHtml;
            if (tmpl === 'resource_vault') {
                const pdfUrl = req.body?.pdfUrl || process.env.RESOURCE_VAULT_PDF_URL || DEFAULT_RESOURCE_VAULT_PDF_URL;
                const attachment = await fetchPdfAttachment(pdfUrl, 'RECODE-Comeback-Blueprint.pdf');
                if (attachment) {
                    attachments = [attachment];
                    // Re-render with hasAttachment so the "PDF attached" note shows correctly
                    html = renderTemplate(tmpl, { ...templateData, hasAttachment: true }).html;
                }
            }

            await transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: recipient,
                replyTo: coachEmail,
                subject,
                html,
                attachments,
            });
            sent.push(tmpl);
        }

        logger.info(`[admin] ${req.admin.username} manually sent [${sent.join(', ')}] for ${row.enrollment_id}`);
        return res.json({ success: true, sent });
    } catch (err) {
        logger.error(`[admin] sendEnrollmentEmail failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to send email.' });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS (unchanged)
// ════════════════════════════════════════════════════════════════════════════

export async function listFollowUps(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { due, search = '', page = 1, pageSize = 50 } = req.query;
        const pg = Math.max(1, parseInt(page, 10) || 1);
        const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 50));

        let query = supabase
            .from('enrollments')
            .select('*', { count: 'exact' })
            .is('deleted_at', null)
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

export async function followUpsDueCount(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { count, error } = await supabase
            .from('enrollments')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
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