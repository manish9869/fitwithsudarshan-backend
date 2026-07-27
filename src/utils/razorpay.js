import crypto from 'crypto';
import { config } from '../config/env.js';

const { keyId, keySecret } = config.razorpay;
const authHeader = () => `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

export async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes }) {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
        body: JSON.stringify({ amount, currency, receipt, notes }),
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

// Confirms the payment is actually captured, and for how much
export async function fetchRazorpayPayment(paymentId) {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
        headers: { Authorization: authHeader() },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.description || 'Failed to fetch payment');
    return data;
}

// Plain `===` on a secret-derived value leaks timing information (an
// attacker who can measure response latency could narrow down a guessed
// signature byte-by-byte). crypto.timingSafeEqual() compares in constant
// time regardless of where the first mismatch is — but it throws if the two
// buffers differ in length, so that has to be checked (and short-circuited)
// first; a length mismatch on hex-encoded input has nothing secret-dependent
// left to leak.
export function timingSafeEqualStr(a, b) {
    const bufA = Buffer.from(String(a ?? ''));
    const bufB = Buffer.from(String(b ?? ''));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    return timingSafeEqualStr(expected, signature);
}