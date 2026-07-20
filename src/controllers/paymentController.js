import { createRazorpayOrder, verifyPaymentSignature, fetchRazorpayPayment } from '../utils/razorpay.js';
import { validateVerifyPayment, validateCreateOrder } from '../utils/validate.js';
import { resolvePrice } from '../data/serverPricing.js';
import { validateCouponCode, incrementCouponUsage } from '../services/couponService.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { getTransporter } from './emailController.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { logTxnStep } from '../services/txnLogService.js';
import { generateEnrollmentId } from '../utils/enrollmentId.js';
import { waitUntil } from '@vercel/functions';
import { generatePaymentReceiptBuffer } from '../services/paymentReceiptService.js';
// ── POST /api/create-order ────────────────────────────────────────────────
// Client no longer sends `amount` — the server resolves the real price and
// validates any coupon. This is what stops price tampering: the client
// cannot influence the charged amount.
export async function createOrder(req, res, next) {
    const {
        coachingType, planType, durationMonths, couponCode, receipt = `rcpt_${Date.now()}`,
        customerName, customerEmail, customerPhone, programName,
        age, city, weight, goals, medicalIssue, medicalNote,
        partnerName, partnerAge, partnerWeight, partnerGoals, partnerMedicalIssue, partnerMedicalNote,
    } = req.body;

    try {
        logTxnStep({ step: 'create_order', status: 'started', metadata: { coachingType, planType, durationMonths } });

        const errors = validateCreateOrder(req.body);
        if (errors.length) {
            logTxnStep({ step: 'create_order:validate', status: 'failed', message: errors.join(', ') });
            return res.status(400).json({ error: errors.join(', ') });
        }

        let amountRupees;
        try {
            amountRupees = resolvePrice({ coachingType, planType, durationMonths });
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }

        let originalAmountRupees = amountRupees;
        let appliedCoupon = null;

        if (couponCode) {
            const result = await validateCouponCode({ code: couponCode, coachingType, planType, durationMonths, originalPrice: amountRupees });
            if (!result.valid) return res.status(400).json({ error: result.error });
            amountRupees = result.discountedPrice;
            appliedCoupon = { code: result.coupon.code, savings: result.savings };
        }

        const amountPaise = Math.round(amountRupees * 100);
        const enrollmentId = generateEnrollmentId();

        const order = await createRazorpayOrder({
            amount: amountPaise,
            currency: 'INR',
            receipt,
            notes: {
                coachingType, planType, durationMonths: durationMonths || '',
                couponCode: appliedCoupon?.code || '',
                originalAmountPaise: String(Math.round(originalAmountRupees * 100)),
                enrollmentId,
            },
        });

        // ── Write the pending row now — this is the row the payment will later update ──
        const supabase = getSupabaseAdmin();
        const pendingRow = {
            enrollment_id: enrollmentId,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone || null,
            program_name: programName || null,
            plan_type: planType,
            coaching_type: coachingType,
            duration_months: durationMonths || null,
            amount_paid: amountRupees,          // expected amount; overwritten with the real captured amount later
            original_amount: originalAmountRupees,
            coupon_code: appliedCoupon?.code || null,
            coupon_savings: appliedCoupon?.savings || 0,
            razorpay_order_id: order.id,
            razorpay_payment_id: null,
            payment_date: null,
            payment_status: 'pending',
            age: age || null,
            city: city || null,
            weight: weight || null,
            goals: goals || [],
            medical_issue: medicalIssue || null,
            medical_note: medicalNote || null,
            partner_name: partnerName || null,
            partner_age: partnerAge || null,
            partner_weight: partnerWeight || null,
            partner_goals: partnerGoals?.length ? partnerGoals : null,
            partner_medical_issue: partnerMedicalIssue || null,
            partner_medical_note: partnerMedicalNote || null,
            source: 'website',
            followup_status: 'active',
            next_followup_at: null,
        };

        const { error: insertErr } = await supabase.from('enrollments').insert([pendingRow]);
        if (insertErr) {
            logger.error(`[create-order] ❌ pending row insert failed: ${insertErr.message}`);
            logTxnStep({ orderId: order.id, step: 'create_order:pending_insert', status: 'failed', message: insertErr.message });
            // Don't let the customer pay if we can't even track it
            return res.status(500).json({ error: 'Could not initialize enrollment. Please try again.' });
        }

        logTxnStep({ orderId: order.id, enrollmentId, step: 'create_order', status: 'success' });

        return res.status(201).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            couponApplied: appliedCoupon,
            enrollmentId,
        });
    } catch (err) {
        logger.error(`[create-order] FAILED — ${err.message}`);
        logTxnStep({ step: 'create_order', status: 'failed', message: err.message });
        next(err);
    }
}

