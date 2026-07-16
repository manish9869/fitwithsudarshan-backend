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

// ── POST /api/create-order ────────────────────────────────────────────────
// CHANGED: client no longer sends `amount`. It sends plan selection; the
// server resolves the real price and validates any coupon. This is the fix
// for price tampering — the client cannot influence the charged amount.
export async function createOrder(req, res, next) {
    const { coachingType, planType, durationMonths, couponCode, receipt = `rcpt_${Date.now()}` } = req.body;

    try {
        await logTxnStep({
            step: 'create_order',
            status: 'started',
            message: `type=${coachingType} plan=${planType} dur=${durationMonths} coupon=${couponCode || '-'}`,
            metadata: { coachingType, planType, durationMonths, couponCode: couponCode || null },
        });

        const errors = validateCreateOrder(req.body);
        if (errors.length) {
            await logTxnStep({ step: 'create_order:validate', status: 'failed', message: errors.join(', ') });
            return res.status(400).json({ error: errors.join(', ') });
        }

        let amountRupees;
        try {
            amountRupees = resolvePrice({ coachingType, planType, durationMonths });
        } catch (e) {
            await logTxnStep({ step: 'create_order:resolve_price', status: 'failed', message: e.message });
            return res.status(400).json({ error: e.message });
        }

        let originalAmountRupees = amountRupees;
        let appliedCoupon = null;

        if (couponCode) {
            const result = await validateCouponCode({
                code: couponCode, coachingType, planType, durationMonths, originalPrice: amountRupees,
            });
            if (!result.valid) {
                await logTxnStep({
                    step: 'create_order:coupon', status: 'failed',
                    message: result.error, metadata: { couponCode },
                });
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

        await logTxnStep({
            orderId: order.id,
            step: 'create_order',
            status: 'success',
            message: `amount=${order.amount}`,
            metadata: {
                coachingType, planType, durationMonths,
                couponCode: appliedCoupon?.code || null,
                couponSavings: appliedCoupon?.savings || 0,
                amountPaise: order.amount,
            },
        });

        return res.status(201).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            couponApplied: appliedCoupon,
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, enrollment } = req.body || {};
    const oid = razorpay_order_id;
    const pid = razorpay_payment_id;
    const eid = enrollment?.enrollmentId;

    try {
        await logTxnStep({
            orderId: oid, paymentId: pid, enrollmentId: eid,
            step: 'create_enrollment', status: 'started',
            metadata: { customerName: enrollment?.customerName, programName: enrollment?.programName, amountPaid: enrollment?.amountPaid },
        });

        if (!oid || !pid || !razorpay_signature) {
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:validate', status: 'failed',
                message: 'missing payment verification fields',
            });
            return res.status(400).json({ error: 'Missing payment verification fields.' });
        }
        if (!enrollment?.enrollmentId || !enrollment?.customerName) {
            await logTxnStep({
                orderId: oid, paymentId: pid,
                step: 'create_enrollment:validate', status: 'failed',
                message: 'invalid enrollment payload (missing enrollmentId or customerName)',
            });
            return res.status(400).json({ error: 'Invalid enrollment data.' });
        }

        const isValid = verifyPaymentSignature({
            orderId: oid, paymentId: pid, signature: razorpay_signature,
        });
        if (!isValid) {
            logger.warn(`[create-enrollment] signature re-check FAILED — order=${oid}`);
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:signature', status: 'failed',
                message: 're-check signature mismatch',
            });
            return res.status(400).json({ error: 'Payment signature invalid.' });
        }
        await logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: eid, step: 'create_enrollment:signature', status: 'success' });

        // ── Cross-check against Razorpay's own records ──────────────────
        let order, payment;
        try {
            [order, payment] = await Promise.all([
                fetchRazorpayOrder(oid),
                fetchRazorpayPayment(pid),
            ]);
        } catch (fetchErr) {
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:razorpay_fetch', status: 'failed',
                message: fetchErr.message,
            });
            throw fetchErr;
        }

        await logTxnStep({
            orderId: oid, paymentId: pid, enrollmentId: eid,
            step: 'create_enrollment:razorpay_fetch', status: 'success',
            metadata: { orderAmount: order.amount, paymentAmount: payment.amount, paymentStatus: payment.status },
        });

        if (payment.status !== 'captured') {
            logger.warn(`[create-enrollment] payment not captured — status=${payment.status}`);
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:capture_check', status: 'failed',
                message: `payment status = ${payment.status}`,
            });
            return res.status(400).json({ error: 'Payment has not been captured.' });
        }
        if (payment.order_id !== oid) {
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:order_match', status: 'failed',
                message: `payment.order_id=${payment.order_id} != oid=${oid}`,
            });
            return res.status(400).json({ error: 'Payment/order mismatch.' });
        }

        const claimedAmountPaise = Math.round(Number(enrollment.amountPaid) * 100);
        if (order.amount !== claimedAmountPaise || payment.amount !== order.amount) {
            logger.error(
                `[create-enrollment] 🚨 AMOUNT MISMATCH — order=${order.amount} payment=${payment.amount} claimed=${claimedAmountPaise}`
            );
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:amount_check', status: 'failed',
                message: `order=${order.amount} payment=${payment.amount} claimed=${claimedAmountPaise}`,
            });
            return res.status(400).json({ error: 'Amount mismatch — enrollment rejected.' });
        }

        // Trust the order's own notes (set server-side at create-order time)
        // for the plan fields, not the client-submitted enrollment object.
        const notes = order.notes || {};
        if (notes.coachingType && notes.coachingType !== enrollment.coachingType) {
            logger.error(`[create-enrollment] 🚨 PLAN MISMATCH — order says ${notes.coachingType}, client claims ${enrollment.coachingType}`);
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:plan_check', status: 'failed',
                message: `order says ${notes.coachingType}, client claims ${enrollment.coachingType}`,
            });
            return res.status(400).json({ error: 'Plan mismatch — enrollment rejected.' });
        }

        await logTxnStep({ orderId: oid, paymentId: pid, enrollmentId: eid, step: 'create_enrollment:checks', status: 'success' });

        let supabase;
        try {
            supabase = getSupabaseAdmin();
        } catch (supaErr) {
            // This is exactly the "payment captured but enrollment fails
            // silently" scenario — Supabase env vars missing/wrong.
            logger.error(`[create-enrollment] 🚨 Supabase client init failed: ${supaErr.message}`);
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:supabase_init', status: 'failed',
                message: supaErr.message,
            });
            return res.status(500).json({ error: 'Server misconfiguration (database). Please contact support with your payment ID.' });
        }

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

        await logTxnStep({
            orderId: oid, paymentId: pid, enrollmentId: eid,
            step: 'create_enrollment:db_insert', status: 'started',
        });

        const { data, error } = await supabase.from('enrollments').insert([row]).select().single();

        if (error) {
            if (error.code === '23505') {
                logger.warn(`[create-enrollment] duplicate enrollment_id — retry, treating as OK`);
                await logTxnStep({
                    orderId: oid, paymentId: pid, enrollmentId: eid,
                    step: 'create_enrollment:db_insert', status: 'warning',
                    message: 'duplicate enrollment_id — treated as OK',
                });
                return res.json({ success: true, duplicate: true });
            }
            logger.error(`[create-enrollment] ❌ INSERT FAILED — ${error.message}`);
            // ── THIS is the log that was previously missing and hiding the
            //    real root cause behind a generic 500 message. ──
            await logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:db_insert', status: 'failed',
                message: error.message,
                metadata: { code: error.code, details: error.details, hint: error.hint },
            });
            // IMPORTANT: real failure, DB write did not happen — tell the truth.
            return res.status(500).json({ error: 'Failed to save enrollment. Please contact support with your payment ID.' });
        }

        logger.info(`[create-enrollment] ✅ SAVED — ${data.enrollment_id}`);
        await logTxnStep({
            orderId: oid, paymentId: pid, enrollmentId: eid,
            step: 'create_enrollment:db_insert', status: 'success',
        });

        // ── Fire confirmation emails from the SERVER-VERIFIED row, not the
        //    client payload. Fire-and-forget so the response isn't blocked. ──
        await _sendEnrollmentConfirmation(data).catch((e) => {
            logger.error(`[create-enrollment] email dispatch failed: ${e.message}`);
            return logTxnStep({
                orderId: oid, paymentId: pid, enrollmentId: eid,
                step: 'create_enrollment:emails', status: 'failed', message: e.message,
            });
        });

        await logTxnStep({
            orderId: oid, paymentId: pid, enrollmentId: eid,
            step: 'create_enrollment', status: 'success',
        });

        return res.status(201).json({ success: true, enrollment: data });
    } catch (err) {
        logger.error(`[create-enrollment] FAILED — ${err.message}`);
        await logTxnStep({
            orderId: oid, paymentId: pid, enrollmentId: eid,
            step: 'create_enrollment', status: 'failed', message: err.message,
        });
        next(err);
    }
}

async function _sendEnrollmentConfirmation(row) {
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