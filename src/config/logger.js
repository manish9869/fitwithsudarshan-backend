import { createLogger, format, transports } from 'winston';
import { mkdirSync, existsSync } from 'fs';

const { combine, timestamp, printf, colorize, errors } = format;
const isProd = process.env.NODE_ENV === 'production';

const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

const allTransports = [
    new transports.Console({
        format: combine(
            colorize(),
            timestamp({ format: 'HH:mm:ss' }),
            errors({ stack: true }),
            logFormat
        ),
    }),
];

// Only write to disk locally — Vercel is read-only
if (!isProd) {
    if (!existsSync('logs')) mkdirSync('logs');
    allTransports.push(
        new transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5_242_880, maxFiles: 5 }),
        new transports.File({ filename: 'logs/combined.log', maxsize: 5_242_880, maxFiles: 5 })
    );
}

const logger = createLogger({
    level: isProd ? 'info' : 'debug',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
    ),
    transports: allTransports,
});

export default logger;