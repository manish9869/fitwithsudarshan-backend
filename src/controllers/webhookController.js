// controllers/webhookController.js
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { logTxnStep } from '../services/txnLogService.js';
import { incrementCouponUsage } from '../services/couponService.js';
import { sendEnrollmentConfirmation } from './paymentController.js';
import logger from '../config/logger.js';

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export async function handleRazorpayWebhook(req, res) {
    try {
        if (!WEBHOOK_SECRET) {
            // Loud failure instead of throwing inside crypto.createHmac —
            // without this secret set, the webhook can never verify a
            // signature, meaning payment reconciliation silently depends
            // 100% on the browser's confirm-payment call. If the customer's
            // tab closes right after paying, that enrollment never gets
            // marked paid. Set RAZORPAY_WEBHOOK_SECRET in your env.
            logger.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set — webhook cannot verify signatures.');
            return res.status(500).json({ error: 'Webhook not configured' });
        }

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
                total_amount: payment.amount / 100, balance_due: 0,
                payment_plan_status: 'full',
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
            // Already processed by the client-side confirm-payment path — fine, just ack
            return res.status(200).json({ received: true, alreadyProcessed: true });
        }

        logger.info(`[webhook] ✅ CONFIRMED — ${data.enrollment_id}`);
        await logTxnStep({ orderId, paymentId, enrollmentId: data.enrollment_id, step: 'webhook:db_update', status: 'success' });

        // ── Coupon usage — mirrors confirmPayment(). The webhook can be the
        // path that actually wins the "pending → paid" race (browser tab
        // closed right after paying, slow client network, etc). Without this
        // the coupon's used_count silently under-counts, letting a
        // max-uses-limited coupon get redeemed more times than intended.
        if (data.coupon_code) {
            incrementCouponUsage(data.coupon_code).catch((e) => {
                logger.error(`[webhook] ⚠️ coupon usage increment failed for ${data.coupon_code}: ${e.message}`);
                logTxnStep({ orderId, paymentId, enrollmentId: data.enrollment_id, step: 'webhook:coupon_increment', status: 'failed', message: e.message });
            });
        }

        // ── Payment ledger — the single source of truth PaymentLedgerPanel
        // reads from. A failed insert here used to be invisible (enrollment
        // shows "paid" but the ledger shows zero payments) — now it's logged
        // to transaction_logs so it surfaces in Funnel Audit / txn-timeline.
        supabase.from('enrollment_payments').insert([{
            enrollment_id: data.id,
            amount: data.amount_paid,
            method: 'razorpay',
            reference: data.razorpay_payment_id,
            paid_at: data.payment_date,
        }]).then(({ error: ledgerErr }) => {
            if (ledgerErr) {
                logger.warn(`[webhook] ledger insert failed: ${ledgerErr.message}`);
                logTxnStep({ orderId, paymentId, enrollmentId: data.enrollment_id, step: 'webhook:ledger_insert', status: 'failed', message: ledgerErr.message });
            }
        }).catch((e) => {
            logger.warn(`[webhook] ledger insert threw: ${e.message}`);
            logTxnStep({ orderId, paymentId, enrollmentId: data.enrollment_id, step: 'webhook:ledger_insert', status: 'failed', message: e.message });
        });

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