/**
 * backend/scripts/diagnoseRevenue.js
 *
 * READ-ONLY. Investigates the revenue mismatch between the admin Dashboard,
 * the Enrollments list, and the Manual Enrollments list by reproducing each
 * page's actual sum logic against the real data, and flags rows whose
 * amount_paid looks inconsistent with their payment_status.
 *
 * Usage: node src/scripts/diagnoseRevenue.js
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

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

function inr(n) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

async function main() {
    const { data: rows, error } = await supabase
        .from('enrollments')
        .select('id, enrollment_id, customer_name, source, payment_status, payment_plan_status, amount_paid, total_amount, balance_due, original_amount, created_at, deleted_at');

    if (error) {
        console.error('❌ Query failed:', error.message);
        process.exit(1);
    }

    const live = rows.filter((r) => !r.deleted_at);
    console.log(`\nTotal enrollments (non-deleted): ${live.length}\n`);

    // ── Reproduce each page's actual sum logic ──────────────────────────────
    const dashboardSum90d = sumWhere(live, (r) =>
        r.payment_status === 'paid' && new Date(r.created_at) >= daysAgo(90));
    const enrollmentsPageSumAll = sumWhere(live, () => true); // current Enrollments-page bug: no status filter
    const enrollmentsPageSumPaidOnly = sumWhere(live, (r) => r.payment_status === 'paid');
    const manualPageSumAll = sumWhere(live.filter((r) => r.source === 'manual'), () => true);
    const manualPageSumPaidOnly = sumWhere(live.filter((r) => r.source === 'manual'), (r) => r.payment_status === 'paid');

    console.log('── Reproducing each page\'s current calculation ──────────────');
    console.log(`Dashboard  (paid, last 90d):           ${inr(dashboardSum90d)}`);
    console.log(`Enrollments page (ALL statuses, all time, current bug): ${inr(enrollmentsPageSumAll)}`);
    console.log(`Enrollments page (paid-only, all time, after fix):      ${inr(enrollmentsPageSumPaidOnly)}`);
    console.log(`Manual page (ALL statuses, current bug):                ${inr(manualPageSumAll)}`);
    console.log(`Manual page (paid-only, after fix):                     ${inr(manualPageSumPaidOnly)}`);

    // ── Flag rows where amount_paid looks wrong for the row's status ───────
    const suspicious = live.filter((r) =>
        r.payment_status !== 'paid' && Number(r.amount_paid) > 0
    );

    console.log(`\n── Rows with payment_status != 'paid' but amount_paid > 0 (bug signature) ──`);
    console.log(`Count: ${suspicious.length}`);
    let suspiciousTotal = 0;
    for (const r of suspicious) {
        suspiciousTotal += Number(r.amount_paid) || 0;
        console.log(
            `  ${r.enrollment_id || r.id} | ${r.customer_name || '—'} | source=${r.source} | status=${r.payment_status} | ` +
            `amount_paid=${r.amount_paid} total_amount=${r.total_amount} balance_due=${r.balance_due} | created_at=${r.created_at}`
        );
    }
    console.log(`Sum of amount_paid on these rows: ${inr(suspiciousTotal)}`);

    // ── Flag paid/partial rows where amount_paid doesn't reconcile with
    //    total_amount - balance_due (a different kind of drift) ────────────
    const driftRows = live.filter((r) => {
        if (r.total_amount == null || r.balance_due == null) return false;
        const expectedPaid = Number(r.total_amount) - Number(r.balance_due);
        return Math.abs(expectedPaid - Number(r.amount_paid || 0)) > 1; // >₹1 rounding tolerance
    });
    console.log(`\n── Rows where amount_paid != total_amount - balance_due ──`);
    console.log(`Count: ${driftRows.length}`);
    for (const r of driftRows) {
        console.log(
            `  ${r.enrollment_id || r.id} | ${r.customer_name || '—'} | status=${r.payment_status} | ` +
            `amount_paid=${r.amount_paid} total_amount=${r.total_amount} balance_due=${r.balance_due}`
        );
    }

    // ── Breakdown by status/source for context ──────────────────────────────
    console.log(`\n── Breakdown by payment_status ──`);
    const byStatus = {};
    for (const r of live) {
        const k = r.payment_status || '(null)';
        byStatus[k] ??= { count: 0, amountPaidSum: 0 };
        byStatus[k].count += 1;
        byStatus[k].amountPaidSum += Number(r.amount_paid) || 0;
    }
    for (const [status, v] of Object.entries(byStatus)) {
        console.log(`  ${status}: count=${v.count} sum(amount_paid)=${inr(v.amountPaidSum)}`);
    }

    console.log(`\n── Breakdown by source ──`);
    const bySource = {};
    for (const r of live) {
        const k = r.source || '(null)';
        bySource[k] ??= { count: 0, amountPaidSum: 0 };
        bySource[k].count += 1;
        bySource[k].amountPaidSum += Number(r.amount_paid) || 0;
    }
    for (const [source, v] of Object.entries(bySource)) {
        console.log(`  ${source}: count=${v.count} sum(amount_paid)=${inr(v.amountPaidSum)}`);
    }
}

function sumWhere(rows, predicate) {
    return rows.filter(predicate).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
}
function daysAgo(n) {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

main();
