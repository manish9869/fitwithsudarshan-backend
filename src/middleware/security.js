import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import compression from 'compression';
import { config } from '../config/env.js';
import logger from '../config/logger.js';

// ── CORS ──────────────────────────────────────────────────────────────────────
// Origins are compared with the leading "www." stripped so ALLOWED_ORIGINS
// only needs one form of the domain — an exact-match list previously meant
// listing just the apex (or just www) silently locked out the other,
// breaking every /api/content/* request (and the CORS preflight error this
// produces in the browser gives no hint that it's a www/apex mismatch).
function stripWww(origin) {
    try {
        const url = new URL(origin);
        url.hostname = url.hostname.replace(/^www\./, '');
        return url.origin;
    } catch {
        return origin;
    }
}

export const corsMiddleware = cors({
    origin: (origin, callback) => {
        // Allow no-origin requests in dev (curl, Postman)
        if (!origin) return callback(null, !config.isProd);

        if (!config.allowedOrigins.length) return callback(null, true);

        const normalized = stripWww(origin);
        if (config.allowedOrigins.some((allowed) => stripWww(allowed) === normalized)) {
            return callback(null, true);
        }

        // Return 403, don't throw
        logger.warn(`CORS blocked: ${origin}`);
        callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
});

// ── Helmet — HTTP security headers ────────────────────────────────────────────
export const helmetMiddleware = helmet({
    contentSecurityPolicy: true,
    crossOriginEmbedderPolicy: false, // Razorpay iframe compatibility
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Global — 100 requests per 15 min per IP
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});

// Strict — payment endpoints: 10 requests per 15 min per IP
export const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many payment attempts. Please try again later.' },
    skipSuccessfulRequests: false,
});

// Email / PDF endpoints — unauthenticated but expensive (real email sends
// from the business Gmail account, headless-Chrome PDF generation). The
// global limiter (100/15min) is too loose for these on its own — this caps
// abuse (spam relay, cost inflation) while still covering realistic
// contact-form / receipt-download traffic. 20 requests per 15 min per IP.
export const emailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});

// Assessment submission — unauthenticated, accepts up to 3 file uploads
// (10MB each) plus fires 2 emails plus a DB insert per request. 15 per 15
// min per IP: generous enough for a real client submitting (and possibly
// retrying) their onboarding assessment, tight enough to blunt automated
// spam of the upload pipeline.
export const assessmentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many submissions. Please try again later.' },
});

// ── Compression ───────────────────────────────────────────────────────────────
export const compressionMiddleware = compression();
