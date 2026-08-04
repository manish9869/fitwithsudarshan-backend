// src/scripts/importIndianFoodDb.js
//
// Bulk-adds ~1,014 Indian dishes from data/Indian_Food_Nutrition_Processed.csv
// (a real Indian Food Composition Table export, values per 100g) into
// diet_foods on top of the existing hand-seeded library from
// seedDietData.js — NOT a destructive replace. Upserts on `id` (same
// convention as seedDietData.js), so:
//   - the ~150 hand-seeded foods are kept as-is (their ids don't change)
//   - the built-in quick-start templates in dietTemplates.js, which
//     reference specific food ids, keep working
//   - a handful of CSV dishes happen to slugify to an id that already
//     exists (e.g. "Masala dosa" -> masala-dosa, already hand-seeded) —
//     those rows get their nutrition values refreshed from the more
//     detailed CSV source instead of being duplicated
//   - every food is standardized on a single unambiguous base unit (100g)
//     instead of guesswork like "1 cup"
//
// This does NOT touch diet_exercises or any saved diet_plans — plans store
// their own snapshot of a food's name/macros/serving at the time it was
// added, so adding to the library only affects what shows up in the food
// picker going forward.
//
// Usage:
//   node src/scripts/importIndianFoodDb.js            → dry run (no DB writes)
//   node src/scripts/importIndianFoodDb.js --apply     → upserts all parsed
//                                                         rows into diet_foods
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
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

// ── Minimal CSV parser (handles quoted fields with embedded commas) ────────
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], next = text[i + 1];
        if (inQuotes) {
            if (c === '"' && next === '"') { field += '"'; i++; }
            else if (c === '"') { inQuotes = false; }
            else { field += c; }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && next === '\n') i++;
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// ── Category inference — checked in priority order, first match wins.
// This is a browsing/filter label only (doesn't affect nutrition math), and
// stays editable per-food afterward via Admin → Diet Foods, so a handful of
// imperfect edge cases (a savory pie landing in the fallback bucket, say)
// are fine rather than worth hand-auditing 1,014 dish names for.
const CATEGORY_RULES = [
    ['Desserts', ['kheer', 'halwa', 'custard', 'souffle', 'mousse', 'pudding', 'burfi', 'ladoo', 'laddoo', 'jamun', 'rasgulla', 'rasmalai', 'rasbhari', 'ice cream', 'gateau', 'pastry', 'cake', 'cookie', 'biscuit', 'brittle', 'chikki', 'payasam', 'phirni', 'kulfi', 'barfi', 'sorbet', 'jalebi', 'malpua', 'trifle', 'triffle', 'eclair', 'milk cake', 'murki', 'dil bahar', 'pavlova', ' fool', 'tart', 'flan', 'icing', 'rabri', 'shrikhand', 'chhena poda', 'murabba candy', 'candy']],
    ['Beverages', ['tea', 'coffee', 'juice', 'shake', 'lassi', 'lemonade', 'lem-o-gin', 'cocoa', 'squash', 'sharbat', 'jal jeera', 'thandai', 'buttermilk', 'smoothie', 'drink', 'cooler', 'infused water', 'nog', 'kanji', 'canjee', 'gingo', 'mintade', 'punch', 'saffron milk']],
    ['Soups', ['soup', 'stock', 'consomme', 'rasam', 'stew']],
    ['Breakfast', ['idli', 'dosa', 'uttapam', 'appam', 'poha', 'upma', 'parantha', 'paratha', 'poori', 'bhatura', 'pancake', 'porridge', 'cornflakes', 'rice flakes', 'wheat flakes', 'murmura', 'puffed wheat', 'omelette', 'omlet', 'boiled egg', 'fried egg', 'poached egg', 'scrambled egg', 'baked egg', 'chilla', 'cheela', 'daliya', 'thepla']],
    ['Proteins', ['chicken', 'mutton', 'lamb', 'fish', 'prawn', 'shrimp', 'crab', 'keema', 'mince', 'bacon', 'ham', 'salami', 'beef', 'pork', 'meat', 'egg', 'kebab', 'seekh']],
    ['Dairy & Paneer', ['paneer', 'curd', 'dahi', 'cheese', 'khoa', 'yogurt', 'milk']],
    ['Grains & Roti', ['chapati', 'roti', 'naan', 'khakhra']],
    ['Rice & Dal', ['rice', 'pulao', 'biryani', 'biriyani', 'khichdi', 'khichri', 'dal', 'sambar', 'rajma', 'chole', 'chana', 'channa', 'kadhi', 'lobia', 'soyabean', 'kabuli']],
    ['Vegetables', ['vegetable', 'sabzi', 'sabji', 'subji', 'bhaji', 'bhujia', 'curry', 'gobhi', 'gobi', 'baingan', 'bhindi', 'aloo', 'potato', 'palak', 'spinach', 'cabbage', 'carrot', 'capsicum', 'brinjal', 'okra', 'bittergourd', 'karela', 'arbi', 'yam', 'mushroom', 'raita', 'kofta', 'salad', 'saag']],
    ['Fruits', ['mango', 'banana', 'apple', 'papaya', 'orange', 'pineapple', 'watermelon', 'grapes', 'guava', 'pomegranate', 'strawberry', 'fruit salad', 'jackfruit']],
    ['Snacks', ['sandwich', 'pakora', 'pakoda', 'samosa', 'cutlet', 'chaat', 'vada', 'bhel', 'dhokla', 'chips', 'namkeen', 'mathri', 'kachori', 'papdi', 'sev', 'murukku', 'bonda', 'tikki', 'tikka', 'spring roll', 'bread roll', 'pizza', 'burger', 'noodles', 'chowmein', 'pasta', 'spaghetti', 'macaroni', 'lasagne']],
    ['Condiments', ['chutney', 'pickle', 'achaar', 'sauce', 'dressing', 'ketchup', 'jam', 'jelly', 'marmalade', 'murabba', 'masala', 'gravy', 'icing']],
    ['Supplements', ['whey', 'supplement', 'infant food', 'shishu ahar']],
];

