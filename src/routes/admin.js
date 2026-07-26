import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { uploadImage } from '../controllers/uploadController.js';
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
    softDeleteEnrollment, softDeleteAssessment,
} from '../controllers/adminDataController.js';
import { exportAssessments } from '../controllers/adminDataController.js';

import {
    adminListCoupons, adminCreateCoupon, adminUpdateCoupon, adminDeleteCoupon,
} from '../controllers/couponController.js';
import {
    adminListDietPlans, adminGetDietPlan, adminCreateDietPlan, adminUpdateDietPlan, adminDeleteDietPlan,
    adminGetDietPlanByEnrollment,
} from '../controllers/dietPlanController.js';
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


import {
    listTable, createTableRow, updateTableRow, deleteTableRow,
    getSiteKey, putSiteKey,
    getBasicConsultationHandler, putBasicConsultationHandler,
    getPricingHandler, putPricingHandler, deletePricingHandler,
} from '../controllers/adminContentController.js';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

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
router.delete('/enrollments/:id', softDeleteEnrollment);

router.get('/assessments', listAssessments);
router.get('/assessments/:id', getAssessment);
router.patch('/assessments/:id/status', updateAssessmentStatus);
router.patch('/assessments/:id/reviewed', updateAssessmentReviewed);
router.delete('/assessments/:id', softDeleteAssessment);
router.put('/notes', upsertNote);

router.get('/coupons', adminListCoupons);
router.post('/coupons', adminCreateCoupon);
router.patch('/coupons/:id', adminUpdateCoupon);
router.delete('/coupons/:id', adminDeleteCoupon);

router.get('/diet-plans', adminListDietPlans);
router.post('/diet-plans', adminCreateDietPlan);
router.get('/diet-plans/by-enrollment/:enrollmentId', adminGetDietPlanByEnrollment);
router.get('/diet-plans/:id', adminGetDietPlan);
router.patch('/diet-plans/:id', adminUpdateDietPlan);
router.delete('/diet-plans/:id', adminDeleteDietPlan);

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

router.get('/content/site/:key', getSiteKey);
router.put('/content/site/:key', putSiteKey);

router.get('/content/basic-consultation', getBasicConsultationHandler);
router.put('/content/basic-consultation', putBasicConsultationHandler);

router.get('/content/pricing', getPricingHandler);
router.put('/content/pricing', putPricingHandler);
router.delete('/content/pricing/:id', deletePricingHandler);

router.get('/content/:table', listTable);
router.post('/content/:table', createTableRow);
router.patch('/content/:table/:id', updateTableRow);
router.delete('/content/:table/:id', deleteTableRow);

router.post('/upload', upload.single('file'), uploadImage);

export default router;