import { Router } from 'express';
import express from 'express';
import { createOrder, confirmPayment, healthCheck, downloadInvoice } from '../controllers/paymentController.js';
import { sendEmail } from '../controllers/emailController.js';
import { paymentLimiter, emailLimiter, assessmentLimiter } from '../middleware/security.js';
import {
    assessmentUpload, submitAssessmentHandler,
    photoOnlyUpload, getPhotoUploadStatusHandler, uploadPhotosByTokenHandler,
} from '../controllers/assessmentController.js';
import { submitLeadHandler } from '../controllers/leadController.js';
import { validateCoupon } from '../controllers/couponController.js';
import { logClientEvent } from '../controllers/logController.js';
import { handleRazorpayWebhook } from '../controllers/webhookController.js';

const router = Router();

// ── Webhook — MUST be registered with express.raw(), and the body must
//    reach here untouched by any JSON parser (see app.js exclusion). ──────────
router.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

router.get('/health', healthCheck);
router.post('/create-order', paymentLimiter, createOrder);
router.post('/confirm-payment', paymentLimiter, confirmPayment);

// ── Email routes — rate limited: real sends from the business inbox +
//    headless-Chrome PDF generation, both expensive to abuse. ────────────────
// `sendEmail` itself whitelists which templates this public route may use
// (contact-form templates only) — see emailController.js.
router.post('/send-email', emailLimiter, sendEmail);
// Verified against the DB by enrollmentId + razorpayPaymentId — see
// downloadInvoice() in paymentController.js. Admin-panel invoice/receipt
// downloads go through the authenticated /api/admin/enrollments/:id/invoice
// and /api/admin/enrollments/:id/payments/:paymentId/receipt routes instead.
router.post('/invoice', emailLimiter, downloadInvoice);

// ── Onboarding assessment — own limiter: accepts up to 3 file uploads
//    (10MB each) plus 2 emails plus a DB insert per call, so the generic
//    global limiter alone is too loose for it. ───────────────────────────────
router.post('/submit-assessment', assessmentLimiter, assessmentUpload, submitAssessmentHandler);

// ── Cold-enquiry leads — hero "Apply For Coaching" modal. Same limiter class
//    as the assessment form: public, unauthenticated, does a DB insert plus
//    fires 2 emails. No file uploads here, but there's no lighter limiter
//    already tuned for "form + DB write + emails, no files". ─────────────────
router.post('/leads', assessmentLimiter, submitLeadHandler);

// ── Upload photos later — token-based, lets a client who skipped photos at
//    onboarding come back and attach them to the same assessment. Same
//    limiter as submit-assessment (file uploads + a DB write). ─────────────
router.get('/upload-assessment-photos/:token', assessmentLimiter, getPhotoUploadStatusHandler);
router.post('/upload-assessment-photos/:token', assessmentLimiter, photoOnlyUpload, uploadPhotosByTokenHandler);

router.post('/coupons/validate', paymentLimiter, validateCoupon);

// ── Transaction logging (frontend can report client-side steps) ─────────────
router.post('/log-event', emailLimiter, logClientEvent);

export default router;