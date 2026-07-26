import { Router } from 'express';
import express from 'express';
import { createOrder, confirmPayment, healthCheck, downloadInvoice, downloadPaymentReceipt } from '../controllers/paymentController.js';
import { sendEmail, sendEnrollmentEmails } from '../controllers/emailController.js';
import { paymentLimiter, emailLimiter } from '../middleware/security.js';
import { assessmentUpload, submitAssessmentHandler } from '../controllers/assessmentController.js';
import { validateCoupon, redeemCoupon } from '../controllers/couponController.js';
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
router.post('/send-email', emailLimiter, sendEmail);
router.post('/send-enrollment-emails', emailLimiter, sendEnrollmentEmails);
router.post('/invoice', emailLimiter, downloadInvoice);
router.post('/payment-receipt', emailLimiter, downloadPaymentReceipt);

// ── Onboarding assessment ─────────────────────────────────────────────────────
router.post('/submit-assessment', assessmentUpload, submitAssessmentHandler);

router.post('/coupons/validate', paymentLimiter, validateCoupon);
router.post('/coupons/redeem', paymentLimiter, redeemCoupon);

// ── Transaction logging (frontend can report client-side steps) ─────────────
router.post('/log-event', emailLimiter, logClientEvent);

export default router;