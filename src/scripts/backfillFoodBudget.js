// src/scripts/backfillFoodBudget.js
//
// Tags cheap-staple diet_foods rows as is_budget_friendly=true (dal, rice,
// roti, seasonal veg, eggs, milk/curd, cheap fruit) so a budget-conscious
// client (hostel/PG student) actually gets food options in the Diet Plan
// Builder's picker — the column existed from schema v8 but was never
// backfilled, so every row defaulted to false and the budget filter always
// returned zero foods. Never flips a row back to false, so it's safe to
// re-run later (e.g. after new foods are added) without touching any food
// an admin has already hand-tagged.
//
// Usage:
//   node src/scripts/backfillFoodBudget.js            -> dry run
//   node src/scripts/backfillFoodBudget.js --apply     -> writes updates
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

// Checked FIRST, on every candidate — a match here means "never budget",
// even if a staple keyword below would also match (e.g. "Paneer Bhurji"
// shouldn't tag budget just because "bhurji" isn't on the exclude list —
// paneer itself is the signal that overrides it).
const EXCLUDE_KEYWORDS = [
    'paneer', 'cheese', 'chicken', 'mutton', 'lamb', 'beef', 'pork', 'bacon', 'ham', 'sausage', 'salami',
    'fish', 'prawn', 'shrimp', 'salmon', 'tuna', 'crab', 'seafood',
    'almond', 'cashew', 'walnut', 'pistachio', 'pecan', 'macadamia', 'pine nut', 'dry fruit', 'dried fruit', 'raisin',
    'protein powder', 'whey', 'supplement', 'protein bar', 'energy bar', 'protein shake',
    'quinoa', 'tofu', 'avocado', 'olive', 'kiwi', 'dragon fruit', 'blueberry', 'strawberry', 'imported', 'exotic',
    'biryani', 'pizza', 'burger', 'pasta', 'noodles', 'cake', 'pastry', 'cookie', 'chocolate', 'ice cream',
    'butter', 'ghee', 'mayonnaise', 'salad dressing',
];

// Word-boundary staple keywords — deliberately the plain, everyday version
// of each item ("rice", "egg", "dal") rather than anything mixed/branded,
// matching what the schema v8 comment calls out: "dal, rice, seasonal veg, eggs".
const BUDGET_KEYWORDS = [
    // grains / cereals
    'rice', 'roti', 'chapati', 'phulka', 'poha', 'upma', 'khichdi', 'dalia', 'oats', 'oatmeal',
    'jowar', 'bajra', 'ragi', 'wheat', 'atta', 'rava', 'sooji', 'suji', 'idli', 'dosa', 'sattu', 'daliya',
    // legumes
    'dal', 'daal', 'lentil', 'moong', 'toor', 'arhar', 'urad', 'chana', 'chickpea', 'rajma', 'lobia',
    'masoor', 'sprouts', 'soya', 'soyabean', 'soybean', 'kidney bean', 'black bean',
    // vegetables
    'potato', 'aloo', 'onion', 'pyaz', 'tomato', 'tamatar', 'cabbage', 'gobi', 'cauliflower',
    'spinach', 'palak', 'bhindi', 'okra', 'lauki', 'bottle gourd', 'ridge gourd', 'tori', 'methi',
    'fenugreek', 'brinjal', 'baingan', 'eggplant', 'peas', 'matar', 'carrot', 'gajar', 'beans',
    'capsicum', 'pumpkin', 'kaddu', 'drumstick', 'cucumber', 'kheera', 'radish', 'mooli', 'beetroot', 'turnip',
    // dairy (plain, not paneer/cheese)
    'milk', 'curd', 'dahi', 'buttermilk', 'chaas',
    // protein
    'egg', 'omelette', 'omlet',
    // cheap fruit
    'banana', 'papaya', 'guava', 'watermelon', 'muskmelon', 'jackfruit',
];

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isBudgetFriendly(name) {
    const n = name.toLowerCase();
    if (EXCLUDE_KEYWORDS.some((kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(n))) return false;
    return BUDGET_KEYWORDS.some((kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(n));
}

// PostgREST caps a single response at 1000 rows by default.
async function listAllFoods() {
    const rows = [];
    let from = 0;
    const PAGE = 1000;
    for (;;) {
        const { data, error } = await supabase.from('diet_foods').select('id, name, category, is_budget_friendly').order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }
    return rows;
}

async function main() {
    const rows = await listAllFoods();

    // Only ever sets true — never touches a row that's already true (an
    // admin hand-tag or a previous run of this script) and never sets a row
    // back to false.
    const candidates = rows.filter((r) => !r.is_budget_friendly);
    const toTag = candidates.filter((r) => isBudgetFriendly(r.name));

    const byCategory = {};
    for (const r of toTag) byCategory[r.category] = (byCategory[r.category] || 0) + 1;

    console.log(`\n📄 ${rows.length} total foods, ${rows.length - candidates.length} already tagged budget-friendly`);
    console.log(`   ${toTag.length} of the remaining ${candidates.length} match a budget-staple keyword\n`);
    console.log('By category:');
    Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c.padEnd(20)} ${n}`));
    console.log('\nSample:');
    toTag.slice(0, 20).forEach((r) => console.log(`  ${r.id}`));

    if (!APPLY) {
        console.log('\n🔎 Dry run only — no database changes made.');
        console.log('   Re-run with --apply to write is_budget_friendly=true for these rows.\n');
        return;
    }

    console.log(`\n⚠️  --apply passed: updating ${toTag.length} rows...`);
    const BATCH = 200;
    for (let i = 0; i < toTag.length; i += BATCH) {
        const batch = toTag.slice(i, i + BATCH);
        await Promise.all(batch.map((r) => supabase.from('diet_foods').update({ is_budget_friendly: true }).eq('id', r.id)));
        console.log(`✓ Updated ${Math.min(i + BATCH, toTag.length)}/${toTag.length}`);
    }
    console.log('\n✅ Budget-friendly tags backfilled.\n');
}

main().catch((err) => {
    console.error('\n❌ Backfill failed:', err.message || err);
    process.exit(1);
});
