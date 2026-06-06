import { createLogger, format, transports } from 'winston';
import { existsSync, mkdirSync } from 'fs';

// Ensure logs/ directory exists
if (!existsSync('logs')) mkdirSync('logs');

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
    ),
    transports: [
        new transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'HH:mm:ss' }),
                errors({ stack: true }),
                logFormat
            ),
        }),
        new transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5_242_880, maxFiles: 5 }),
        new transports.File({ filename: 'logs/combined.log', maxsize: 5_242_880, maxFiles: 5 }),
    ],
});

export default logger;
