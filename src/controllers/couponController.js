import {
    validateCouponCode,
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

// NOTE: coupon redemption (incrementing used_count) happens server-side
// inside confirmPayment() / the Razorpay webhook via finalizePaidEnrollment()
// — never from a client-triggered call — so a coupon's usage limit can't be
// exhausted by anyone just guessing/spamming a code without ever paying.
// A public POST /api/coupons/redeem endpoint used to exist for this but had
// no caller and no verification that a payment occurred; it was removed.

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