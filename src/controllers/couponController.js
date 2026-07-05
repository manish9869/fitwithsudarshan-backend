import {
    validateCouponCode, incrementCouponUsage,
    listCoupons, createCoupon, updateCoupon, deleteCoupon,
} from '../services/couponService.js';
import logger from '../config/logger.js';

// ── PUBLIC: POST /api/coupons/validate ──────────────────────────────────────
export async function validateCoupon(req, res) {
    try {
        const { code, coachingType, planType, durationMonths, originalPrice } = req.body || {};
        if (!code || !coachingType || !planType || originalPrice == null) {
            return res.status(400).json({ valid: false, error: 'Missing required fields.' });
        }
        const result = await validateCouponCode({ code, coachingType, planType, durationMonths, originalPrice: Number(originalPrice) });
        return res.json(result);
    } catch (err) {
        logger.error(`[coupon] validate failed: ${err.message}`);
        return res.status(500).json({ valid: false, error: 'Could not validate coupon. Please try again.' });
    }
}

// ── PUBLIC: POST /api/coupons/redeem (fire-and-forget after successful payment) ──
export async function redeemCoupon(req, res) {
    try {
        const { code } = req.body || {};
        if (code) await incrementCouponUsage(code);
        return res.json({ success: true });
    } catch (err) {
        logger.error(`[coupon] redeem failed: ${err.message}`);
        return res.status(200).json({ success: false }); // non-blocking, never fail the client
    }
}

// ── ADMIN: /api/admin/coupons ───────────────────────────────────────────────
export async function adminListCoupons(req, res) {
    try {
        return res.json({ coupons: await listCoupons() });
    } catch (err) {
        logger.error(`[admin] listCoupons failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load coupons.' });
    }
}

export async function adminCreateCoupon(req, res) {
    try {
        const coupon = await createCoupon(req.body);
        logger.info(`[admin] ${req.admin.username} created coupon ${coupon.code}`);
        return res.status(201).json({ coupon });
    } catch (err) {
        logger.error(`[admin] createCoupon failed: ${err.message}`);
        const msg = err.message?.includes('duplicate') ? 'A coupon with this code already exists.' : 'Failed to create coupon.';
        return res.status(400).json({ error: msg });
    }
}

export async function adminUpdateCoupon(req, res) {
    try {
        const coupon = await updateCoupon(req.params.id, req.body);
        logger.info(`[admin] ${req.admin.username} updated coupon ${coupon.code}`);
        return res.json({ coupon });
    } catch (err) {
        logger.error(`[admin] updateCoupon failed: ${err.message}`);
        return res.status(400).json({ error: 'Failed to update coupon.' });
    }
}

export async function adminDeleteCoupon(req, res) {
    try {
        await deleteCoupon(req.params.id);
        logger.info(`[admin] ${req.admin.username} deleted coupon ${req.params.id}`);
        return res.json({ success: true });
    } catch (err) {
        logger.error(`[admin] deleteCoupon failed: ${err.message}`);
        return res.status(400).json({ error: 'Failed to delete coupon.' });
    }
}