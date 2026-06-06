import { Router } from 'express';
import { createOrder, verifyPayment, healthCheck } from '../controllers/paymentController.js';
import { paymentLimiter } from '../middleware/security.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/create-order', paymentLimiter, createOrder);
router.post('/verify-payment', paymentLimiter, verifyPayment);

export default router;
