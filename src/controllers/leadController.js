/**
 * src/controllers/leadController.js
 *
 * POST /api/leads — the hero "Apply For Coaching" modal's cold-enquiry form.
 * Validates → inserts into `leads` → fires coach + customer emails
 * (best-effort, fire-and-forget) reusing the same contact_inquiry_coach /
 * contact_inquiry_customer templates the modal used to hit directly via
 * /api/send-email. Doing both in one endpoint means the lead is persisted
 * even if email delivery fails, and the frontend only needs one request.
 */

import nodemailer from 'nodemailer';
import { waitUntil } from '@vercel/functions';
import { submitLead } from '../services/leadService.js';
import { renderTemplate } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';

const REQUIRED_FIELDS = ['name', 'email', 'phone'];

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

async function sendLeadEmails(lead) {
    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
        logger.warn('[lead] Skipped emails — GMAIL_USER / GMAIL_APP_PASSWORD not set.');
        return;
    }

    const transporter = getTransporter();
    const coachEmail = config.email.coachEmail || config.email.gmailUser;

    const templateData = {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        goal: lead.goal || '—',
        message: lead.message || '—',
    };

    const coachPromise = (async () => {
        const { subject, html } = renderTemplate('contact_inquiry_coach', templateData);
        return transporter.sendMail({
            from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
            to: coachEmail,
            replyTo: lead.email,
            subject,
            html,
        });
    })();

    const customerPromise = (async () => {
        const { subject, html } = renderTemplate('contact_inquiry_customer', templateData);
        return transporter.sendMail({
            from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
            to: lead.email,
            replyTo: coachEmail,
            subject,
            html,
        });
    })();

    const [coachResult, customerResult] = await Promise.allSettled([coachPromise, customerPromise]);

    if (coachResult.status === 'fulfilled') {
        logger.info(`[lead] ✅ Coach email sent → ${coachEmail}`);
    } else {
        logger.error(`[lead] ❌ Coach email failed: ${coachResult.reason?.message}`);
    }

    if (customerResult.status === 'fulfilled') {
        logger.info(`[lead] ✅ Customer email sent → ${lead.email}`);
    } else {
        logger.error(`[lead] ❌ Customer email failed: ${customerResult.reason?.message}`);
    }
}

// ── POST /api/leads ───────────────────────────────────────────────────────────
export async function submitLeadHandler(req, res, next) {
    try {
        const missing = validateBody(req.body);
        if (missing.length > 0) {
            return res.status(400).json({
                error: `Missing required fields: ${missing.join(', ')}`,
            });
        }

        const lead = await submitLead(req.body);

        logger.info(`[lead] ✅ Saved ${lead.id} for ${lead.name}`);

        // Fire-and-forget — don't block the HTTP response on email delivery.
        waitUntil(sendLeadEmails(lead).catch((err) =>
            logger.error(`[lead] Email dispatch error: ${err.message}`)
        ));

        return res.status(201).json({ success: true, leadId: lead.id });
    } catch (err) {
        logger.error(`[lead] ❌ Submission failed: ${err.message}`);
        next(err);
    }
}
