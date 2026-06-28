/**
 * src/controllers/assessmentController.js
 *
 * POST /api/submit-assessment
 *
 * Frontend (src/pages/Onboarding.jsx) sends multipart/form-data with all
 * text fields plus three optional file fields: photoFront, photoSide,
 * bloodReport (already compressed client-side to ~1200px JPEGs).
 *
 * Flow:
 *   1. multer parses the multipart body into req.body (text) + req.files (files)
 *   2. Validate required fields
 *   3. submitAssessment() uploads files to Supabase Storage + inserts the row
 *   4. Fire coach + customer emails (best-effort — failure here doesn't fail the request)
 */

import multer from 'multer';
import { submitAssessment, getSignedFileUrls } from '../services/assessmentService.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import nodemailer from 'nodemailer';

// ── Multer setup ──────────────────────────────────────────────────────────────
// Memory storage — we forward buffers straight to Supabase Storage, never
// touch disk (Vercel's filesystem is read-only/ephemeral anyway).
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file (frontend already compresses images)

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
});

// Exported middleware — wire this into the route before the controller.
export const assessmentUpload = upload.fields([
    { name: 'photoFront', maxCount: 1 },
    { name: 'photoSide', maxCount: 1 },
    { name: 'bloodReport', maxCount: 1 },
]);

// ── Required fields (mirrors frontend validation in Onboarding.jsx) ──────────
const REQUIRED_FIELDS = [
    'firstName', 'whatsapp', 'age', 'gender', 'city', 'plan',
    'currentWeight', 'height', 'mainGoal', 'desiredResult', 'whyNow',
    'workoutStatus', 'trainingDays',
    'foodPreference', 'dailyFoodRoutine', 'biggestStruggle', 'sleepHours',
];

function validateBody(body) {
    const missing = REQUIRED_FIELDS.filter((f) => !body[f] || !String(body[f]).trim());
    return missing;
}

// ── Reusable transporter (same pattern as emailController.js) ────────────────
let _transporter = null;
function getTransporter() {
    if (!_transporter) {
        _transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: config.email.gmailUser,
                pass: config.email.gmailAppPassword,
            },
        });
    }
    return _transporter;
}

async function sendAssessmentEmails(assessmentRow) {
    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
        logger.warn('[assessment] Skipped emails — GMAIL_USER / GMAIL_APP_PASSWORD not set.');
        return;
    }

    const transporter = getTransporter();
    const coachEmail = config.email.coachEmail || config.email.gmailUser;

    // Signed URLs so the coach can view photos directly from the email
    // without the Storage bucket being public.
    const fileUrls = await getSignedFileUrls(assessmentRow);

    const templateData = { ...assessmentRow, ...fileUrls };

    const [coachResult, customerResult] = await Promise.allSettled([
        (async () => {
            const { subject, html } = renderTemplate('assessment_coach', templateData);
            return transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: coachEmail,
                subject,
                html,
            });
        })(),
        (async () => {
            // We don't collect a customer email on this form (only WhatsApp),
            // so the "customer confirmation" is skipped unless an email field
            // exists. If you add an email field to Onboarding.jsx later, wire
            // it up here the same way enrollment_customer is sent.
            if (!assessmentRow.email) return null;
            const { subject, html } = renderTemplate('assessment_customer', templateData);
            return transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: assessmentRow.email,
                replyTo: coachEmail,
                subject,
                html,
            });
        })(),
    ]);

    if (coachResult.status === 'fulfilled') {
        logger.info(`[assessment] ✅ Coach notification sent → ${coachEmail}`);
    } else {
        logger.error(`[assessment] ❌ Coach email failed: ${coachResult.reason?.message}`);
    }

    if (customerResult.status === 'rejected') {
        logger.error(`[assessment] ❌ Customer email failed: ${customerResult.reason?.message}`);
    }
}

// ── POST /api/submit-assessment ───────────────────────────────────────────────
export async function submitAssessmentHandler(req, res, next) {
    try {
        const missing = validateBody(req.body);
        if (missing.length > 0) {
            return res.status(400).json({
                error: `Missing required fields: ${missing.join(', ')}`,
            });
        }

        const files = {
            photoFront: req.files?.photoFront?.[0],
            photoSide: req.files?.photoSide?.[0],
            bloodReport: req.files?.bloodReport?.[0],
        };

        // Photos are required per the frontend, enforce server-side too.
        if (!files.photoFront || !files.photoSide) {
            return res.status(400).json({ error: 'Front and side photos are required.' });
        }

        const { row } = await submitAssessment(req.body, files);

        logger.info(`[assessment] ✅ Saved assessment ${row.id} for ${row.first_name} ${row.last_name || ''}`.trim());

        // Fire-and-forget — don't block the response on email delivery.
        sendAssessmentEmails(row).catch((err) =>
            logger.error(`[assessment] Email dispatch error: ${err.message}`)
        );

        return res.status(201).json({ success: true, assessmentId: row.id });
    } catch (err) {
        logger.error(`[assessment] ❌ Submission failed: ${err.message}`);
        next(err);
    }
}