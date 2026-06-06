import crypto from 'crypto';
import { config } from '../config/env.js';

const { keyId, keySecret } = config.razorpay;

// ── Create a Razorpay order via REST API ──────────────────────────────────────
export async function createRazorpayOrder({ amount, currency = 'INR', receipt }) {
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({ amount, currency, receipt }),
    });

    const data = await response.json();

    if (!response.ok) {
        const message = data?.error?.description || 'Razorpay order creation failed';
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

// ── Verify Razorpay payment signature ─────────────────────────────────────────
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    return expected === signature;
}