// ── POST /api/confirm-payment ──────────────────────────────────────────────
// One call: verify signature → confirm capture with Razorpay → flip the
// pending row to paid → respond → send emails in the background.
// Replaces the old separate /verify-payment + /create-enrollment sequence.
export async function confirmPayment(req, res, next) {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature } = req.body || {};

    try {
        const errors = validateVerifyPayment(req.body);
        if (errors.length) {
            logTxnStep({ step: 'confirm_payment:validate', status: 'failed', message: errors.join(', ') });
            return res.status(400).json({ error: errors.join(', ') });
        }

        logTxnStep({ orderId: oid, paymentId: pid, step: 'confirm_payment', status: 'started' });

        const isValid = verifyPaymentSignature({ orderId: oid, paymentId: pid, signature: razorpay_signature });
        if (!isValid) {
            logger.warn(`[confirm-payment] SIGNATURE MISMATCH — order=${oid}`);
            logTxnStep({ orderId: oid, paymentId: pid, step: 'confirm_payment:signature', status: 'failed', message: 'signature mismatch' });
            return res.status(400).json({ success: false, error: 'Signature mismatch — payment not verified.' });
        }

        const payment = await fetchRazorpayPayment(pid);

        if (payment.status !== 'captured') {
            return res.status(400).json({ error: 'Payment has not been captured.' });
        }
        if (payment.order_id !== oid) {
            return res.status(400).json({ error: 'Payment/order mismatch.' });
        }

        const supabase = getSupabaseAdmin();

        // Update the PENDING row → paid. Guard on payment_status='pending' so a
        // webhook that already processed this order doesn't get double-applied.
        const { data, error } = await supabase
            .from('enrollments')
            .update({
                amount_paid: payment.amount / 100,
                razorpay_payment_id: pid,
                payment_date: new Date(payment.created_at * 1000).toISOString(),
                total_amount: payment.amount / 100, balance_due: 0,
                payment_plan_status: 'full',
                payment_status: 'paid',
                next_followup_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('razorpay_order_id', oid)
            .eq('payment_status', 'pending')
            .select()
            .maybeSingle();

        if (error) {
            logger.error(`[confirm-payment] update failed: ${error.message}`);
            logTxnStep({ orderId: oid, paymentId: pid, step: 'confirm_payment:db_update', status: 'failed', message: error.message });
            return res.status(500).json({ error: 'Failed to finalize enrollment. Please contact support with your payment ID.' });
        }

        if (!data) {
            // Either the webhook already finished this, or the pending row is missing entirely.
            const { data: existing } = await supabase.from('enrollments').select('*').eq('razorpay_order_id', oid).maybeSingle();
            if (existing?.payment_status === 'paid') {
                return res.json({ success: true, enrollment: existing, alreadyProcessed: true });
            }
            logger.error(`[confirm-payment] 🚨 no pending row found for order=${oid}`);
            logTxnStep({ orderId: oid, paymentId: pid, step: 'confirm_payment:db_update', status: 'failed', message: 'pending row not found' });
            return res.status(404).json({ error: 'Enrollment record not found. Please contact support with your payment ID.' });
        }

        logger.info(`[confirm-payment] ✅ CONFIRMED — ${data.enrollment_id}`);
        logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'confirm_payment:db_update', status: 'success' });

        // Coupon usage is tracked here, right after the DB write succeeds —
        // deliberately NOT inside sendEnrollmentConfirmation(), so a missing
        // email config (or an email failure) can never silently skip
        // recording that a coupon was used on a real, paid enrollment.
        if (data.coupon_code) {
            incrementCouponUsage(data.coupon_code).catch((e) => {
                logger.error(`[confirm-payment] ⚠️ coupon usage increment failed for ${data.coupon_code}: ${e.message}`);
                logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'confirm_payment:coupon_increment', status: 'failed', message: e.message });
            });
        }

        // Respond immediately — email/PDF happen after

        supabase.from('enrollment_payments').insert([{
            enrollment_id: data.id,
            amount: data.amount_paid,
            method: 'razorpay',
            reference: data.razorpay_payment_id,
            paid_at: data.payment_date,
        }]).then(({ error: ledgerErr }) => {
            if (ledgerErr) {
                logger.warn(`[confirm-payment] ledger insert failed: ${ledgerErr.message}`);
                logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'confirm_payment:ledger_insert', status: 'failed', message: ledgerErr.message });
            }
        }).catch((e) => {
            logger.warn(`[confirm-payment] ledger insert threw: ${e.message}`);
            logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'confirm_payment:ledger_insert', status: 'failed', message: e.message });
        });


        res.status(201).json({ success: true, enrollment: data });

        waitUntil(sendEnrollmentConfirmation(data).catch((e) => {
            logger.error(`[confirm-payment] email dispatch failed: ${e.message}`);
            return logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'confirm_payment:emails', status: 'failed', message: e.message });
        }));
    } catch (err) {
        logger.error(`[confirm-payment] FAILED — ${err.message}`);
        if (!res.headersSent) next(err);
    }
}

