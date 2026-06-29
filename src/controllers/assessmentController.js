/**
 * src/controllers/assessmentController.js
 *
 * POST /api/submit-assessment
 *
 * Frontend sends multipart/form-data with all text fields plus three optional
 * file fields: photoFront, photoSide, bloodReport.
 *
 * Flow:
 *   1. multer parses multipart body → req.body (text) + req.files (files)
 *   2. Validate required fields
 *   3. submitAssessment() uploads files to Supabase Storage + inserts the row
 *   4. Fire coach + customer emails (best-effort)
 *
 * Fixes in this version:
 *   - Customer email is sent to `email` field (added to form) OR skipped gracefully
 *   - Signed URLs are generated for ALL file types (image + PDF blood reports)
 *   - Photo/report URLs are passed as direct download links
 *   - photoFront / photoSide are now OPTIONAL — submission no longer blocks
 *     if either (or both) is missing. assessmentService.uploadFile() already
 *     returns null for a missing file, so the rest of the pipeline (DB insert,
 *     email rendering) handles absent photos gracefully without changes.
 */

import multer from 'multer';
import { submitAssessment, getSignedFileUrls } from '../services/assessmentService.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import nodemailer from 'nodemailer';

// ── Multer setup ──────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/heic',
            'application/pdf',
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
});

export const assessmentUpload = upload.fields([
    { name: 'photoFront', maxCount: 1 },
    { name: 'photoSide', maxCount: 1 },
    { name: 'bloodReport', maxCount: 1 },
]);

// ── Required fields ───────────────────────────────────────────────────────────
// Note: photoFront / photoSide are intentionally NOT in this list — they're
// optional uploads, validated (or rather, not validated) separately below.
const REQUIRED_FIELDS = [
    'firstName', 'whatsapp', 'age', 'gender', 'city', 'plan',
    'currentWeight', 'height', 'mainGoal', 'desiredResult', 'whyNow',
    'workoutStatus', 'trainingDays',
    'foodPreference', 'dailyFoodRoutine', 'biggestStruggle', 'sleepHours',
];

function validateBody(body) {
    return REQUIRED_FIELDS.filter((f) => !body[f] || !String(body[f]).trim());
}

// ── Reusable transporter ──────────────────────────────────────────────────────
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

// ── Send assessment emails ────────────────────────────────────────────────────
async function sendAssessmentEmails(assessmentRow) {
    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
        logger.warn('[assessment] Skipped emails — GMAIL_USER / GMAIL_APP_PASSWORD not set.');
        return;
    }

    const transporter = getTransporter();
    const coachEmail = config.email.coachEmail || config.email.gmailUser;

    // Generate signed URLs so the coach can download photos/PDF from email.
    // Supabase signed URLs work for both images AND PDFs — they are direct
    // download/view links that expire after 7 days. Paths that are null
    // (because a photo wasn't uploaded) simply resolve to a null URL —
    // getSignedFileUrl() already early-returns null for a falsy path, so
    // this is safe with zero, one, or all three files missing.
    let fileUrls = { photoFrontUrl: null, photoSideUrl: null, bloodReportUrl: null };
    try {
        fileUrls = await getSignedFileUrls({
            photo_front_path: assessmentRow.photo_front_path,
            photo_side_path: assessmentRow.photo_side_path,
            blood_report_path: assessmentRow.blood_report_path,
        });
        logger.info('[assessment] ✅ Signed URLs generated for coach email');
    } catch (urlErr) {
        logger.warn(`[assessment] ⚠️ Could not generate signed URLs: ${urlErr.message}`);
    }

    const templateData = { ...assessmentRow, ...fileUrls };

    // Coach email always fires
    const coachPromise = (async () => {
        const { subject, html } = renderTemplate('assessment_coach', templateData);
        return transporter.sendMail({
            from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
            to: coachEmail,
            subject,
            html,
        });
    })();

    // Customer email fires if the form includes an email address
    const customerEmail = assessmentRow.email || null;
    const customerPromise = customerEmail
        ? (async () => {
            const { subject, html } = renderTemplate('assessment_customer', templateData);
            return transporter.sendMail({
                from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
                to: customerEmail,
                replyTo: coachEmail,
                subject,
                html,
            });
        })()
        : Promise.resolve(null);

    const [coachResult, customerResult] = await Promise.allSettled([
        coachPromise,
        customerPromise,
    ]);

    if (coachResult.status === 'fulfilled') {
        logger.info(`[assessment] ✅ Coach email sent → ${coachEmail}`);
    } else {
        logger.error(`[assessment] ❌ Coach email failed: ${coachResult.reason?.message}`);
    }

    if (customerEmail) {
        if (customerResult.status === 'fulfilled') {
            logger.info(`[assessment] ✅ Customer email sent → ${customerEmail}`);
        } else {
            logger.error(`[assessment] ❌ Customer email failed: ${customerResult.reason?.message}`);
        }
    } else {
        logger.info('[assessment] ℹ️  No customer email provided — skipping customer confirmation');
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

        // photoFront / photoSide are optional — submission proceeds with
        // whatever subset of files (including none) was actually uploaded.
        // submitAssessment() → uploadFile() already returns null for any
        // missing file, so the DB row simply stores a null path for it.

        const { row } = await submitAssessment(req.body, files);

        logger.info(
            `[assessment] ✅ Saved ${row.id} for ${row.first_name} ${row.last_name || ''}`.trim()
        );

        // Fire-and-forget — don't block the HTTP response on email delivery
        sendAssessmentEmails(row).catch((err) =>
            logger.error(`[assessment] Email dispatch error: ${err.message}`)
        );

        return res.status(201).json({ success: true, assessmentId: row.id });
    } catch (err) {
        logger.error(`[assessment] ❌ Submission failed: ${err.message}`);
        next(err);
    }
}