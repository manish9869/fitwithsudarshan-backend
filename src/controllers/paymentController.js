import { createRazorpayOrder, verifyPaymentSignature } from '../utils/razorpay.js';
import { validateCreateOrder, validateVerifyPayment } from '../utils/validate.js';
import logger from '../config/logger.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';
// ── POST /api/create-order ────────────────────────────────────────────────────
export async function createOrder(req, res, next) {
    try {
        const errors = validateCreateOrder(req.body);
        if (errors.length) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const {
            amount,
            currency = 'INR',
            receipt = `rcpt_${Date.now()}`,
        } = req.body;

        const amountPaise = Math.round(Number(amount));

        logger.info(`Creating order — amount: ${amountPaise} ${currency} | ip: ${req.ip}`);

        const order = await createRazorpayOrder({ amount: amountPaise, currency, receipt });

        logger.info(`Order created — id: ${order.id} | amount: ${order.amount}`);

        return res.status(201).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
        });
    } catch (err) {
        logger.error(`create-order failed: ${err.message}`);
        next(err);
    }
}

// ── POST /api/verify-payment ──────────────────────────────────────────────────
export function verifyPayment(req, res, next) {
    try {
        const errors = validateVerifyPayment(req.body);
        if (errors.length) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const isValid = verifyPaymentSignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });

        if (!isValid) {
            logger.warn(`Signature mismatch — order: ${razorpay_order_id} | payment: ${razorpay_payment_id} | ip: ${req.ip}`);
            return res.status(400).json({
                success: false,
                error: 'Signature mismatch — payment not verified.',
            });
        }

        logger.info(`Payment verified ✅ — payment_id: ${razorpay_payment_id}`);

        // ✅ Extend here to persist to Supabase if needed
        return res.json({ success: true, payment_id: razorpay_payment_id });
    } catch (err) {
        logger.error(`verify-payment failed: ${err.message}`);
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