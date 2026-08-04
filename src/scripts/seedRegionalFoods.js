// src/scripts/seedRegionalFoods.js
//
// The CSV-derived library is broad but thin on specific regional dishes —
// only 11 Gujarati items, 6 Punjabi, 6 Maharashtrian surfaced out of 1121
// foods (see backfillFoodRegions.js's dry-run output). This adds real
// staple dishes per region so an admin building a plan for e.g. a Gujarati
// client actually has enough to work with. Nutrition values are estimates
// (typical home-cooked portion), same convention as seedDietData.js —
// editable per-food afterward via Admin → Diet Foods.
//
// Usage:
//   node src/scripts/seedRegionalFoods.js            -> dry run
//   node src/scripts/seedRegionalFoods.js --apply     -> upserts (safe re-run)
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

// [id, name, category, region, calories, protein, carbs, fats, fiber, serving_qty, serving_unit, is_veg, is_eggetarian]
const FOODS = [
    // ── Gujarati ─────────────────────────────────────────────────────────
    ['guj-khichu', 'Khichu', 'Snacks', 'Gujarati', 120, 2, 26, 1, 1, 1, 'Bowl - Small', true, true],
    ['guj-dabeli', 'Dabeli', 'Snacks', 'Gujarati', 250, 5, 42, 8, 3, 1, 'Piece', true, true],
    ['guj-methi-thepla', 'Methi Thepla', 'Breakfast', 'Gujarati', 130, 3, 20, 4, 2, 1, 'Piece', true, true],
    ['guj-handvo', 'Handvo', 'Breakfast', 'Gujarati', 220, 7, 30, 8, 3, 1, 'Piece', true, true],
    ['guj-undhiyu', 'Undhiyu', 'Vegetables', 'Gujarati', 210, 6, 24, 10, 6, 1, 'Bowl - Medium', true, true],
    ['guj-sev-tamatar', 'Sev Tamatar Nu Shaak', 'Vegetables', 'Gujarati', 180, 5, 16, 11, 3, 1, 'Bowl - Medium', true, true],
    ['guj-dal-dhokli', 'Gujarati Dal Dhokli', 'Rice & Dal', 'Gujarati', 260, 10, 42, 6, 5, 1, 'Bowl - Medium', true, true],
    ['guj-khaman-fresh', 'Fresh Khaman Dhokla', 'Snacks', 'Gujarati', 160, 7, 22, 5, 2, 4, 'Piece', true, true],
    ['guj-fafda', 'Fafda', 'Snacks', 'Gujarati', 280, 6, 28, 16, 2, 100, 'Grams (g)', true, true],
    ['guj-khandvi', 'Khandvi', 'Snacks', 'Gujarati', 150, 6, 16, 7, 1, 6, 'Piece', true, true],
    ['guj-muthiya', 'Steamed Muthiya', 'Snacks', 'Gujarati', 170, 5, 24, 6, 4, 4, 'Piece', true, true],
    ['guj-thepla-plain', 'Plain Gujarati Thepla', 'Breakfast', 'Gujarati', 120, 3, 18, 4, 2, 1, 'Piece', true, true],
    ['guj-gujarati-kadhi', 'Gujarati Kadhi (Sweet)', 'Dairy & Paneer', 'Gujarati', 110, 3, 14, 4, 0.5, 1, 'Bowl - Medium', true, true],
    ['guj-basundi', 'Basundi', 'Desserts', 'Gujarati', 220, 6, 24, 11, 0, 1, 'Bowl - Small', true, true],
    ['guj-patra', 'Patra (Colocasia Rolls)', 'Snacks', 'Gujarati', 160, 4, 22, 6, 3, 4, 'Piece', true, true],

    // ── Punjabi ──────────────────────────────────────────────────────────
    ['pun-sarson-makki', 'Sarson Ka Saag with Makki Roti', 'Vegetables', 'Punjabi', 320, 9, 38, 14, 7, 1, 'Plate', true, true],
    ['pun-amritsari-kulcha', 'Amritsari Kulcha', 'Grains & Roti', 'Punjabi', 280, 7, 40, 10, 2, 1, 'Piece', true, true],
    ['pun-chole-bhature', 'Chole Bhature', 'Rice & Dal', 'Punjabi', 450, 12, 55, 20, 6, 1, 'Plate', true, true],
    ['pun-amritsari-fish', 'Amritsari Fish Fry', 'Proteins', 'Punjabi', 260, 24, 8, 15, 0.5, 100, 'Grams (g)', false, false],
    ['pun-sarson-saag-only', 'Sarson Ka Saag', 'Vegetables', 'Punjabi', 150, 5, 12, 9, 5, 1, 'Bowl - Medium', true, true],
    ['pun-punjabi-kadhi-pakora', 'Punjabi Kadhi Pakora', 'Dairy & Paneer', 'Punjabi', 220, 8, 20, 12, 2, 1, 'Bowl - Medium', true, true],
    ['pun-makki-roti', 'Makki Roti (Punjabi Style)', 'Grains & Roti', 'Punjabi', 130, 3, 22, 3, 3, 1, 'Piece', true, true],
    ['pun-punjabi-lassi', 'Punjabi Sweet Lassi (Thick)', 'Beverages', 'Punjabi', 220, 7, 30, 8, 0, 1, 'Glass', true, true],
    ['pun-sarson-tadka-dal', 'Punjabi Tadka Dal', 'Rice & Dal', 'Punjabi', 190, 9, 26, 6, 5, 1, 'Bowl - Medium', true, true],
    ['pun-amritsari-chole', 'Amritsari Chole', 'Rice & Dal', 'Punjabi', 240, 11, 32, 8, 8, 1, 'Bowl - Medium', true, true],

    // ── Maharashtrian ────────────────────────────────────────────────────
    ['mah-misal-pav', 'Misal Pav', 'Snacks', 'Maharashtrian', 350, 12, 45, 14, 8, 1, 'Plate', true, true],
    ['mah-vada-pav', 'Vada Pav', 'Snacks', 'Maharashtrian', 290, 6, 40, 12, 3, 1, 'Piece', true, true],
    ['mah-puran-poli', 'Puran Poli', 'Grains & Roti', 'Maharashtrian', 230, 5, 40, 6, 3, 1, 'Piece', true, true],
    ['mah-thalipeeth', 'Thalipeeth', 'Breakfast', 'Maharashtrian', 210, 6, 30, 8, 4, 1, 'Piece', true, true],
    ['mah-zunka-bhakri', 'Zunka Bhakri', 'Vegetables', 'Maharashtrian', 260, 8, 34, 10, 5, 1, 'Plate', true, true],
    ['mah-kothimbir-vadi', 'Kothimbir Vadi', 'Snacks', 'Maharashtrian', 180, 6, 20, 9, 3, 5, 'Piece', true, true],
    ['mah-sol-kadhi', 'Sol Kadhi', 'Beverages', 'Maharashtrian', 70, 2, 6, 4, 0, 1, 'Glass', true, true],
    ['mah-modak-steamed', 'Steamed Modak', 'Desserts', 'Maharashtrian', 130, 2, 24, 3, 1, 2, 'Piece', true, true],
    ['mah-batata-vada', 'Batata Vada', 'Snacks', 'Maharashtrian', 210, 4, 26, 10, 2, 2, 'Piece', true, true],
    ['mah-amti', 'Maharashtrian Amti', 'Rice & Dal', 'Maharashtrian', 170, 8, 24, 5, 6, 1, 'Bowl - Medium', true, true],
    ['mah-pithla-bhakri', 'Pithla Bhakri', 'Vegetables', 'Maharashtrian', 240, 9, 32, 9, 4, 1, 'Plate', true, true],
    ['mah-kolhapuri-mutton', 'Kolhapuri Mutton', 'Proteins', 'Maharashtrian', 310, 22, 8, 21, 1, 1, 'Bowl - Medium', false, false],

    // ── South Indian ─────────────────────────────────────────────────────
    ['si-medu-vada', 'Medu Vada', 'Snacks', 'South Indian', 180, 5, 20, 9, 2, 2, 'Piece', true, true],
    ['si-pesarattu', 'Pesarattu', 'Breakfast', 'South Indian', 170, 8, 24, 4, 4, 1, 'Piece', true, true],
    ['si-bisi-bele-bath', 'Bisi Bele Bath', 'Rice & Dal', 'South Indian', 260, 8, 42, 7, 6, 1, 'Bowl - Medium', true, true],
    ['si-pongal', 'Ven Pongal', 'Breakfast', 'South Indian', 240, 7, 38, 8, 3, 1, 'Bowl - Medium', true, true],
    ['si-appam-stew', 'Appam with Vegetable Stew', 'Breakfast', 'South Indian', 260, 6, 40, 8, 3, 1, 'Plate', true, true],
    ['si-chettinad-chicken', 'Chettinad Chicken', 'Proteins', 'South Indian', 280, 26, 8, 17, 1, 1, 'Bowl - Medium', false, false],
    ['si-thayir-sadam', 'Thayir Sadam (Curd Rice)', 'Rice & Dal', 'South Indian', 200, 6, 34, 4, 1, 1, 'Bowl - Medium', true, true],
    ['si-avial', 'Avial', 'Vegetables', 'South Indian', 150, 4, 14, 9, 5, 1, 'Bowl - Medium', true, true],
    ['si-rava-dosa', 'Rava Dosa', 'Breakfast', 'South Indian', 190, 4, 28, 7, 1, 1, 'Piece', true, true],
    ['si-filter-coffee', 'South Indian Filter Coffee', 'Beverages', 'South Indian', 60, 2, 8, 2, 0, 1, 'Cup - Small', true, true],

    // ── Bengali ──────────────────────────────────────────────────────────
    ['ben-macher-jhol', "Macher Jhol (Fish Curry)", 'Proteins', 'Bengali', 220, 22, 6, 12, 1, 1, 'Bowl - Medium', false, false],
    ['ben-shukto', 'Shukto', 'Vegetables', 'Bengali', 130, 4, 14, 6, 5, 1, 'Bowl - Medium', true, true],
    ['ben-cholar-dal', 'Cholar Dal', 'Rice & Dal', 'Bengali', 200, 9, 28, 6, 6, 1, 'Bowl - Medium', true, true],
    ['ben-luchi', 'Luchi', 'Grains & Roti', 'Bengali', 100, 2, 14, 4, 1, 1, 'Piece', true, true],
    ['ben-aloo-posto', 'Aloo Posto', 'Vegetables', 'Bengali', 190, 4, 22, 10, 3, 1, 'Bowl - Medium', true, true],
    ['ben-kosha-mangsho', 'Kosha Mangsho', 'Proteins', 'Bengali', 330, 24, 6, 23, 1, 1, 'Bowl - Medium', false, false],
    ['ben-mishti-doi', 'Mishti Doi', 'Desserts', 'Bengali', 180, 5, 28, 5, 0, 1, 'Bowl - Small', true, true],
    ['ben-luchi-alur-dom', "Luchi Alur Dom", 'Breakfast', 'Bengali', 320, 6, 44, 13, 4, 1, 'Plate', true, true],

    // ── Rajasthani ───────────────────────────────────────────────────────
    ['raj-dal-baati-churma', 'Dal Baati Churma', 'Rice & Dal', 'Rajasthani', 420, 11, 55, 17, 6, 1, 'Plate', true, true],
    ['raj-gatte-ki-sabzi', 'Gatte Ki Sabzi', 'Vegetables', 'Rajasthani', 220, 8, 22, 11, 4, 1, 'Bowl - Medium', true, true],
    ['raj-ker-sangri', 'Ker Sangri', 'Vegetables', 'Rajasthani', 140, 4, 14, 7, 5, 1, 'Bowl - Medium', true, true],
    ['raj-laal-maas', 'Laal Maas', 'Proteins', 'Rajasthani', 320, 23, 7, 22, 1, 1, 'Bowl - Medium', false, false],
    ['raj-bajre-ki-roti', 'Bajre Ki Roti (Rajasthani)', 'Grains & Roti', 'Rajasthani', 110, 3, 20, 2, 3, 1, 'Piece', true, true],
    ['raj-ghevar', 'Ghevar', 'Desserts', 'Rajasthani', 260, 4, 34, 12, 1, 1, 'Piece', true, true],

    // ── Hyderabadi ───────────────────────────────────────────────────────
    ['hyd-biryani-classic', 'Hyderabadi Chicken Biryani', 'Rice & Dal', 'Hyderabadi / Deccani', 400, 22, 46, 14, 2, 1, 'Cup - Large', false, false],
    ['hyd-haleem', 'Hyderabadi Haleem', 'Proteins', 'Hyderabadi / Deccani', 300, 18, 26, 14, 3, 1, 'Bowl - Medium', false, false],
    ['hyd-mirchi-salan', 'Mirchi Ka Salan', 'Vegetables', 'Hyderabadi / Deccani', 190, 4, 12, 15, 3, 1, 'Bowl - Small', true, true],
    ['hyd-qubani-meetha', 'Qubani Ka Meetha', 'Desserts', 'Hyderabadi / Deccani', 210, 2, 40, 5, 3, 1, 'Bowl - Small', true, true],

    // ── Goan ─────────────────────────────────────────────────────────────
    ['goa-fish-curry-rice', 'Goan Fish Curry with Rice', 'Proteins', 'Goan', 380, 24, 44, 12, 2, 1, 'Plate', false, false],
    ['goa-vindaloo', 'Pork Vindaloo', 'Proteins', 'Goan', 340, 22, 10, 23, 1, 1, 'Bowl - Medium', false, false],
    ['goa-prawn-balchao', 'Prawn Balchão', 'Proteins', 'Goan', 260, 20, 8, 16, 1, 1, 'Bowl - Small', false, false],
    ['goa-bebinca', 'Bebinca', 'Desserts', 'Goan', 320, 4, 42, 16, 0.5, 1, 'Slice', true, true],

    // ── Bihari / East Indian ─────────────────────────────────────────────
    ['bih-litti-chokha', 'Litti Chokha', 'Grains & Roti', 'Bihari / East Indian', 350, 9, 48, 14, 6, 2, 'Piece', true, true],
    ['bih-thekua', 'Thekua', 'Snacks', 'Bihari / East Indian', 180, 2, 26, 8, 1, 2, 'Piece', true, true],
    ['bih-sattu-sharbat', 'Sattu Sharbat', 'Beverages', 'Bihari / East Indian', 90, 4, 16, 1, 2, 1, 'Glass', true, true],

    // ── North-Eastern ────────────────────────────────────────────────────
    ['ne-momos-veg', 'Steamed Vegetable Momos', 'Snacks', 'North-Eastern', 220, 6, 36, 5, 3, 6, 'Piece', true, true],
    ['ne-momos-chicken', 'Steamed Chicken Momos', 'Snacks', 'North-Eastern', 260, 14, 34, 7, 2, 6, 'Piece', false, false],
    ['ne-thukpa', 'Thukpa', 'Soups', 'North-Eastern', 240, 10, 32, 7, 3, 1, 'Bowl - Medium', true, true],
    ['ne-bamboo-shoot-pork', 'Bamboo Shoot Pork Curry', 'Proteins', 'North-Eastern', 280, 20, 8, 19, 2, 1, 'Bowl - Medium', false, false],

    // ── Sindhi ───────────────────────────────────────────────────────────
    ['sin-sai-bhaji', 'Sindhi Sai Bhaji', 'Vegetables', 'Sindhi', 160, 6, 18, 7, 5, 1, 'Bowl - Medium', true, true],
    ['sin-koki', 'Sindhi Koki', 'Grains & Roti', 'Sindhi', 200, 4, 26, 9, 2, 1, 'Piece', true, true],
    ['sin-kadhi', 'Sindhi Kadhi', 'Vegetables', 'Sindhi', 170, 5, 20, 8, 3, 1, 'Bowl - Medium', true, true],
];

