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
    upsertNote,
    getDashboard,
} from '../controllers/adminDataController.js';

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
router.post('/change-password', adminChangePassword);

router.get('/dashboard', getDashboard);

router.get('/enrollments', listEnrollments);
router.get('/enrollments/export', exportEnrollments);
router.get('/enrollments/:id', getEnrollment);
router.patch('/enrollments/:id/status', updateEnrollmentStatus);

router.get('/assessments', listAssessments);
router.get('/assessments/:id', getAssessment);
router.patch('/assessments/:id/status', updateAssessmentStatus);

router.put('/notes', upsertNote);

export default router;