import { Router } from 'express';
import { createOrder, verifyPayment, healthCheck, downloadInvoice, createEnrollment } from '../controllers/paymentController.js';
import { sendEmail, sendEnrollmentEmails } from '../controllers/emailController.js';
import { paymentLimiter } from '../middleware/security.js';
import { assessmentUpload, submitAssessmentHandler } from '../controllers/assessmentController.js';
import { validateCoupon, redeemCoupon } from '../controllers/couponController.js';
import { logClientEvent } from '../controllers/logController.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/create-order', paymentLimiter, createOrder);
router.post('/verify-payment', paymentLimiter, verifyPayment);
router.post('/create-enrollment', paymentLimiter, createEnrollment);

// ── Email routes ──────────────────────────────────────────────────────────────
router.post('/send-email', sendEmail);
router.post('/send-enrollment-emails', sendEnrollmentEmails);
router.post('/invoice', downloadInvoice);

// ── Onboarding assessment ─────────────────────────────────────────────────────
router.post('/submit-assessment', assessmentUpload, submitAssessmentHandler);

router.post('/coupons/validate', paymentLimiter, validateCoupon);
router.post('/coupons/redeem', paymentLimiter, redeemCoupon);

// ── Transaction logging (frontend can report client-side steps) ─────────────
router.post('/log-event', logClientEvent);

export default router;