function classifyCategory(name) {
    const n = name.toLowerCase();
    for (const [category, keywords] of CATEGORY_RULES) {
        if (keywords.some((kw) => n.includes(kw))) return category;
    }
    return 'Snacks'; // catch-all fallback
}

const NON_VEG_KEYWORDS = ['chicken', 'mutton', 'lamb', 'fish', 'prawn', 'shrimp', 'crab', 'keema', 'mince', 'bacon', 'ham', 'salami', 'beef', 'pork', 'meat', 'machli', 'murgh'];
const EGG_KEYWORDS = ['egg', 'anda', 'ande', 'omelette', 'omlet'];

function classifyVeg(name) {
    const n = name.toLowerCase();
    if (n.includes('vegetarian') || n.includes('vegeterian')) return { is_veg: true, is_eggetarian: true };
    if (NON_VEG_KEYWORDS.some((kw) => n.includes(kw))) return { is_veg: false, is_eggetarian: false };
    if (EGG_KEYWORDS.some((kw) => n.includes(kw))) return { is_veg: false, is_eggetarian: true };
    return { is_veg: true, is_eggetarian: true };
}

function slugify(name, seen) {
    let base = name.toLowerCase()
        .replace(/[()]/g, ' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    if (!base) base = 'food';
    let id = base, n = 2;
    while (seen.has(id)) { id = `${base}-${n}`; n++; }
    seen.add(id);
    return id;
}

function round(v, decimals = 2) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

function loadRows() {
    const csvPath = path.resolve(__dirname, 'data/Indian_Food_Nutrition_Processed.csv');
    const text = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
    const table = parseCsv(text);
    const [header, ...body] = table;
    const col = (row, name) => row[header.indexOf(name)];

    const seenIds = new Set();
    return body.filter((row) => row.length && row[0]?.trim()).map((row, i) => {
        const name = col(row, 'Dish Name').trim();
        const { is_veg, is_eggetarian } = classifyVeg(name);
        return {
            id: slugify(name, seenIds),
            name,
            category: classifyCategory(name),
            calories: round(col(row, 'Calories (kcal)'), 1),
            protein: round(col(row, 'Protein (g)')),
            carbs: round(col(row, 'Carbohydrates (g)')),
            fats: round(col(row, 'Fats (g)')),
            sugar: round(col(row, 'Free Sugar (g)')),
            fiber: round(col(row, 'Fibre (g)')),
            sodium: round(col(row, 'Sodium (mg)')),
            calcium: round(col(row, 'Calcium (mg)')),
            iron: round(col(row, 'Iron (mg)')),
            vitamin_c: round(col(row, 'Vitamin C (mg)')),
            folate: round(col(row, 'Folate (µg)')) || round(col(row, 'Folate (�g)')),
            serving_qty: 100,
            serving_unit: 'Grams (g)',
            is_veg,
            is_eggetarian,
            active: true,
        };
    });
}

async function main() {
    const rows = loadRows();

    const byCategory = {};
    let vegCount = 0, eggCount = 0, nonVegCount = 0;
    for (const r of rows) {
        byCategory[r.category] = (byCategory[r.category] || 0) + 1;
        if (r.is_veg) vegCount++;
        else if (r.is_eggetarian) eggCount++;
        else nonVegCount++;
    }

    console.log(`\n📄 Parsed ${rows.length} foods from CSV\n`);
    console.log('By category:');
    Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c.padEnd(16)} ${n}`));
    console.log(`\nVeg: ${vegCount}  Eggetarian: ${eggCount}  Non-veg: ${nonVegCount}`);
    console.log('\nSample rows:');
    rows.slice(0, 5).forEach((r) => console.log(`  ${r.id.padEnd(30)} ${r.name.padEnd(35)} ${r.category.padEnd(14)} ${r.calories}kcal  veg=${r.is_veg} egg=${r.is_eggetarian}`));

    const { data: existingRows, count: existingCount, error: countErr } = await supabase.from('diet_foods').select('id, sort_order', { count: 'exact' });
    if (countErr) throw countErr;
    const existingSortOrder = new Map((existingRows || []).map((r) => [r.id, r.sort_order]));
    const maxSortOrder = (existingRows || []).reduce((m, r) => Math.max(m, r.sort_order || 0), -1);

    const newCount = rows.filter((r) => !existingSortOrder.has(r.id)).length;
    const refreshCount = rows.length - newCount;

    console.log(`\n📦 Existing diet_foods rows in DB: ${existingCount}`);
    console.log(`   Of the ${rows.length} parsed foods: ${newCount} are new ids, ${refreshCount} already exist (e.g. hand-seeded foods the CSV also happens to include) and will have their nutrition values refreshed from the CSV.`);
    console.log(`   This is an UPSERT, not a replace — nothing gets deleted, so existing quick-start templates that reference specific food ids keep working.`);

    // New rows are appended after whatever already exists (so the curated
    // hand-seeded list still shows first in the food picker); rows that
    // already exist keep their current sort_order exactly, so every row in
    // the batch has a real numeric value (a batch upsert needs consistent
    // columns across all rows, and leaving this undefined for "existing"
    // rows would null out their sort_order instead of preserving it).
    let nextSort = maxSortOrder + 1;
    for (const r of rows) {
        r.sort_order = existingSortOrder.has(r.id) ? existingSortOrder.get(r.id) : nextSort++;
    }

    if (!APPLY) {
        console.log('\n🔎 Dry run only — no database changes made.');
        console.log('   Re-run with --apply to upsert this set into diet_foods.\n');
        return;
    }

    console.log(`\n⚠️  --apply passed: upserting ${rows.length} rows into diet_foods...`);
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase.from('diet_foods').upsert(batch, { onConflict: 'id' });
        if (error) throw error;
        console.log(`✓ Upserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
    }

    console.log('\n✅ diet_foods updated from CSV.\n');
}

main().catch((err) => {
    console.error('\n❌ Import failed:', err.message || err);
    process.exit(1);
});
