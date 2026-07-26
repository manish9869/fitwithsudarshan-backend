import './config/env.js';
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
import adminRoutes from './routes/admin.js';
import contentRoutes from './routes/content.js';

const app = express();
console.log(process.env.PORT);
app.set('trust proxy', 1);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(globalLimiter);
app.use(compressionMiddleware);

// ── Body parsing ──────────────────────────────────────────────────────────────
// The Razorpay webhook route (routes/payment.js) needs the RAW, untouched
// body to verify its HMAC signature via express.raw(). If express.json()
// runs first (as it did before), it consumes the stream and the webhook's
// raw parser gets nothing — signature verification silently fails on every
// real webhook call. Skip JSON/urlencoded parsing for that one path.
app.use((req, res, next) => {
    if (req.originalUrl === '/api/webhooks/razorpay') return next();
    express.json({ limit: '10kb' })(req, res, next);
});
app.use((req, res, next) => {
    if (req.originalUrl === '/api/webhooks/razorpay') return next();
    express.urlencoded({ extended: false, limit: '10kb' })(req, res, next);
});

app.use(requestLogger);

app.use('/api', paymentRoutes);
app.use('/api', contentRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
    logger.info(`✅  Server running on port ${config.port} [${config.nodeEnv}]`);
    logger.info(`📋  Allowed origins: ${config.allowedOrigins.join(', ') || 'all (dev)'}`);
});

export default app;