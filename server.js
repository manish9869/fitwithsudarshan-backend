import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
const app = express();
app.use(express.json());
app.use(
    cors({
        origin: [
            'http://localhost:5173',
            'http://localhost:5174',
            'https://fitwithsudarshan.com',
            'https://www.fitwithsudarshan.com',
        ],
    })
);

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('❌  Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in .env');
    process.exit(1);
}

// ── POST /api/create-order ────────────────────────────────────────────────────
app.post('/api/create-order', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            receipt = `rcpt_${Date.now()}`,
        } = req.body;

        if (amount === undefined || isNaN(amount)) {
            return res.status(400).json({ error: 'amount is required and must be a number (paise)' });
        }

        const amountPaise = Math.round(Number(amount));
        if (amountPaise < 100) {
            return res.status(400).json({ error: 'Minimum amount is 100 paise (₹1)' });
        }

        const credentials = Buffer.from(
            `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
        ).toString('base64');

        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${credentials}`,
            },
            body: JSON.stringify({ amount: amountPaise, currency, receipt }),
        });

        if (!rzpRes.ok) {
            const err = await rzpRes.json();
            console.error('Razorpay error:', err);
            return res
                .status(rzpRes.status)
                .json({ error: err?.error?.description || 'Failed to create order' });
        }

        const order = await rzpRes.json();
        return res.json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
        });
    } catch (err) {
        console.error('create-order exception:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/verify-payment ──────────────────────────────────────────────────
app.post('/api/verify-payment', (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing required payment fields' });
    }

    const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        return res
            .status(400)
            .json({ success: false, error: 'Signature mismatch — payment not verified.' });
    }

    // ✅ Verified — extend here to persist to Supabase if needed
    return res.json({ success: true, payment_id: razorpay_payment_id });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
    console.log(`✅  API server → http://localhost:${PORT}`)
);