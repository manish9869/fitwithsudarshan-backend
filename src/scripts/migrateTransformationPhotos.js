// src/scripts/migrateTransformationPhotos.js
//
// One-time migration: uploads the before/after photos that used to live in
// the frontend's public/Testimonials folder to Supabase Storage, then
// updates each transformations row to point at the new CDN URL instead of
// a local path. Run once, then it's safe to delete the local image files.
//
// Run from backend root:
//   node src/scripts/migrateTransformationPhotos.js
import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PHOTOS_DIR = path.resolve(__dirname, '../../../FitWithSudarshan/public/Testimonials');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in backend .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    realtime: { transport: WebSocket },
});

const BUCKET = 'media';

// local filename prefix → transformations.name value
const NAME_MAP = {
    prajvati: 'Prajvati',
    aayush: 'Aayush',
    joshua: 'Joshua',
    raj: 'Raj',
    jinal: 'Jinal',
    juzer: 'Juzer',
    lalitesh: 'Lalitesh',
    sudarshan: 'Sudarshan Chavan',
};

const MIME_BY_EXT = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

async function ensureBucket() {
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (!data) {
        const { error } = await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '5MB' });
        if (error && !/already exists/i.test(error.message || '')) throw error;
        console.log(`✓ created bucket: ${BUCKET}`);
    }
}

async function uploadOne(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const buffer = fs.readFileSync(path.join(LOCAL_PHOTOS_DIR, filename));
    const storagePath = `transformations/${filename}`;

    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
        contentType: MIME_BY_EXT[ext] || 'image/jpeg',
        cacheControl: '31536000',
        upsert: true, // safe to re-run
    });
    if (error) throw error;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return pub.publicUrl;
}

async function migrate() {
    console.log('');
    console.log('🌱 Migrating transformation photos to Supabase Storage...');
    console.log('   Reading from:', LOCAL_PHOTOS_DIR);
    console.log('');

    await ensureBucket();

    const files = fs.readdirSync(LOCAL_PHOTOS_DIR);
    // Group before/after files by name prefix
    const byPerson = {};
    for (const file of files) {
        const match = file.match(/^([a-z]+)-(before|after)\.\w+$/i);
        if (!match) continue;
        const [, prefix, stage] = match;
        const key = prefix.toLowerCase();
        byPerson[key] ??= {};
        byPerson[key][stage] = file;
    }

    for (const [prefix, { before, after }] of Object.entries(byPerson)) {
        const rowName = NAME_MAP[prefix];
        if (!rowName) {
            console.warn(`⚠ skipping "${prefix}" — no matching transformations.name mapping`);
            continue;
        }

        const update = {};
        if (before) update.photo_before = await uploadOne(before);
        if (after) update.photo_after = await uploadOne(after);

        const { data, error } = await supabase
            .from('transformations')
            .update(update)
            .eq('name', rowName)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            console.warn(`⚠ uploaded photos for "${rowName}" but no transformations row matched that name — check spelling.`);
        } else {
            console.log(`✓ ${rowName}: ${before ? 'before ✓' : ''} ${after ? 'after ✓' : ''}`.trim());
        }
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Migration complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
}

migrate().catch((err) => {
    console.error('');
    console.error('❌ Migration failed');
    console.error(err);
    process.exit(1);
});
