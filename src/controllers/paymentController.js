import { createRazorpayOrder, verifyPaymentSignature, fetchRazorpayOrder, fetchRazorpayPayment } from '../utils/razorpay.js';
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
// ── POST /api/create-order ────────────────────────────────────────────────
// CHANGED: client no longer sends `amount`. It sends plan selection; the
// server resolves the real price and validates any coupon. This is the fix
// for price tampering — the client cannot influence the charged amount.
export async function createOrder(req, res, next) {
    const {
        coachingType, planType, durationMonths, couponCode, receipt = `rcpt_${Date.now()}`,
        customerName, customerEmail, customerPhone, programName,
        age, city, weight, goals, medicalIssue, medicalNote,
        partnerName, partnerAge, partnerWeight, partnerGoals, partnerMedicalIssue, partnerMedicalNote,
    } = req.body;

    try {
        await logTxnStep({ step: 'create_order', status: 'started', metadata: { coachingType, planType, durationMonths } });

        const errors = validateCreateOrder(req.body);
        if (errors.length) {
            await logTxnStep({ step: 'create_order:validate', status: 'failed', message: errors.join(', ') });
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
            await logTxnStep({ orderId: order.id, step: 'create_order:pending_insert', status: 'failed', message: insertErr.message });
            // Don't let the customer pay if we can't even track it
            return res.status(500).json({ error: 'Could not initialize enrollment. Please try again.' });
        }

        await logTxnStep({ orderId: order.id, enrollmentId, step: 'create_order', status: 'success' });

        return res.status(201).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            couponApplied: appliedCoupon,
            enrollmentId,
        });
    } catch (err) {
        logger.error(`[create-order] FAILED — ${err.message}`);
        await logTxnStep({ step: 'create_order', status: 'failed', message: err.message });
        next(err);
    }
}


