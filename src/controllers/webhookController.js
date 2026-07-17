// controllers/webhookController.js
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { logTxnStep } from '../services/txnLogService.js';
import { sendEnrollmentConfirmation } from './paymentController.js'; // see export change below
import logger from '../config/logger.js';

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export async function handleRazorpayWebhook(req, res) {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.body).digest('hex');

        if (signature !== expected) {
            logger.warn('[webhook] signature mismatch');
            return res.status(400).json({ error: 'Invalid webhook signature' });
        }

        const event = JSON.parse(req.body);

        if (event.event !== 'payment.captured') {
            return res.status(200).json({ received: true });
        }

        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        await logTxnStep({ orderId, paymentId, step: 'webhook:payment_captured', status: 'started' });

        const supabase = getSupabaseAdmin();

        const { data, error } = await supabase
            .from('enrollments')
            .update({
                payment_status: 'paid',
                razorpay_payment_id: paymentId,
                amount_paid: payment.amount / 100,
                payment_date: new Date(payment.created_at * 1000).toISOString(),
                next_followup_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('razorpay_order_id', orderId)
            .eq('payment_status', 'pending')
            .select()
            .maybeSingle();

        if (error) {
            logger.error(`[webhook] db update failed: ${error.message}`);
            await logTxnStep({ orderId, paymentId, step: 'webhook:db_update', status: 'failed', message: error.message });
            return res.status(500).json({ error: 'DB update failed' }); // Razorpay retries on non-2xx
        }

        if (!data) {
            // Already processed by the client-side path — fine, just ack
            return res.status(200).json({ received: true, alreadyProcessed: true });
        }

        logger.info(`[webhook] ✅ CONFIRMED — ${data.enrollment_id}`);
        await logTxnStep({ orderId, paymentId, enrollmentId: data.enrollment_id, step: 'webhook:db_update', status: 'success' });

        res.status(200).json({ received: true });

        waitUntil(sendEnrollmentConfirmation(data).catch((e) => {
            logger.error(`[webhook] email dispatch failed: ${e.message}`);
            return logTxnStep({ orderId, paymentId, enrollmentId: data.enrollment_id, step: 'webhook:emails', status: 'failed', message: e.message });
        }));
    } catch (err) {
        logger.error(`[webhook] unhandled error: ${err.message}`);
        await logTxnStep({ step: 'webhook:unhandled', status: 'failed', message: err.message });
        return res.status(500).json({ error: 'Webhook processing failed' }); // Razorpay will retry
    }
}