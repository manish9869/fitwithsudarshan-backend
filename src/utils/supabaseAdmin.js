import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

let _client = null;

export function getSupabaseAdmin() {
    if (_client) return _client;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
        throw new Error('[supabaseAdmin] Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars.');
    }

    _client = createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
        realtime: {
            transport: WebSocket,
        },
    });

    return _client;
}