// ── POST /api/verify-payment ──────────────────────────────────────────────
export async function verifyPayment(req, res, next) {
    try {
        const errors = validateVerifyPayment(req.body);
        if (errors.length) {
            await logTxnStep({ step: 'verify_payment:validate', status: 'failed', message: errors.join(', ') });
            return res.status(400).json({ error: errors.join(', ') });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        await logTxnStep({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            step: 'verify_payment',
            status: 'started',
        });

        const isValid = verifyPaymentSignature({
            orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature,
        });

        if (!isValid) {
            logger.warn(`[verify-payment] SIGNATURE MISMATCH — order=${razorpay_order_id}`);
            await logTxnStep({
                orderId: razorpay_order_id,
                paymentId: razorpay_payment_id,
                step: 'verify_payment',
                status: 'failed',
                message: 'signature mismatch',
            });
            return res.status(400).json({ success: false, error: 'Signature mismatch — payment not verified.' });
        }

        await logTxnStep({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            step: 'verify_payment',
            status: 'success',
        });

        return res.json({ success: true, payment_id: razorpay_payment_id });
    } catch (err) {
        await logTxnStep({ step: 'verify_payment', status: 'failed', message: err.message });
        next(err);
    }
}

// ── POST /api/create-enrollment ─────────────────────────────────────────
export async function createEnrollment(req, res, next) {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature } = req.body || {};

    try {
        if (!oid || !pid || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment verification fields.' });
        }

        const isValid = verifyPaymentSignature({ orderId: oid, paymentId: pid, signature: razorpay_signature });
        if (!isValid) {
            await logTxnStep({ orderId: oid, paymentId: pid, step: 'create_enrollment:signature', status: 'failed' });
            return res.status(400).json({ error: 'Payment signature invalid.' });
        }

        const [order, payment] = await Promise.all([fetchRazorpayOrder(oid), fetchRazorpayPayment(pid)]);

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
                payment_status: 'paid',
                next_followup_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('razorpay_order_id', oid)
            .eq('payment_status', 'pending')
            .select()
            .maybeSingle();

        if (error) {
            logger.error(`[create-enrollment] update failed: ${error.message}`);
            await logTxnStep({ orderId: oid, paymentId: pid, step: 'create_enrollment:db_update', status: 'failed', message: error.message });
            return res.status(500).json({ error: 'Failed to finalize enrollment. Please contact support with your payment ID.' });
        }

        if (!data) {
            // Either the webhook already finished this, or the pending row is missing entirely.
            const { data: existing } = await supabase.from('enrollments').select('*').eq('razorpay_order_id', oid).maybeSingle();
            if (existing?.payment_status === 'paid') {
                return res.json({ success: true, enrollment: existing, alreadyProcessed: true });
            }
            logger.error(`[create-enrollment] 🚨 no pending row found for order=${oid}`);
            await logTxnStep({ orderId: oid, paymentId: pid, step: 'create_enrollment:db_update', status: 'failed', message: 'pending row not found' });
            return res.status(404).json({ error: 'Enrollment record not found. Please contact support with your payment ID.' });
        }

        logger.info(`[create-enrollment] ✅ CONFIRMED — ${data.enrollment_id}`);
        await logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'create_enrollment:db_update', status: 'success' });

        // Respond immediately — email/PDF happen after
        res.status(201).json({ success: true, enrollment: data });

        waitUntil(sendEnrollmentConfirmation(data).catch((e) => {
            logger.error(`[create-enrollment] email dispatch failed: ${e.message}`);
            return logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: data.enrollment_id, step: 'create_enrollment:emails', status: 'failed', message: e.message });
        }));
    } catch (err) {
        logger.error(`[create-enrollment] FAILED — ${err.message}`);
        if (!res.headersSent) next(err);
    }
}
export async function sendEnrollmentConfirmation(row) {

    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
        logger.warn(`[create-enrollment] Skipped confirmation emails for ${row.enrollment_id} — GMAIL_USER / GMAIL_APP_PASSWORD not set.`);
        await logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'create_enrollment:emails', status: 'warning',
            message: 'skipped — GMAIL_USER / GMAIL_APP_PASSWORD not set',
        });
        return;
    }

    logger.info(`[create-enrollment] Dispatching confirmation emails for ${row.enrollment_id} → coach + ${row.customer_email || 'no customer email'}`);

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
        logger.warn(`[create-enrollment] invoice generation failed for ${row.enrollment_id}: ${e.message}`);
        await logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'create_enrollment:invoice_pdf', status: 'failed', message: e.message,
        });
    }

    const coachMail = renderTemplate('enrollment_coach', templateData);
    const customerMail = renderTemplate('enrollment_customer', templateData);

    const [coachResult, customerResult, couponResult] = await Promise.allSettled([
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
        row.coupon_code ? incrementCouponUsage(row.coupon_code) : Promise.resolve(),
    ]);

    if (coachResult.status === 'fulfilled') {
        logger.info(`[create-enrollment] ✅ Coach email sent → ${coachEmail} (${row.enrollment_id})`);
        await logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'create_enrollment:email_coach', status: 'success',
        });
    } else {
        logger.error(`[create-enrollment] ❌ Coach email FAILED for ${row.enrollment_id}: ${coachResult.reason?.message}`);
        await logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'create_enrollment:email_coach', status: 'failed', message: coachResult.reason?.message,
        });
    }

    if (row.customer_email) {
        if (customerResult.status === 'fulfilled') {
            logger.info(`[create-enrollment] ✅ Customer email sent → ${row.customer_email} (${row.enrollment_id})`);
            await logTxnStep({
                orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
                step: 'create_enrollment:email_customer', status: 'success',
            });
        } else {
            logger.error(`[create-enrollment] ❌ Customer email FAILED for ${row.enrollment_id}: ${customerResult.reason?.message}`);
            await logTxnStep({
                orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
                step: 'create_enrollment:email_customer', status: 'failed', message: customerResult.reason?.message,
            });
        }
    } else {
        logger.info(`[create-enrollment] ℹ️ No customer email on file — skipped for ${row.enrollment_id}`);
    }

    if (row.coupon_code && couponResult.status === 'rejected') {
        logger.error(`[create-enrollment] ⚠️ Coupon usage increment failed for ${row.coupon_code}: ${couponResult.reason?.message}`);
        await logTxnStep({
            orderId: row.razorpay_order_id, paymentId: row.razorpay_payment_id, enrollmentId: row.enrollment_id,
            step: 'create_enrollment:coupon_increment', status: 'failed', message: couponResult.reason?.message,
        });
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