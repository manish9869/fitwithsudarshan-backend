import { Router } from 'express';
import { createOrder, verifyPayment, healthCheck, downloadInvoice } from '../controllers/paymentController.js';
import { sendEmail, sendEnrollmentEmails } from '../controllers/emailController.js';
import { paymentLimiter } from '../middleware/security.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/create-order', paymentLimiter, createOrder);
router.post('/verify-payment', paymentLimiter, verifyPayment);

// ── Email routes ──────────────────────────────────────────────────────────────

// Generic: send any single template to any recipient
// Body: { template: "welcome", to: "user@example.com", data: { customerName: "..." } }
router.post('/send-email', sendEmail);

// Convenience: fires enrollment_coach + enrollment_customer in one shot
// Body: full enrollment object from enrollmentService.js
router.post('/send-enrollment-emails', sendEnrollmentEmails);


router.post('/invoice', downloadInvoice);

export default router;