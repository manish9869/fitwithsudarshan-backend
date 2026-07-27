/**
 * backend/scripts/fixFailedEnrollmentRevenue.js
 *
 * ONE-TIME, TARGETED correction for enrollment_id = FIT-2026-443879 (Syed),
 * approved via chat on 2026-07-26. This row was marked payment_status =
 * 'failed' after presumably having been 'paid' at some point, but
 * amount_paid/balance_due were never reset — that stale ₹3,999 was the
 * entire cause of the Enrollments-page revenue total (₹16,480) not matching
 * the Dashboard (₹12,481). See diagnoseRevenue.js for the full investigation.
 *
 * Safety: matches on the exact enrollment_id, aborts if the match count is
 * anything other than exactly 1, and prints the before/after state.
 *
 * Usage: node src/scripts/fixFailedEnrollmentRevenue.js
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const TARGET_ENROLLMENT_ID = 'FIT-2026-443879';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket },
});

async function main() {
    const { data: matches, error: findErr } = await supabase
        .from('enrollments')
        .select('id, enrollment_id, customer_name, payment_status, amount_paid, total_amount, balance_due, payment_plan_status')
        .eq('enrollment_id', TARGET_ENROLLMENT_ID);

    if (findErr) {
        console.error('❌ Lookup failed:', findErr.message);
        process.exit(1);
    }
    if (!matches || matches.length !== 1) {
        console.error(`❌ Aborting — expected exactly 1 row matching enrollment_id=${TARGET_ENROLLMENT_ID}, found ${matches?.length ?? 0}.`);
        process.exit(1);
    }

    const before = matches[0];
    console.log('BEFORE:', JSON.stringify(before, null, 2));

    if (before.payment_status !== 'failed') {
        console.error(`❌ Aborting — expected payment_status='failed', found '${before.payment_status}'. Data may have changed since this script was written.`);
        process.exit(1);
    }

    const total = Number(before.total_amount ?? before.amount_paid ?? 0);

    const { data: after, error: updateErr } = await supabase
        .from('enrollments')
        .update({ amount_paid: 0, balance_due: total, payment_plan_status: 'pending' })
        .eq('id', before.id)
        .select()
        .single();

    if (updateErr) {
        console.error('❌ Update failed:', updateErr.message);
        process.exit(1);
    }

    console.log('\nAFTER:', JSON.stringify({
        id: after.id, enrollment_id: after.enrollment_id, payment_status: after.payment_status,
        amount_paid: after.amount_paid, total_amount: after.total_amount, balance_due: after.balance_due,
        payment_plan_status: after.payment_plan_status,
    }, null, 2));

    console.log('\n✅ Done.');
}

main();
