import { createRazorpayOrder, verifyPaymentSignature } from '../utils/razorpay.js';
import { validateCreateOrder, validateVerifyPayment } from '../utils/validate.js';
import logger from '../config/logger.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';
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

        logger.info(`[verify-payment] ✅ VERIFIED — payment_id=${razorpay_payment_id}. ⚠️ NOTE: no enrollment row is written here — check useRazorpay.js / webhook for the actual insert step.`);

        return res.json({ success: true, payment_id: razorpay_payment_id });
    } catch (err) {
        logger.error(`[verify-payment] FAILED — ${err.message} | stack: ${err.stack}`);
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