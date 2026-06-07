/**
 * src/controllers/emailController.js
 *
 * Frontend sends:  { template, to, data }
 * Backend picks the template, renders it, and sends via Gmail SMTP.
 *
 * POST /api/send-email
 * Body:
 *   template  {string}  - template name (e.g. "enrollment_customer")
 *   to        {string}  - recipient email address
 *   data      {object}  - variables injected into the template
 */

import nodemailer from 'nodemailer';
import { renderTemplate, TEMPLATE_NAMES } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';

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

// ── POST /api/send-email ──────────────────────────────────────────────────────
export async function sendEmail(req, res, next) {
  try {
    const { template, to, data = {} } = req.body;

    // ── Validate input ────────────────────────────────────────────────────
    if (!template || typeof template !== 'string') {
      return res.status(400).json({ error: '`template` is required (string).' });
    }
    if (!TEMPLATE_NAMES.includes(template)) {
      return res.status(400).json({
        error: `Unknown template "${template}". Valid options: ${TEMPLATE_NAMES.join(', ')}`,
      });
    }
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return res.status(400).json({ error: '`to` must be a valid email address.' });
    }

    // ── Skip if email not configured (dev without .env) ───────────────────
    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
      logger.warn(`[email] Skipped — GMAIL_USER / GMAIL_APP_PASSWORD not set. Template: ${template}`);
      return res.json({ success: true, skipped: true });
    }

    // ── Render template ───────────────────────────────────────────────────
    const { subject, html } = renderTemplate(template, data);

    // ── Send ──────────────────────────────────────────────────────────────
    await getTransporter().sendMail({
      from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
      to,
      replyTo: config.email.coachEmail || config.email.gmailUser,
      subject,
      html,
    });

    logger.info(`[email] ✅ Sent template="${template}" → ${to}`);
    return res.json({ success: true });

  } catch (err) {
    logger.error(`[email] ❌ Failed: ${err.message}`);
    next(err);
  }
}

// ── POST /api/send-enrollment-emails ─────────────────────────────────────────
// Convenience endpoint: fires both enrollment emails in one call.
// Frontend sends the full enrollment object; backend decides the recipients.
export async function sendEnrollmentEmails(req, res, next) {
  try {
    const enrollment = req.body;

    if (!enrollment?.customerEmail || !enrollment?.enrollmentId) {
      return res.status(400).json({ error: 'Invalid enrollment data.' });
    }

    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
      logger.warn('[email] Skipped enrollment emails — not configured.');
      return res.json({ success: true, skipped: true });
    }

    const transporter = getTransporter();
    const coachEmail = config.email.coachEmail || config.email.gmailUser;

    const [coachResult, customerResult] = await Promise.allSettled([
      (async () => {
        const { subject, html } = renderTemplate('enrollment_coach', enrollment);
        return transporter.sendMail({
          from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
          to: coachEmail,
          subject,
          html,
        });
      })(),
      (async () => {
        const { subject, html } = renderTemplate('enrollment_customer', enrollment);
        return transporter.sendMail({
          from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
          to: enrollment.customerEmail,
          replyTo: coachEmail,
          subject,
          html,
        });
      })(),
    ]);

    const coachOk = coachResult.status === 'fulfilled';
    const customerOk = customerResult.status === 'fulfilled';

    if (coachOk) logger.info(`[email] ✅ Coach notification → ${coachEmail}`);
    else logger.error(`[email] ❌ Coach email failed: ${coachResult.reason?.message}`);

    if (customerOk) logger.info(`[email] ✅ Customer confirmation → ${enrollment.customerEmail}`);
    else logger.error(`[email] ❌ Customer email failed: ${customerResult.reason?.message}`);

    return res.json({ success: true, coach: coachOk, customer: customerOk });

  } catch (err) {
    logger.error(`[email] ❌ sendEnrollmentEmails error: ${err.message}`);
    next(err);
  }
}