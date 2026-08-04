// src/scripts/backfillFoodRegions.js
//
// Tags every diet_foods row with a regional cuisine (Gujarati, Punjabi,
// South Indian, etc.) by keyword-matching the dish name, so the admin can
// filter the food library to match a specific client's background instead
// of scrolling one flat 1000+ item list. Defaults to 'Generic / Pan-Indian'
// for dishes with no confident regional match — most of the CSV-imported
// composition-table dishes and continental items fall here, which is
// correct (they're not tied to one region), not a parsing failure.
//
// Usage:
//   node src/scripts/backfillFoodRegions.js            -> dry run
//   node src/scripts/backfillFoodRegions.js --apply     -> writes updates
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

// Checked in order, first match wins — ordered most-specific-signal first
// so e.g. "Hyderabadi chicken biryani" hits Hyderabadi before any looser
// South Indian keyword could grab it.
const REGION_RULES = [
    ['Hyderabadi / Deccani', ['hyderabadi', 'haleem', 'mirchi ka salan', 'qubani']],
    ['Kashmiri', ['kashmiri', 'rogan josh', 'roghan josh', 'yakhni', 'kehwa', 'gushtaba', 'wazwan', 'nadru']],
    ['Goan', ['goan', 'goa ', 'vindaloo', 'xacuti', 'sorpotel', 'balchao', 'balchão']],
    ['Sindhi', ['sindhi']],
    ['Bihari / East Indian', ['bihari', 'litti', 'sattu drink', 'sattu paratha', 'thekua']],
    ['North-Eastern', ['assamese', 'manipuri', 'naga ', 'bamboo shoot', 'thukpa', 'momos', 'momo']],
    ['Bengali', ['bengali', 'rasgulla', 'rasmalai', 'sandesh', 'mishti doi', 'macher jhol', 'shorshe', 'chum chum', 'chomchom', 'luchi', 'cholar dal', 'kosha mangsho', 'aloo posto', 'doi maach', 'chhena poda', 'chhena']],
    ['Gujarati', ['gujarati', 'dhokla', 'khakhra', 'thepla', 'fafda', 'khandvi', 'undhiyu', 'handvo', 'khaman', 'muthiya', 'khichu', 'dabeli', 'dhokli']],
    ['Maharashtrian', ['maharashtrian', 'misal', 'vada pav', 'puran poli', 'sabudana', 'bhakri', 'thalipeeth', 'kothimbir', 'modak', 'zunka', 'pithla', 'batata vada', 'sol kadhi', 'kolhapuri', 'amti', 'puranpoli']],
    ['Punjabi', ['punjabi', 'amritsari', 'makki ki roti', 'makki di roti', 'sarson ka saag', 'sarson da saag', 'dal makhani', 'chole bhature', 'kulcha', 'lassi']],
    ['South Indian', ['idli', 'dosa', 'dosai', 'sambar', 'rasam', 'uttapam', 'appam', 'pesarattu', 'upma', 'puttu', 'payasam', 'chettinad', 'kesari bath', 'bisi bele', 'curd rice', 'coconut chutney', 'idiyappam', 'thayir', 'pulihora', 'pulikachal', 'avial', 'thoran', 'vada', 'khichu']],
    ['Continental / Other', ['pizza', 'pasta', 'spaghetti', 'lasagne', 'sandwich', 'burger', 'cake', 'cookie', 'pastry', 'custard', 'souffle', 'mousse', 'noodles', 'chowmein', 'manchurian', 'schezwan', 'tart', 'flan', 'gateau', 'icing', 'quiche', 'casserole', 'eclair']],
];

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Word-boundary match, not a plain substring check — "lassi" as a bare
// .includes() match would false-positive inside "cLASSIc club sandwich".
function classifyRegion(name) {
    const n = name.toLowerCase();
    for (const [region, keywords] of REGION_RULES) {
        if (keywords.some((kw) => new RegExp(`\\b${escapeRegex(kw.trim())}\\b`, 'i').test(n))) return region;
    }
    return 'Generic / Pan-Indian';
}

// PostgREST caps a single response at 1000 rows by default — diet_foods
// has 1121. Same fix as contentService.js's listRows().
async function listAllFoods() {
    const rows = [];
    let from = 0;
    const PAGE = 1000;
    for (;;) {
        const { data, error } = await supabase.from('diet_foods').select('id, name, region').order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }
    return rows;
}

async function main() {
    const rows = await listAllFoods();

    // Only touch rows still on the column default — anything an admin has
    // already hand-set (or a previous run of this script already set)
    // should never be silently overwritten.
    const candidates = rows.filter((r) => !r.region || r.region === 'Generic / Pan-Indian');
    const updates = candidates.map((r) => ({ id: r.id, region: classifyRegion(r.name) })).filter((u) => u.region !== 'Generic / Pan-Indian');

    const byRegion = {};
    for (const u of updates) byRegion[u.region] = (byRegion[u.region] || 0) + 1;

    console.log(`\n📄 ${rows.length} total foods, ${candidates.length} still on default region`);
    console.log(`   ${updates.length} reclassified out of default, ${candidates.length - updates.length} remain Generic / Pan-Indian\n`);
    console.log('By region:');
    Object.entries(byRegion).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${r.padEnd(24)} ${n}`));
    console.log('\nSample:');
    updates.slice(0, 15).forEach((u) => console.log(`  ${u.id.padEnd(30)} -> ${u.region}`));

    if (!APPLY) {
        console.log('\n🔎 Dry run only — no database changes made.');
        console.log('   Re-run with --apply to write these region values.\n');
        return;
    }

    console.log(`\n⚠️  --apply passed: updating ${updates.length} rows...`);
    const BATCH = 200;
    for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH);
        await Promise.all(batch.map((u) => supabase.from('diet_foods').update({ region: u.region }).eq('id', u.id)));
        console.log(`✓ Updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
    }
    console.log('\n✅ Regions backfilled.\n');
}

main().catch((err) => {
    console.error('\n❌ Backfill failed:', err.message || err);
    process.exit(1);
});
