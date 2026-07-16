import { createRazorpayOrder, verifyPaymentSignature } from '../utils/razorpay.js';
import { validateCreateOrder, validateVerifyPayment } from '../utils/validate.js';
import logger from '../config/logger.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

// ── POST /api/create-order ────────────────────────────────────────────────────
export async function createOrder(req, res, next) {
    try {
        const errors = validateCreateOrder(req.body);
        if (errors.length) {
            logger.warn(`[create-order] validation failed: ${errors.join(', ')} | body: ${JSON.stringify(req.body)}`);
            return res.status(400).json({ error: errors.join(', ') });
        }

        const { amount, currency = 'INR', receipt = `rcpt_${Date.now()}` } = req.body;
        const amountPaise = Math.round(Number(amount));

        logger.info(`[create-order] START — amount=${amountPaise} ${currency} receipt=${receipt} ip=${req.ip}`);

        const order = await createRazorpayOrder({ amount: amountPaise, currency, receipt });

        logger.info(`[create-order] SUCCESS — order_id=${order.id} amount=${order.amount} status=${order.status}`);

        return res.status(201).json({ order_id: order.id, amount: order.amount, currency: order.currency });
    } catch (err) {
        logger.error(`[create-order] FAILED — ${err.message} | stack: ${err.stack}`);
        next(err);
    }
}

// ── POST /api/verify-payment ──────────────────────────────────────────────────
export function verifyPayment(req, res, next) {
    try {
        logger.info(`[verify-payment] START — body: ${JSON.stringify(req.body)} ip=${req.ip}`);

        const errors = validateVerifyPayment(req.body);
        if (errors.length) {
            logger.warn(`[verify-payment] validation failed: ${errors.join(', ')}`);
            return res.status(400).json({ error: errors.join(', ') });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const isValid = verifyPaymentSignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });

        logger.info(`[verify-payment] signature check — order=${razorpay_order_id} payment=${razorpay_payment_id} valid=${isValid}`);

        if (!isValid) {
            logger.warn(`[verify-payment] SIGNATURE MISMATCH — order=${razorpay_order_id} payment=${razorpay_payment_id} ip=${req.ip}`);
            return res.status(400).json({ success: false, error: 'Signature mismatch — payment not verified.' });
        }

        logger.info(`[verify-payment] ✅ VERIFIED — payment_id=${razorpay_payment_id}`);

        return res.json({ success: true, payment_id: razorpay_payment_id });
    } catch (err) {
        logger.error(`[verify-payment] FAILED — ${err.message} | stack: ${err.stack}`);
        next(err);
    }
}

// ── POST /api/create-enrollment ───────────────────────────────────────────────
// Called ONLY after the client has already hit /api/verify-payment successfully.
// Re-verifies the signature server-side again (defense-in-depth — never trust
// the client to have actually called verify-payment first) and then writes the
// enrollment row using the service-role key, which bypasses RLS safely since
// this is a trusted, signature-checked server-side call — never exposed to
// the browser's anon key.
export async function createEnrollment(req, res, next) {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            enrollment,
        } = req.body || {};

        logger.info(`[create-enrollment] START — order=${razorpay_order_id} payment=${razorpay_payment_id} enrollmentId=${enrollment?.enrollmentId}`);

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            logger.warn('[create-enrollment] missing razorpay identifiers in request body');
            return res.status(400).json({ error: 'Missing payment verification fields.' });
        }
        if (!enrollment?.enrollmentId || !enrollment?.customerName) {
            logger.warn('[create-enrollment] missing enrollment payload fields');
            return res.status(400).json({ error: 'Invalid enrollment data.' });
        }

        const isValid = verifyPaymentSignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });

        if (!isValid) {
            logger.warn(`[create-enrollment] signature re-check FAILED — order=${razorpay_order_id} payment=${razorpay_payment_id} ip=${req.ip}`);
            return res.status(400).json({ error: 'Payment signature invalid.' });
        }

        logger.info(`[create-enrollment] signature re-check passed — proceeding to insert`);

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
            amount_paid: enrollment.amountPaid,
            original_amount: enrollment.originalAmount,
            coupon_code: enrollment.couponCode,
            coupon_savings: enrollment.couponSavings,
            razorpay_order_id: enrollment.razorpayOrderId,
            razorpay_payment_id: enrollment.razorpayPaymentId,
            payment_date: enrollment.paymentDate,
            payment_status: enrollment.paymentStatus,
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

        logger.info(`[create-enrollment] inserting row for enrollmentId=${row.enrollment_id}`);

        const { data, error } = await supabase
            .from('enrollments')
            .insert([row])
            .select()
            .single();

        if (error) {
            // Duplicate enrollment_id (double-submit / client retry) — not a real failure,
            // the enrollment already exists, so treat as success rather than erroring out.
            if (error.code === '23505') {
                logger.warn(`[create-enrollment] duplicate enrollment_id=${enrollment.enrollmentId} — likely a client retry, treating as OK`);
                return res.json({ success: true, duplicate: true });
            }

            logger.error(`[create-enrollment] ❌ INSERT FAILED — code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`);
            return res.status(500).json({ error: 'Failed to save enrollment.' });
        }

        logger.info(`[create-enrollment] ✅ SAVED — enrollmentId=${data.enrollment_id} id=${data.id} payment=${razorpay_payment_id}`);

        return res.status(201).json({ success: true, enrollment: data });
    } catch (err) {
        logger.error(`[create-enrollment] FAILED — ${err.message} | stack: ${err.stack}`);
        next(err);
    }
}

// ── GET /api/health ───────────────────────────────────────────────────────────
export function healthCheck(_req, res) {
    res.json({
        status: 'ok',
        env: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
    });
}

export async function downloadInvoice(req, res, next) {
    try {
        const enrollment = req.body;

        if (!enrollment?.enrollmentId && !enrollment?.enrollment_id) {
            return res.status(400).json({
                error: 'Invalid enrollment data.',
            });
        }

        const buffer = await generateInvoiceBuffer(enrollment);

        const invoiceId = enrollment.enrollmentId || enrollment.enrollment_id;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="RECODE-Invoice-${invoiceId}.pdf"`
        );
        res.setHeader('Content-Length', buffer.length);

        return res.send(buffer);
    } catch (err) {
        next(err);
    }
}