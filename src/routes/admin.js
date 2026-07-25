import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { adminLogin, adminMe, adminChangePassword } from '../controllers/adminAuthController.js';
import {
    listEnrollments,
    getEnrollment,
    updateEnrollmentStatus,
    exportEnrollments,
    listAssessments,
    getAssessment,
    updateAssessmentStatus,
    updateAssessmentReviewed,
    upsertNote,
    getDashboard, getFunnelAudit,
} from '../controllers/adminDataController.js';
import { exportAssessments } from '../controllers/adminDataController.js';

import {
    adminListCoupons, adminCreateCoupon, adminUpdateCoupon, adminDeleteCoupon,
} from '../controllers/couponController.js';
import {
    createManualEnrollment,
    updateManualEnrollment,
    sendEnrollmentEmail,
    listFollowUps,
    followUpsDueCount,
    markFollowUp,
    searchEnrollmentsByContact,
    getEnrollmentPayments,
    addEnrollmentPayment,
    listBalanceDue,
    sendBalanceReminder,
    sendPaymentReceiptEmail, deleteManualEnrollment,
} from '../controllers/manualEnrollmentController.js';
import { getTxnTimelineHandler } from '../controllers/logController.js';

const router = Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

router.post('/login', loginLimiter, adminLogin);

router.use(requireAdminAuth);

router.get('/me', adminMe);
router.get('/assessments/export', exportAssessments);
router.post('/change-password', adminChangePassword);

router.get('/dashboard', getDashboard);

// NOTE: /search and /export must be registered BEFORE /:id or Express will
// try to treat "search"/"export" as an :id param.
router.get('/enrollments/export', exportEnrollments);
router.get('/enrollments/search', searchEnrollmentsByContact);
router.get('/enrollments', listEnrollments);
router.get('/enrollments/:id', getEnrollment);
router.get('/funnel-audit', getFunnelAudit);
router.patch('/enrollments/:id/status', updateEnrollmentStatus);
router.delete('/enrollments/manual/:id', deleteManualEnrollment);


router.get('/assessments', listAssessments);
router.get('/assessments/:id', getAssessment);
router.patch('/assessments/:id/status', updateAssessmentStatus);
router.patch('/assessments/:id/reviewed', updateAssessmentReviewed);

router.put('/notes', upsertNote);

router.get('/coupons', adminListCoupons);
router.post('/coupons', adminCreateCoupon);
router.patch('/coupons/:id', adminUpdateCoupon);
router.delete('/coupons/:id', adminDeleteCoupon);

router.post('/enrollments/manual', createManualEnrollment);
router.patch('/enrollments/manual/:id', updateManualEnrollment);
router.post('/enrollments/:id/send-email', sendEnrollmentEmail);

// ── Payment ledger / partial payments ────────────────────────────────────────
router.get('/enrollments/:id/payments', getEnrollmentPayments);
router.post('/enrollments/:id/payments', addEnrollmentPayment);
router.post('/enrollments/:id/payments/:paymentId/send-receipt', sendPaymentReceiptEmail);
router.get('/balance-due', listBalanceDue);
router.post('/enrollments/:id/send-balance-reminder', sendBalanceReminder);

router.get('/follow-ups', listFollowUps);
router.get('/follow-ups/count', followUpsDueCount);
router.post('/enrollments/:id/followup', markFollowUp);

router.get('/txn-timeline', getTxnTimelineHandler);

export default router;