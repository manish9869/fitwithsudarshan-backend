import nodemailer from 'nodemailer';
import { renderTemplate, TEMPLATE_NAMES } from '../services/emailTemplates.js';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import { generateInvoiceBuffer } from '../services/invoiceService.js';
import { fetchPdfAttachment, DEFAULT_RESOURCE_VAULT_PDF_URL } from '../services/pdfAttachmentService.js';
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

    // ── Resource vault PDF attachment ─────────────────────────────────────
    // The URL is always server-controlled (env var or the hardcoded default)
    // — never taken from the request body. `fetchPdfAttachment` does a raw
    // fetch() with no domain restriction, so trusting a client-supplied URL
    // here would let anyone make this server fetch arbitrary URLs (SSRF) and
    // have the response emailed out as an attachment.
    let attachments = [];
    let hasAttachment = false;
    if (template === 'resource_vault') {
      const pdfUrl = process.env.RESOURCE_VAULT_PDF_URL || DEFAULT_RESOURCE_VAULT_PDF_URL;
      const attachment = await fetchPdfAttachment(pdfUrl, 'RECODE-Comeback-Blueprint.pdf');
      if (attachment) {
        attachments = [attachment];
        hasAttachment = true;
      }
    }

    const { subject, html } = renderTemplate(template, { ...data, hasAttachment });

    await getTransporter().sendMail({
      from: `"RECODE™ by FitWithSudarshan" <${config.email.gmailUser}>`,
      to,
      replyTo: config.email.coachEmail || config.email.gmailUser,
      subject,
      html,
      attachments,
    });

    logger.info(`[email] ✅ Sent template="${template}" → ${to}${hasAttachment ? ' (with PDF attachment)' : ''}`);
    return res.json({ success: true, attached: hasAttachment });

  } catch (err) {
    logger.error(`[email] ❌ Failed: ${err.message}`);
    next(err);
  }
}

// ── POST /api/send-enrollment-emails ─────────────────────────────────────────
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

    res.status(202).json({ success: true, queued: true });

    _sendEnrollmentEmailsBackground(enrollment).catch((err) =>
      logger.error(`[email] Background enrollment email error: ${err.message}`)
    );

  } catch (err) {
    if (!res.headersSent) next(err);
    else logger.error(`[email] sendEnrollmentEmails outer error: ${err.message}`);
  }
}

async function _sendEnrollmentEmailsBackground(enrollment) {
  logger.info(`[email:enrollment] START — enrollmentId=${enrollment.enrollmentId} to=${enrollment.customerEmail}`);
  const transporter = getTransporter();
  const coachEmail = config.email.coachEmail || config.email.gmailUser;

  let invoiceAttachment = [];
  try {
    logger.info(`[email:enrollment] generating invoice PDF...`);
    const invoiceBuffer = generateInvoiceBuffer(enrollment);
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
        attachments: invoiceAttachment,
      });
    })(),
  ]);

  if (coachResult.status === 'fulfilled') logger.info(`[email] ✅ Coach notification → ${coachEmail}`);
  else logger.error(`[email] ❌ Coach email failed: ${coachResult.reason?.message}`);

  if (customerResult.status === 'fulfilled') logger.info(`[email] ✅ Customer confirmation + invoice → ${enrollment.customerEmail}`);
  else logger.error(`[email] ❌ Customer email failed: ${customerResult.reason?.message}`);
}