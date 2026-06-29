import './config/env.js'; // Load + validate env first
import express from 'express';
import "dotenv/config";
import { config } from './config/env.js';
import logger from './config/logger.js';
import {
    corsMiddleware,
    helmetMiddleware,
    globalLimiter,
    compressionMiddleware,
} from './middleware/security.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import paymentRoutes from './routes/payment.js';
import adminRoutes from './routes/admin.js'; // ← NEW

const app = express();
console.log(process.env.PORT);
// ── Trust proxy (required for rate limiting behind Vercel/Render/nginx) ───────
app.set('trust proxy', 1);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(globalLimiter);
app.use(compressionMiddleware);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // Reject oversized payloads
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', paymentRoutes);
app.use('/api/admin', adminRoutes); // ← NEW

// ── 404 + error handlers (must be last) ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
    logger.info(`✅  Server running on port ${config.port} [${config.nodeEnv}]`);
    logger.info(`📋  Allowed origins: ${config.allowedOrigins.join(', ') || 'all (dev)'}`);
});

export default app;