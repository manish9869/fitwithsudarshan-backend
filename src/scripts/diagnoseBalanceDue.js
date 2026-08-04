/**
 * backend/scripts/diagnoseBalanceDue.js
 *
 * READ-ONLY. Investigates why a pending (never-completed) enrollment might
 * still be showing on the admin Balance Due page, by:
 *   1. Calling the REAL listOutstandingBalances() (same function the page
 *      uses) against the live DB.
 *   2. Separately listing every row with balance_due > 0, unfiltered, so we
 *      can see exactly which ones the exclusion filter is (or isn't) removing.
 *
 * Usage: node src/scripts/diagnoseBalanceDue.js
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import { listOutstandingBalances } from '../services/paymentLedgerService.js';

async function main() {
    const supabase = getSupabaseAdmin();

    const { data: allBalanceRows, error: e1 } = await supabase
        .from('enrollments')
        .select('id, enrollment_id, customer_name, source, payment_status, payment_plan_status, amount_paid, total_amount, balance_due, deleted_at')
        .is('deleted_at', null)
        .gt('balance_due', 0);

    if (e1) { console.error('❌', e1.message); process.exit(1); }

    console.log(`\n── ALL rows with balance_due > 0 (unfiltered) — ${allBalanceRows.length} ──`);
    for (const r of allBalanceRows) {
        console.log(
            `  ${r.enrollment_id || r.id} | ${r.customer_name || '—'} | source=${r.source} | ` +
            `payment_status=${JSON.stringify(r.payment_status)} | plan_status=${r.payment_plan_status} | ` +
            `amount_paid=${r.amount_paid} total=${r.total_amount} balance_due=${r.balance_due}`
        );
    }

    const shown = await listOutstandingBalances();
    console.log(`\n── What listOutstandingBalances() (the real Balance Due page query) actually returns — ${shown.length} ──`);
    for (const r of shown) {
        console.log(`  ${r.enrollment_id || r.id} | ${r.customer_name || '—'} | source=${r.source} | payment_status=${JSON.stringify(r.payment_status)}`);
    }

    const shownIds = new Set(shown.map((r) => r.id));
    const wronglyIncluded = shown.filter((r) => r.source === 'website' && r.payment_status === 'pending');
    const wronglyExcluded = allBalanceRows.filter((r) => !shownIds.has(r.id) && !(r.source === 'website' && r.payment_status === 'pending'));

    console.log(`\n── Rows that SHOULD have been excluded but weren't: ${wronglyIncluded.length} ──`);
    for (const r of wronglyIncluded) console.log('  ', JSON.stringify(r));

    console.log(`\n── Rows excluded that maybe shouldn't have been: ${wronglyExcluded.length} ──`);
    for (const r of wronglyExcluded) console.log('  ', JSON.stringify(r));
}

main();
