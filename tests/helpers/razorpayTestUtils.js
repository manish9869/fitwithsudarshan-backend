import crypto from 'crypto';
import { vi } from 'vitest';

/** Computes a real, valid Razorpay checkout signature — the same formula
 * verifyPaymentSignature() checks against — so tests exercise the actual
 * crypto code path instead of mocking it away. */
export function signOrderPayment(orderId, paymentId, secret = process.env.RAZORPAY_KEY_SECRET) {
    return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

/** Computes a real, valid Razorpay webhook signature over a raw JSON body string. */
export function signWebhookBody(rawBody, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Mocks global.fetch to answer the two Razorpay endpoints the backend calls. */
export function mockRazorpayFetch({ order, payment }) {
    return vi.fn(async (url) => {
        const u = String(url);
        if (u.includes('/v1/orders') && !u.match(/\/v1\/orders\/[^/]+$/)) {
            return jsonResponse(200, order);
        }
        if (u.match(/\/v1\/orders\/[^/]+$/)) {
            return jsonResponse(200, order);
        }
        if (u.match(/\/v1\/payments\/[^/]+$/)) {
            return jsonResponse(200, payment);
        }
        throw new Error(`Unmocked Razorpay URL in test: ${u}`);
    });
}

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

// Re-export for convenience where only jsonResponse is needed directly.
export { jsonResponse };
