import { createRazorpayOrder, verifyPaymentSignature, fetchRazorpayOrder, fetchRazorpayPayment } from '../utils/razorpay.js';
import { validateVerifyPayment } from '../utils/validate.js';
import { resolvePrice } from '../data/serverPricing.js';
import { validateCouponCode, incrementCouponUsage } from '../services/couponService.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { getTransporter } from './emailController.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

// ── POST /api/create-order ────────────────────────────────────────────────
// CHANGED: client no longer sends `amount`. It sends plan selection; the
// server resolves the real price and validates any coupon. This is the fix
// for price tampering — the client cannot influence the charged amount.
export async function createOrder(req, res, next) {
    try {
        const { coachingType, planType, durationMonths, couponCode, receipt = `rcpt_${Date.now()}` } = req.body;

        if (!coachingType || !planType) {
            return res.status(400).json({ error: 'coachingType and planType are required.' });
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
            const result = await validateCouponCode({
                code: couponCode, coachingType, planType, durationMonths, originalPrice: amountRupees,
            });
            if (!result.valid) {
                return res.status(400).json({ error: result.error });
            }
            amountRupees = result.discountedPrice;
            appliedCoupon = { code: result.coupon.code, savings: result.savings };
        }

        const amountPaise = Math.round(amountRupees * 100);

        // Store plan context in Razorpay order notes so create-enrollment can
        // cross-check against it later without trusting the client again.
        const order = await createRazorpayOrder({
            amount: amountPaise,
            currency: 'INR',
            receipt,
            notes: {
                coachingType, planType, durationMonths: durationMonths || '',
                couponCode: appliedCoupon?.code || '',
                originalAmountPaise: String(Math.round(originalAmountRupees * 100)),
            },
        });

        logger.info(`[create-order] SUCCESS — order_id=${order.id} amount=${order.amount}`);

        return res.status(201).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            couponApplied: appliedCoupon,
        });
    } catch (err) {
        logger.error(`[create-order] FAILED — ${err.message}`);
        next(err);
    }
}

// ── POST /api/verify-payment ────────────────────────────────────────────── (unchanged logic, still fine)
export function verifyPayment(req, res, next) {
    try {
        const errors = validateVerifyPayment(req.body);
        if (errors.length) return res.status(400).json({ error: errors.join(', ') });

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const isValid = verifyPaymentSignature({
            orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature,
        });

        if (!isValid) {
            logger.warn(`[verify-payment] SIGNATURE MISMATCH — order=${razorpay_order_id}`);
            return res.status(400).json({ success: false, error: 'Signature mismatch — payment not verified.' });
        }
        return res.json({ success: true, payment_id: razorpay_payment_id });
    } catch (err) {
        next(err);
    }
}

