/**
 * backend/src/routes/admin.js
 *
 * All admin panel routes live under /api/admin (mounted in app.js).
 * Every route except /login is protected by requireAdminAuth.
 */
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
    getDashboard,
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
} from '../controllers/manualEnrollmentController.js';
import { getTxnTimelineHandler } from '../controllers/logController.js';

const router = Router();

// Stricter limiter on login to slow down brute-force attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// ── Public (within /api/admin) ───────────────────────────────────────────────
router.post('/login', loginLimiter, adminLogin);

// ── Everything below requires a valid admin JWT ──────────────────────────────
router.use(requireAdminAuth);

router.get('/me', adminMe);
router.get('/assessments/export', exportAssessments);
router.post('/change-password', adminChangePassword);

router.get('/dashboard', getDashboard);

router.get('/enrollments', listEnrollments);
router.get('/enrollments/export', exportEnrollments);
router.get('/enrollments/:id', getEnrollment);
router.patch('/enrollments/:id/status', updateEnrollmentStatus);

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

router.get('/follow-ups', listFollowUps);
router.get('/follow-ups/count', followUpsDueCount);
router.post('/enrollments/:id/followup', markFollowUp);

// ── Transaction timeline viewer — GET /api/admin/txn-timeline?orderId=... ──
router.get('/txn-timeline', getTxnTimelineHandler);

export default router;