async function main() {
    const foodRows = FOODS.map(([id, name, category, region, calories, protein, carbs, fats, fiber, serving_qty, serving_unit, is_veg, is_eggetarian], i) => ({
        id, name, category, region, calories, protein, carbs, fats, fiber,
        serving_qty, serving_unit, is_veg, is_eggetarian, sort_order: 100000 + i, active: true,
    }));

    const byRegion = {};
    for (const f of foodRows) byRegion[f.region] = (byRegion[f.region] || 0) + 1;

    console.log(`\n📄 ${foodRows.length} curated regional foods to add\n`);
    console.log('By region:');
    Object.entries(byRegion).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${r.padEnd(24)} ${n}`));

    if (!APPLY) {
        console.log('\n🔎 Dry run only — no database changes made.');
        console.log('   Re-run with --apply to upsert these rows (safe to re-run, upserts on id).\n');
        return;
    }

    console.log(`\n⚠️  --apply passed: upserting ${foodRows.length} rows...`);
    const { error } = await supabase.from('diet_foods').upsert(foodRows, { onConflict: 'id' });
    if (error) throw error;
    console.log('\n✅ Regional foods added.\n');
}

main().catch((err) => {
    console.error('\n❌ Seed failed:', err.message || err);
    process.exit(1);
});