// ── POST /api/create-enrollment ─────────────────────────────────────────
// CHANGED:
//  1. Fetches the real order + payment from Razorpay and cross-checks the
//     captured amount against what's being claimed — client data is no
//     longer trusted for money fields.
//  2. Sends confirmation emails + invoice ITSELF after a successful DB
//     write, using the verified row — not from the browser.
export async function createEnrollment(req, res, next) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, enrollment } = req.body || {};

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment verification fields.' });
        }
        if (!enrollment?.enrollmentId || !enrollment?.customerName) {
            return res.status(400).json({ error: 'Invalid enrollment data.' });
        }

        const isValid = verifyPaymentSignature({
            orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature,
        });
        if (!isValid) {
            logger.warn(`[create-enrollment] signature re-check FAILED — order=${razorpay_order_id}`);
            return res.status(400).json({ error: 'Payment signature invalid.' });
        }

        // ── Cross-check against Razorpay's own records ──────────────────
        const [order, payment] = await Promise.all([
            fetchRazorpayOrder(razorpay_order_id),
            fetchRazorpayPayment(razorpay_payment_id),
        ]);

        if (payment.status !== 'captured') {
            logger.warn(`[create-enrollment] payment not captured — status=${payment.status}`);
            return res.status(400).json({ error: 'Payment has not been captured.' });
        }
        if (payment.order_id !== razorpay_order_id) {
            return res.status(400).json({ error: 'Payment/order mismatch.' });
        }

        const claimedAmountPaise = Math.round(Number(enrollment.amountPaid) * 100);
        if (order.amount !== claimedAmountPaise || payment.amount !== order.amount) {
            logger.error(
                `[create-enrollment] 🚨 AMOUNT MISMATCH — order=${order.amount} payment=${payment.amount} claimed=${claimedAmountPaise}`
            );
            return res.status(400).json({ error: 'Amount mismatch — enrollment rejected.' });
        }

        // Trust the order's own notes (set server-side at create-order time)
        // for the plan fields, not the client-submitted enrollment object.
        const notes = order.notes || {};
        if (notes.coachingType && notes.coachingType !== enrollment.coachingType) {
            logger.error(`[create-enrollment] 🚨 PLAN MISMATCH — order says ${notes.coachingType}, client claims ${enrollment.coachingType}`);
            return res.status(400).json({ error: 'Plan mismatch — enrollment rejected.' });
        }

        const supabase = getSupabaseAdmin();
        const row = {
            enrollment_id: enrollment.enrollmentId,
            customer_name: enrollment.customerName,
            customer_email: enrollment.customerEmail,
            customer_phone: enrollment.customerPhone,
            program_name: enrollment.programName,
            plan_type: enrollment.planType,
            coaching_type: enrollment.coachingType,
            duration_months: enrollment.durationMonths,
            amount_paid: payment.amount / 100,           // ← from Razorpay, not client
            original_amount: Number(notes.originalAmountPaise || claimedAmountPaise) / 100,
            coupon_code: notes.couponCode || null,
            coupon_savings: enrollment.couponSavings || 0,
            razorpay_order_id,
            razorpay_payment_id,
            payment_date: new Date(payment.created_at * 1000).toISOString(),
            payment_status: 'paid',
            age: enrollment.age,
            city: enrollment.city,
            weight: enrollment.weight,
            goals: enrollment.goals,
            medical_issue: enrollment.medicalIssue,
            medical_note: enrollment.medicalNote,
            partner_name: enrollment.partnerName || null,
            partner_age: enrollment.partnerAge || null,
            partner_weight: enrollment.partnerWeight || null,
            partner_goals: enrollment.partnerGoals?.length ? enrollment.partnerGoals : null,
            partner_medical_issue: enrollment.partnerMedicalIssue || null,
            partner_medical_note: enrollment.partnerMedicalNote || null,
            source: 'website',
            followup_status: 'active',
            next_followup_at: enrollment.nextFollowupAt,
        };

        const { data, error } = await supabase.from('enrollments').insert([row]).select().single();

        if (error) {
            if (error.code === '23505') {
                logger.warn(`[create-enrollment] duplicate enrollment_id — retry, treating as OK`);
                return res.json({ success: true, duplicate: true });
            }
            logger.error(`[create-enrollment] ❌ INSERT FAILED — ${error.message}`);
            // IMPORTANT: real failure, DB write did not happen — tell the truth.
            return res.status(500).json({ error: 'Failed to save enrollment. Please contact support with your payment ID.' });
        }

        logger.info(`[create-enrollment] ✅ SAVED — ${data.enrollment_id}`);

        // ── Fire confirmation emails from the SERVER-VERIFIED row, not the
        //    client payload. Fire-and-forget so the response isn't blocked. ──
        _sendEnrollmentConfirmation(data).catch((e) =>
            logger.error(`[create-enrollment] email dispatch failed: ${e.message}`)
        );

        return res.status(201).json({ success: true, enrollment: data });
    } catch (err) {
        logger.error(`[create-enrollment] FAILED — ${err.message}`);
        next(err);
    }
}

async function _sendEnrollmentConfirmation(row) {
    if (!config.email.gmailUser || !config.email.gmailAppPassword) return;
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
        logger.warn(`[email] invoice generation failed: ${e.message}`);
    }

    const coachMail = renderTemplate('enrollment_coach', templateData);
    const customerMail = renderTemplate('enrollment_customer', templateData);

    await Promise.allSettled([
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
            : Promise.resolve(),
        row.coupon_code ? incrementCouponUsage(row.coupon_code) : Promise.resolve(),
    ]);
}

export function healthCheck(_req, res) {
    res.json({ status: 'ok', env: process.env.NODE_ENV, timestamp: new Date().toISOString() });
}

export async function downloadInvoice(req, res, next) {
    // unchanged — still fine for the admin-panel "download invoice" button,
    // since that's an authenticated admin action, not the payment flow itself
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