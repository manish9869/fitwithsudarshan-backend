// ── Simple input validators ───────────────────────────────────────────────────

export function validateCreateOrder(body) {
    const errors = [];
    const { amount, currency } = body;

    if (amount === undefined || amount === null) {
        errors.push('amount is required');
    } else if (isNaN(Number(amount))) {
        errors.push('amount must be a number (in paise)');
    } else if (Math.round(Number(amount)) < 100) {
        errors.push('amount must be at least 100 paise (₹1)');
    }

    if (currency && !/^[A-Z]{3}$/.test(currency)) {
        errors.push('currency must be a 3-letter ISO code (e.g. INR)');
    }

    return errors;
}

export function validateVerifyPayment(body) {
    const errors = [];
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id)  errors.push('razorpay_order_id is required');
    if (!razorpay_payment_id) errors.push('razorpay_payment_id is required');
    if (!razorpay_signature)  errors.push('razorpay_signature is required');

    return errors;
}
