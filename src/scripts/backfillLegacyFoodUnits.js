// src/scripts/backfillLegacyFoodUnits.js
//
// The ~150 hand-seeded foods from seedDietData.js predate the structured
// serving_qty/serving_unit fields — they only have a free-text serving_size
// ("1 cup", "1 bowl", "100g"...). Without a real gram weight, the Diet Plan
// Builder can't convert them to other units (it falls back to a plain "x N"
// multiplier — safe, but not what quick-start templates need since most of
// their prefilled foods are exactly these legacy rows).
//
// This parses each food's existing serving_size text into a real
// serving_qty + serving_unit (from the same admin-editable diet_units list
// used everywhere else), so every food gets real unit conversion. Only
// touches rows where serving_unit IS NULL — anything already migrated
// (CSV-imported foods, or foods an admin has since edited) is left alone.
//
// Usage:
//   node src/scripts/backfillLegacyFoodUnits.js            → dry run
//   node src/scripts/backfillLegacyFoodUnits.js --apply     → writes updates
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SECRET_KEY missing from backend .env');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { realtime: { transport: WebSocket } });

// Mirrors the same unit vocabulary as DEFAULT_DIET_UNITS (frontend
// src/utils/siteContentDefaults.js) — kept as plain labels here since this
// script only needs to assign a unit name, not its gram weight.
function parseServingSize(raw) {
    const t = String(raw || '').trim().toLowerCase();
    if (!t) return null;

    // Compound multi-ingredient descriptions ("2 slices + 2 eggs") can't be
    // reduced to one qty+unit — treat the whole plate as a single serving.
    if (t.includes('+')) return { qty: 1, unit: 'Piece' };

    let m;
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*g$/))) return { qty: Number(m[1]), unit: 'Grams (g)' };
    if (t.match(/^1\/2\s*cup$/)) return { qty: 0.5, unit: 'Cup - Medium' };

    const leadingNum = () => {
        const n = t.match(/^(\d+(?:\.\d+)?)/);
        return n ? Number(n[1]) : 1;
    };

    if (t.includes('cup')) return { qty: leadingNum(), unit: 'Cup - Medium' };
    if (t.includes('bowl')) return { qty: leadingNum(), unit: 'Bowl - Medium' };
    if (t.includes('glass')) return { qty: 1, unit: 'Glass' };
    if (t.includes('plate')) return { qty: 1, unit: 'Plate' };
    if (t.includes('scoop')) return { qty: 1, unit: 'Scoop' };
    if (t.includes('bar')) return { qty: 1, unit: 'Bar' };
    if (t.includes('tbsp')) return { qty: leadingNum(), unit: 'Tablespoon (tbsp)' };
    if (t.includes('tsp')) return { qty: leadingNum(), unit: 'Teaspoon (tsp)' };
    if (t.includes('slice')) return { qty: leadingNum(), unit: 'Slice' };
    if (t.includes('piece')) return { qty: leadingNum(), unit: 'Piece' };
    if (t.includes('egg')) return { qty: leadingNum(), unit: 'Piece' };
    if (t.includes('medium')) return { qty: 1, unit: 'Piece' };

    return null; // unrecognized pattern — left untouched, flagged in the summary
}

async function main() {
    const { data: rows, error } = await supabase
        .from('diet_foods')
        .select('id, name, serving_size')
        .is('serving_unit', null)
        .order('id');
    if (error) throw error;

    const updates = [];
    const unparsed = [];
    for (const row of rows) {
        const parsed = parseServingSize(row.serving_size);
        if (parsed) updates.push({ id: row.id, name: row.name, serving_size: row.serving_size, ...parsed });
        else unparsed.push(row);
    }

    console.log(`\n📄 ${rows.length} foods still missing serving_unit`);
    console.log(`   ${updates.length} parsed successfully, ${unparsed.length} unrecognized\n`);
    console.log('Sample of parsed rows:');
    updates.slice(0, 15).forEach((u) => console.log(`  ${u.id.padEnd(26)} "${u.serving_size}" -> ${u.qty} ${u.unit}`));
    if (unparsed.length) {
        console.log('\n⚠️  Could not parse (left untouched):');
        unparsed.forEach((r) => console.log(`  ${r.id} — "${r.serving_size}"`));
    }

    if (!APPLY) {
        console.log('\n🔎 Dry run only — no database changes made.');
        console.log('   Re-run with --apply to write these serving_qty/serving_unit values.\n');
        return;
    }

    console.log(`\n⚠️  --apply passed: updating ${updates.length} rows...`);
    for (const u of updates) {
        const { error: updErr } = await supabase
            .from('diet_foods')
            .update({ serving_qty: u.qty, serving_unit: u.unit })
            .eq('id', u.id);
        if (updErr) throw updErr;
    }
    console.log(`✅ Updated ${updates.length} foods with real serving units.\n`);
}

main().catch((err) => {
    console.error('\n❌ Backfill failed:', err.message || err);
    process.exit(1);
});
