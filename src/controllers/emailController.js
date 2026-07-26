import nodemailer from 'nodemailer';
import { renderTemplate } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
// ── Reusable transporter ──────────────────────────────────────────────────────
export let _transporter = null;
export function getTransporter() {
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

// This route has no auth in front of it (public contact form, no customer
// accounts on this site) — so it must not be trusted with every template.
// Templates like enrollment_coach/payment_receipt_email carry payment details
// and are only ever sent from server-verified data elsewhere (paymentController,
// manualEnrollmentController). Restricting the public route to just the
// contact-form templates stops it being usable as a generic relay to spam or
// harass an arbitrary `to` address using this business's Gmail account/template set.
const PUBLIC_SEND_EMAIL_TEMPLATES = ['contact_inquiry_coach', 'contact_inquiry_customer'];

// ── POST /api/send-email ──────────────────────────────────────────────────────
export async function sendEmail(req, res, next) {
  try {
    const { template, to, data = {} } = req.body;

    if (!template || typeof template !== 'string') {
      return res.status(400).json({ error: '`template` is required (string).' });
    }
    if (!PUBLIC_SEND_EMAIL_TEMPLATES.includes(template)) {
      return res.status(400).json({
        error: `Unknown template "${template}". Valid options: ${PUBLIC_SEND_EMAIL_TEMPLATES.join(', ')}`,
      });
    }
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return res.status(400).json({ error: '`to` must be a valid email address.' });
    }

    if (!config.email.gmailUser || !config.email.gmailAppPassword) {
      logger.warn(`[email] Skipped — GMAIL_USER / GMAIL_APP_PASSWORD not set. Template: ${template}`);
      return res.json({ success: true, skipped: true });
    }

    const { subject, html } = renderTemplate(template, data);

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