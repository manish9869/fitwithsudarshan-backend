/**
 * backend/scripts/createAdmin.js
 *
 * One-off CLI to create or reset an admin account. Never store plaintext
 * passwords — this hashes with bcrypt before writing to Supabase.
 *
 * Usage:
 *   node scripts/createAdmin.js <username> <password> [displayName]
 *
 * Example:
 *   node scripts/createAdmin.js sudarshan "SuperSecret!2025" "Sudarshan Chavan"
 *
 * Requires SUPABASE_URL and SUPABASE_SECRET_KEY in your backend .env
 * (same service-role key used by assessmentService.js).
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
const [, , username, password, displayName] = process.argv;

if (!username || !password) {
    console.error('Usage: node scripts/createAdmin.js <username> <password> [displayName]');
    process.exit(1);
}

if (password.length < 10) {
    console.error('❌ Password must be at least 10 characters.');
    process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

console.log('Creating/updating admin account:', url, key);

if (!url || !key) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(url, key, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
    },
    realtime: {
        transport: WebSocket,
    },
});

async function main() {
    const password_hash = await bcrypt.hash(password, 12);

    const { data, error } = await supabase
        .from('admins')
        .upsert(
            {
                username: username.toLowerCase().trim(),
                password_hash,
                display_name: displayName || username,
            },
            { onConflict: 'username' }
        )
        .select('id, username, display_name, created_at')
        .single();

    if (error) {
        console.error('❌ Failed to create admin:', error.message);
        process.exit(1);
    }

    console.log('✅ Admin account ready:');
    console.log(data);
    console.log('\nYou can now log in at /admin with this username and the password you set.');
}

main();