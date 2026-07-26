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

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    return expected === signature;
}