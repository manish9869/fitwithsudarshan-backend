import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import compression from 'compression';
import { config } from '../config/env.js';
import logger from '../config/logger.js';

// ── CORS ──────────────────────────────────────────────────────────────────────
export const corsMiddleware = cors({
    origin: (origin, callback) => {
        // Allow server-to-server requests (no origin) only in dev
        if (!origin && !config.isProd) return callback(null, true);

        if (config.allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        logger.warn(`CORS blocked: ${origin}`);
        callback(new Error(`Origin not allowed: ${origin}`));
    },
    methods: ['GET', 'POST'],
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

// ── Compression ───────────────────────────────────────────────────────────────
export const compressionMiddleware = compression();
