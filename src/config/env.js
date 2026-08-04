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
    email: {
        gmailUser: process.env.GMAIL_USER || '',
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
        coachEmail: process.env.COACH_EMAIL || process.env.GMAIL_USER || '',
    },
    // Parse comma-separated origins from env
    allowedOrigins: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : [], // empty = handled in corsMiddleware

    // Public frontend origin (no trailing slash), used to build links embedded
    // in emails (e.g. the "upload photos later" link). Empty = link omitted.
    publicSiteUrl: (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, ''),

    // Optional — GA4 Realtime Data API, for the admin dashboard's "Live
    // Visitors" widget. All three blank = feature is simply unavailable
    // (not a startup error, since most of the app doesn't depend on it).
    // .env files can't hold real newlines, so the private key is stored
    // with literal "\n" sequences and unescaped here.
    ga4: {
        propertyId: process.env.GA4_PROPERTY_ID || '',
        clientEmail: process.env.GA4_CLIENT_EMAIL || '',
        privateKey: (process.env.GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
};