export async function sendEnrollmentConfirmation(row) {

    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
        logger.warn(`[confirm-payment] Skipped confirmation emails for ${row.enrollment_id} — GMAIL_USER / GMAIL_APP_PASSWORD not set.`);
        logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'confirm_payment:emails', status: 'warning',
            message: 'skipped — GMAIL_USER / GMAIL_APP_PASSWORD not set',
        });
        return;
    }

    logger.info(`[confirm-payment] Dispatching confirmation emails for ${row.enrollment_id} → coach + ${row.customer_email || 'no customer email'}`);

    const transporter = getTransporter();
    const coachEmail = config.email.coachEmail || config.email.gmailUser;

    const templateData = {
        enrollmentId: row.enrollment_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone,
        programName: row.program_name,
        planType: row.plan_type,
        coachingType: row.coaching_type,
        durationMonths: row.duration_months,
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

    let invoiceAttachment = [];
    try {
        const buffer = await generateInvoiceBuffer(templateData);
        invoiceAttachment = [{
            filename: `RECODE-Invoice-${row.enrollment_id}.pdf`,
            content: buffer,
            contentType: 'application/pdf',
        }];
    } catch (e) {
        logger.warn(`[confirm-payment] invoice generation failed for ${row.enrollment_id}: ${e.message}`);
        logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'confirm_payment:invoice_pdf', status: 'failed', message: e.message,
        });
    }

    const coachMail = renderTemplate('enrollment_coach', templateData);
    const customerMail = renderTemplate('enrollment_customer', templateData);

    const [coachResult, customerResult] = await Promise.allSettled([
        transporter.sendMail({
            from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
            to: coachEmail, subject: coachMail.subject, html: coachMail.html,
        }),
        row.customer_email
            ? transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: row.customer_email, replyTo: coachEmail,
                subject: customerMail.subject, html: customerMail.html,
                attachments: invoiceAttachment,
            })
            : Promise.resolve('skipped — no customer email on file'),
    ]);

    if (coachResult.status === 'fulfilled') {
        logger.info(`[confirm-payment] ✅ Coach email sent → ${coachEmail} (${row.enrollment_id})`);
        logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'confirm_payment:email_coach', status: 'success',
        });
    } else {
        logger.error(`[confirm-payment] ❌ Coach email FAILED for ${row.enrollment_id}: ${coachResult.reason?.message}`);
        logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'confirm_payment:email_coach', status: 'failed', message: coachResult.reason?.message,
        });
    }

    if (row.customer_email) {
        if (customerResult.status === 'fulfilled') {
            logger.info(`[confirm-payment] ✅ Customer email sent → ${row.customer_email} (${row.enrollment_id})`);
            logTxnStep({
                orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
                step: 'confirm_payment:email_customer', status: 'success',
            });
        } else {
            logger.error(`[confirm-payment] ❌ Customer email FAILED for ${row.enrollment_id}: ${customerResult.reason?.message}`);
            logTxnStep({
                orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
                step: 'confirm_payment:email_customer', status: 'failed', message: customerResult.reason?.message,
            });
        }
    } else {
        logger.info(`[confirm-payment] ℹ️ No customer email on file — skipped for ${row.enrollment_id}`);
    }
}

export function healthCheck(_req, res) {
    res.json({ status: 'ok', env: process.env.NODE_ENV, timestamp: new Date().toISOString() });
}

export async function downloadInvoice(req, res, next) {
    try {
        const enrollment = req.body;
        if (!enrollment?.enrollmentId && !enrollment?.enrollment_id) {
            return res.status(400).json({ error: 'Invalid enrollment data.' });
        }
        const buffer = await generateInvoiceBuffer(enrollment);
        const invoiceId = enrollment.enrollmentId || enrollment.enrollment_id;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="RECODE-Invoice-${invoiceId}.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (err) {
        next(err);
    }
}

// ── POST /api/payment-receipt ─────────────────────────────────────────────
// Stateless, mirrors /api/invoice — the caller (admin panel) already has the
// enrollment + payment data loaded, so no DB lookup is needed here.
// Body: { enrollment, payment, paidToDate }
export async function downloadPaymentReceipt(req, res, next) {
    try {
        const { enrollment, payment, paidToDate } = req.body || {};
        if (!enrollment || !payment || payment.amount == null) {
            return res.status(400).json({ error: 'Invalid receipt data.' });
        }
        const buffer = await generatePaymentReceiptBuffer(enrollment, payment, paidToDate);
        const invoiceId = enrollment.enrollmentId || enrollment.enrollment_id || 'receipt';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="RECODE-Receipt-${invoiceId}.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (err) {
        next(err);
    }
}