/**
 * src/controllers/emailController.js
 *
 * Performance improvements vs original:
 *
 *  1. sendEnrollmentEmails() now responds to the frontend IMMEDIATELY after
 *     basic validation. PDF generation + email sending happen in the background.
 *     Previously the entire flow (Puppeteer launch → PDF → SMTP) had to complete
 *     before the HTTP response was sent, adding 5–15s to every enrollment.
 *
 *  2. Coach and customer emails are sent simultaneously (Promise.allSettled),
 *     same as before, but now without blocking the client response.
 *
 *  3. Transporter is created once and reused (unchanged from original).
 */

import nodemailer from 'nodemailer';
import { renderTemplate, TEMPLATE_NAMES } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';

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

// ── POST /api/send-email ──────────────────────────────────────────────────────
export async function sendEmail(req, res, next) {
  try {
    const { template, to, data = {} } = req.body;

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

// ── POST /api/send-enrollment-emails ─────────────────────────────────────────
//
// KEY CHANGE: Respond 202 Accepted immediately after validation.
// PDF generation + SMTP happen in the background so the frontend isn't
// blocked waiting for Puppeteer (the #1 source of slow responses).
//
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

    // ── Respond to the client right away ─────────────────────────────────
    // The frontend can show "Emails on their way!" without waiting for
    // Puppeteer to launch, render, and SMTP to flush.
    res.status(202).json({ success: true, queued: true });

    // ── Everything below runs AFTER the response is sent ─────────────────
    _sendEnrollmentEmailsBackground(enrollment).catch((err) =>
      logger.error(`[email] Background enrollment email error: ${err.message}`)
    );

  } catch (err) {
    // If something throws before res.json() we still need next(err)
    if (!res.headersSent) next(err);
    else logger.error(`[email] sendEnrollmentEmails outer error: ${err.message}`);
  }
}

async function _sendEnrollmentEmailsBackground(enrollment) {
  const transporter = getTransporter();
  const coachEmail = config.email.coachEmail || config.email.gmailUser;

  // Generate PDF — this is the slow part (~3–12s depending on cold start).
  // Now it doesn't block the HTTP response.
  let invoiceAttachment = [];
  try {
    const invoiceBuffer = generateInvoiceBuffer(enrollment);

    // generateInvoiceBuffer is async — we intentionally kick it off without
    // awaiting before res.json(), but we DO await it here so the attachment
    // is ready before sendMail() fires.
    const buffer = await invoiceBuffer;
    invoiceAttachment = [{
      filename: `RECODE-Invoice-${enrollment.enrollmentId}.pdf`,
      content: buffer,
      contentType: 'application/pdf',
    }];
    logger.info(`[email] ✅ Invoice PDF generated for ${enrollment.enrollmentId}`);
  } catch (pdfErr) {
    logger.warn(`[email] ⚠️ Invoice generation failed, sending without attachment: ${pdfErr.message}`);
  }

  const [coachResult, customerResult] = await Promise.allSettled([
    // Coach email — no invoice needed
    (async () => {
      const { subject, html } = renderTemplate('enrollment_coach', enrollment);
      return transporter.sendMail({
        from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
        to: coachEmail,
        subject,
        html,
      });
    })(),
    // Customer email — with invoice attached
    (async () => {
      const { subject, html } = renderTemplate('enrollment_customer', enrollment);
      return transporter.sendMail({
        from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
        to: enrollment.customerEmail,
        replyTo: coachEmail,
        subject,
        html,
        attachments: invoiceAttachment,
      });
    })(),
  ]);

  if (coachResult.status === 'fulfilled') logger.info(`[email] ✅ Coach notification → ${coachEmail}`);
  else logger.error(`[email] ❌ Coach email failed: ${coachResult.reason?.message}`);

  if (customerResult.status === 'fulfilled') logger.info(`[email] ✅ Customer confirmation + invoice → ${enrollment.customerEmail}`);
  else logger.error(`[email] ❌ Customer email failed: ${customerResult.reason?.message}`);
}