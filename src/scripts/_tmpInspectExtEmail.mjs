import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { renderTemplate } from '../services/emailTemplates.js';
import '../config/env.js';

const supabase = getSupabaseAdmin();
const { data: row } = await supabase.from('enrollments').select('*').eq('id', '5f571623-381b-4e67-a6b9-527284d57051').single();

// Mirror toTemplateData() from manualEnrollmentController.js exactly
const templateData = {
    enrollmentId: row.enrollment_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    programName: row.program_name,
    planType: row.plan_type,
    durationMonths: row.duration_months,
    coachingType: row.coaching_type,
    amountPaid: row.amount_paid,
    originalAmount: row.original_amount,
    couponCode: row.coupon_code,
    couponSavings: row.coupon_savings,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    paymentDate: row.payment_date,
    goals: row.goals,
    partnerGoals: row.partner_goals,
    totalAmount: row.total_amount,
    balanceDue: row.balance_due,
};

console.log('=== RAW ROW FIELDS USED ===');
console.log({ program_name: row.program_name, duration_months: row.duration_months, amount_paid: row.amount_paid, coaching_type: row.coaching_type, plan_type: row.plan_type });

const customer = renderTemplate('enrollment_extended_customer', templateData);
const coach = renderTemplate('enrollment_extended_coach', templateData);

console.log('\n=== CUSTOMER SUBJECT ===');
console.log(customer.subject);
console.log('\n=== COACH SUBJECT ===');
console.log(coach.subject);

const fs = await import('fs');
fs.writeFileSync('src/scripts/_ext_customer.html', customer.html);
fs.writeFileSync('src/scripts/_ext_coach.html', coach.html);
console.log('\nWrote HTML files for inspection.');
process.exit(0);
