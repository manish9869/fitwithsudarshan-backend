// ── Simple input validators ───────────────────────────────────────────────────

const VALID_COACHING_TYPES = ['online', 'video', 'personal'];
const VALID_PLAN_TYPES = ['individual', 'couple', 'basic_individual', 'basic_couple'];
const VALID_DURATIONS = ['1', '3', '6', '12'];

// NOTE: /api/create-order no longer accepts `amount` from the client — the
// server resolves the real price itself via resolvePrice() to prevent price
// tampering. Validate the plan-selection fields instead.
export function validateCreateOrder(body, validCoachingTypes) {
    const errors = [];
    const { coachingType, planType, durationMonths, customerName, customerEmail } = body;

    if (!coachingType || !validCoachingTypes.includes(coachingType)) {
        errors.push(`coachingType must be one of: ${validCoachingTypes.join(', ')}`);
    }
    if (!planType || !VALID_PLAN_TYPES.includes(planType)) {
        errors.push(`planType must be one of: ${VALID_PLAN_TYPES.join(', ')}`);
    }
    const isBasic = planType === 'basic_individual' || planType === 'basic_couple';
    if (!isBasic && durationMonths && !VALID_DURATIONS.includes(String(durationMonths))) {
        errors.push(`durationMonths must be one of: ${VALID_DURATIONS.join(', ')}`);
    }
    if (!customerName || !customerName.trim()) errors.push('customerName is required');
    if (!customerEmail || !customerEmail.includes('@')) errors.push('A valid customerEmail is required');

    return errors;
}

export function validateVerifyPayment(body) {
    const errors = [];
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id) errors.push('razorpay_order_id is required');
    if (!razorpay_payment_id) errors.push('razorpay_payment_id is required');
    if (!razorpay_signature) errors.push('razorpay_signature is required');

    return errors;
}