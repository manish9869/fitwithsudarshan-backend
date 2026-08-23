import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

const PLAN_NAMES = { online: 'Online Coaching', video: 'Video Coaching', personal: 'Mumbai Personal Training' };

export async function findCouponByCode(code) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .ilike('code', code.trim())
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function validateCouponCode({ code, coachingType, planType, durationMonths, originalPrice }) {
    if (!code || !code.trim()) return { valid: false, error: 'Please enter a coupon code.' };

    const coupon = await findCouponByCode(code);
    if (!coupon) return { valid: false, error: 'Invalid coupon code. Please check and try again.' };
    if (!coupon.active) return { valid: false, error: 'This coupon has expired.' };

    const now = new Date();
    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
        return { valid: false, error: 'This coupon is not active yet.' };
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
        return { valid: false, error: 'This coupon has expired.' };
    }
    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
        return { valid: false, error: 'This coupon has reached its usage limit.' };
    }

    if (coupon.applicable_coaching_types?.length && !coupon.applicable_coaching_types.includes(coachingType)) {
        const names = coupon.applicable_coaching_types.map((id) => PLAN_NAMES[id] || id).join(', ');
        return { valid: false, error: `This coupon is only valid for: ${names}.` };
    }
    if (coupon.applicable_plan_types?.length && !coupon.applicable_plan_types.includes(planType)) {
        return { valid: false, error: 'This coupon is not valid for this plan type.' };
    }
    if (coupon.applicable_durations?.length && !coupon.applicable_durations.includes(String(durationMonths))) {
        const labels = { 1: '1 Month', 3: '3 Months', 6: '6 Months', 12: '12 Months' };
        const list = coupon.applicable_durations.map((m) => labels[m] || `${m} Month(s)`).join(', ');
        return { valid: false, error: `This coupon is only valid for: ${list}.` };
    }

    let discountedPrice = originalPrice;
    if (coupon.type === 'FIXED_PRICE') {
        const planPrices = coupon.fixed_prices?.[planType];
        if (!planPrices) return { valid: false, error: 'Coupon not applicable to this plan type.' };
        discountedPrice = planPrices[durationMonths] ?? originalPrice;
    } else if (coupon.type === 'PERCENT') {
        discountedPrice = Math.round(originalPrice * (1 - coupon.percent / 100));
    } else if (coupon.type === 'FLAT') {
        discountedPrice = Math.max(0, originalPrice - coupon.flat);
    }

    const savings = originalPrice - discountedPrice;

    return {
        valid: true,
        discountedPrice,
        savings,
        coupon: { code: coupon.code, label: coupon.label, description: coupon.description },
    };
}

// Atomic increment via Postgres RPC — avoids the read-then-write race where
// two near-simultaneous redemptions could both read the same used_count and
// under-count usage. Falls back to the old read-then-write path only if the
// RPC function hasn't been created yet in Supabase (see SQL migration).
//
// NOTE on max_uses: validateCouponCode() checks the cap once, at
// checkout-start — well before payment. Two customers who both start
// checkout with the same limited-use code inside that window can both pass
// that check, both pay, and both land here. The re-check below (against a
// freshly-read row) can't fully close that race either — two redemptions
// finalizing at the truly same instant can still both read used_count
// before either writes — but it shrinks the exploitable window from
// "anytime during checkout" (which can be minutes) down to "two payments
// completing within the same instant", and stops a coupon from being
// oversold *further* once it's already at its cap. A fully atomic fix needs
// increment_coupon_usage itself to do a conditional
// `UPDATE ... WHERE used_count < max_uses` and report back whether the cap
// was already hit — that lives in Supabase, not this repo, so it isn't
// something this fix can reach.
export async function incrementCouponUsage(code) {
    const supabase = getSupabaseAdmin();
    const coupon = await findCouponByCode(code);
    if (!coupon) return;

    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
        console.error(
            `[couponService] coupon "${code}" already at its usage cap (${coupon.used_count}/${coupon.max_uses}) at ` +
            `finalize time — payment succeeded but usage was NOT incremented further. Flag for manual review.`
        );
        return;
    }

    const { error: rpcError } = await supabase.rpc('increment_coupon_usage', { coupon_id: coupon.id });

    if (rpcError) {
        // RPC missing/misconfigured — fall back so usage tracking never
        // just silently stops working, but log it loudly so it gets fixed.
        console.error(`[couponService] increment_coupon_usage RPC failed (${rpcError.message}) — falling back to non-atomic update.`);
        await supabase.from('coupons').update({ used_count: (coupon.used_count || 0) + 1 }).eq('id', coupon.id);
    }
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────
export async function listCoupons() {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function createCoupon(payload) {
    const supabase = getSupabaseAdmin();
    const row = { ...payload, code: payload.code.trim().toUpperCase() };
    const { data, error } = await supabase.from('coupons').insert([row]).select().single();
    if (error) throw error;
    return data;
}

export async function updateCoupon(id, payload) {
    const supabase = getSupabaseAdmin();
    const row = { ...payload, updated_at: new Date().toISOString() };
    if (row.code) row.code = row.code.trim().toUpperCase();
    const { data, error } = await supabase.from('coupons').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

export async function deleteCoupon(id) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('coupons').delete().eq('id', id);
    if (error) throw error;
}