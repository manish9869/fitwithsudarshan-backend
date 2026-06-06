import dotenv from 'dotenv';
dotenv.config();

const required = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];

for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌  Missing required env var: ${key}`);
        process.exit(1);
    }
}

export const config = {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    isProd: process.env.NODE_ENV === 'production',

    razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
    },

    // Parse comma-separated origins from env
    allowedOrigins: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : [], // empty = handled in corsMiddleware
};
