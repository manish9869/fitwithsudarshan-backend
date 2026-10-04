/**
 * src/services/whatsappService.js
 *
 * WhatsApp marketing engine: contacts, audiences, broadcast + day-wise
 * sequence queue building, and sending.
 *
 * Two send channels share one queue (wa_messages):
 *  - "assisted" (free, default): the admin panel opens each queued message
 *    in WhatsApp pre-filled via wa.me and the coach taps Send. No API, no
 *    per-message cost, no number-ban risk.
 *  - "api" (optional): when WA_CLOUD_TOKEN + WA_PHONE_NUMBER_ID are set,
 *    dispatchPending() sends through Meta's WhatsApp Cloud API. Marketing
 *    messages to people who haven't messaged you in the last 24h MUST use a
 *    Meta-approved template (meta_template_name) — Meta rejects free text.
 */

import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';

const PAGE = 1000;
const GRAPH_VERSION = 'v21.0';

// ── Helpers ───────────────────────────────────────────────────────────────

export function todayIST(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

function daysBetween(fromYmd, toYmd) {
    return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400000);
}

function istDateOf(ts) {
    return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Which sequence day `date` (YYYY-MM-DD, IST) is for one group member.
 * Day 1 = the IST calendar day they joined the group ('joined' mode) or the
 * batch start date ('fixed' mode). 0 or negative = not started yet.
 */
export function sequenceDayNumber(seq, memberAddedAt, date) {
    const start = seq.start_mode === 'fixed' ? seq.start_date : (memberAddedAt ? istDateOf(memberAddedAt) : null);
    if (!start) return 0;
    return daysBetween(start, date) + 1;
}

/** Normalise to digits with country code (defaults to India). null if invalid. */
export function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = `91${d}`;
    if (d.length < 11 || d.length > 15) return null;
    return d;
}

function titleCase(s) {
    return String(s || '').trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** {{name}} → full name, {{first_name}} → first name. Falls back to "there". */
export function personalize(body, contact) {
    const full = titleCase(contact?.name) || 'there';
    const first = full.split(/\s+/)[0] || 'there';
    return String(body || '')
        .replace(/\{\{\s*first_name\s*\}\}/gi, first)
        .replace(/\{\{\s*name\s*\}\}/gi, full);
}

async function selectAll(build) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < PAGE) break;
    }
    return out;
}

export function apiConfigured() {
    return !!(process.env.WA_CLOUD_TOKEN && process.env.WA_PHONE_NUMBER_ID);
}

// ── Contacts ──────────────────────────────────────────────────────────────

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

/**
 * Pull every client / lead / assessment into wa_contacts. New numbers are
 * inserted; existing ones get their system tags refreshed while keeping any
 * custom tags, name edits and opt-outs the coach made.
 */
export async function syncContacts() {
    const supabase = getSupabaseAdmin();

    const [enrollments, leads, assessments] = await Promise.all([
        selectAll(() => supabase.from('enrollments')
            .select('customer_name, customer_phone, payment_status, plan_start_date, duration_months, created_at')
            .is('deleted_at', null)),
        selectAll(() => supabase.from('leads').select('name, phone').is('deleted_at', null)),
        selectAll(() => supabase.from('assessments').select('first_name, last_name, whatsapp').is('deleted_at', null)),
    ]);

    // phone → { name, tags:Set, source }
    const found = new Map();
    const add = (phoneRaw, name, tags, source) => {
        const phone = normalizePhone(phoneRaw);
        if (!phone) return;
        const cur = found.get(phone) || { name: '', tags: new Set(), source };
        if (!cur.name && name) cur.name = name;
        tags.forEach((t) => cur.tags.add(t));
        // A paying client outranks a lead as the "source" label.
        if (source === 'enrollment') cur.source = 'enrollment';
        found.set(phone, cur);
    };

    const now = new Date();
    for (const e of enrollments) {
        if (e.payment_status === 'failed' || e.payment_status === 'pending') {
            add(e.customer_phone, e.customer_name, ['lead'], 'lead');
            continue;
        }
        const start = e.plan_start_date || e.created_at;
        const months = parseInt(e.duration_months, 10) || 1;
        const active = start && addMonths(start, months) >= now;
        add(e.customer_phone, e.customer_name, ['client', active ? 'active' : 'expired'], 'enrollment');
    }
    for (const l of leads) add(l.phone, l.name, ['lead'], 'lead');
    for (const a of assessments) add(a.whatsapp, [a.first_name, a.last_name].filter(Boolean).join(' '), ['assessment'], 'assessment');

    const existing = await selectAll(() => supabase.from('wa_contacts').select('id, phone, name, tags'));
    const byPhone = new Map(existing.map((c) => [c.phone, c]));
    const SYSTEM = new Set(['client', 'active', 'expired', 'lead', 'assessment']);

    const inserts = [];
    const updates = [];
    for (const [phone, f] of found) {
        const cur = byPhone.get(phone);
        if (!cur) {
            inserts.push({ phone, name: titleCase(f.name), tags: [...f.tags], source: f.source });
            continue;
        }
        const custom = (cur.tags || []).filter((t) => !SYSTEM.has(t));
        const tags = [...new Set([...custom, ...f.tags])];
        // 'active' and 'expired' are mutually exclusive — active wins.
        const finalTags = tags.includes('active') ? tags.filter((t) => t !== 'expired') : tags;
        if (finalTags.sort().join() !== [...(cur.tags || [])].sort().join() || (!cur.name && f.name)) {
            updates.push({ id: cur.id, tags: finalTags, name: cur.name || titleCase(f.name) });
        }
    }

    for (let i = 0; i < inserts.length; i += 500) {
        const { error } = await supabase.from('wa_contacts').insert(inserts.slice(i, i + 500));
        if (error) throw error;
    }
    for (const u of updates) {
        const { error } = await supabase.from('wa_contacts')
            .update({ tags: u.tags, name: u.name, updated_at: new Date().toISOString() })
            .eq('id', u.id);
        if (error) throw error;
    }

    return { added: inserts.length, updated: updates.length, total: found.size };
}

// ── Audience ──────────────────────────────────────────────────────────────

/**
 * audience = { groupIds, tags, contactIds, excludeContactIds, all }
 * Returns opted-in contacts only, de-duplicated.
 */
export async function resolveAudience(audience = {}) {
    const supabase = getSupabaseAdmin();
    const ids = new Set();

    if (audience.all) {
        const rows = await selectAll(() => supabase.from('wa_contacts').select('id').eq('opted_out', false));
        rows.forEach((r) => ids.add(r.id));
    }
    if (audience.groupIds?.length) {
        const rows = await selectAll(() => supabase.from('wa_group_members').select('contact_id').in('group_id', audience.groupIds));
        rows.forEach((r) => ids.add(r.contact_id));
    }
    if (audience.tags?.length) {
        const rows = await selectAll(() => supabase.from('wa_contacts').select('id').overlaps('tags', audience.tags));
        rows.forEach((r) => ids.add(r.id));
    }
    (audience.contactIds || []).forEach((id) => ids.add(id));
    (audience.excludeContactIds || []).forEach((id) => ids.delete(id));

    if (!ids.size) return [];

    const list = [...ids];
    const contacts = [];
    for (let i = 0; i < list.length; i += 300) {
        const { data, error } = await supabase.from('wa_contacts')
            .select('id, name, phone, opted_out')
            .in('id', list.slice(i, i + 300));
        if (error) throw error;
        contacts.push(...(data || []));
    }
    return contacts.filter((c) => !c.opted_out);
}

// ── Queue building ────────────────────────────────────────────────────────

async function insertQueue(rows, conflict) {
    if (!rows.length) return 0;
    const supabase = getSupabaseAdmin();
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await supabase.from('wa_messages')
            .upsert(rows.slice(i, i + 500), { onConflict: conflict, ignoreDuplicates: true })
            .select('id');
        if (error) throw error;
        n += data?.length || 0;
    }
    return n;
}

function messageRow(contact, src, extra) {
    return {
        contact_id: contact.id,
        phone: contact.phone,
        name: contact.name,
        body: personalize(src.body, contact),
        image_url: src.image_url || null,
        cta_label: src.cta_label || null,
        cta_url: src.cta_url || null,
        meta_template_name: src.meta_template_name || null,
        meta_template_lang: src.meta_template_lang || 'en',
        ...extra,
    };
}

/** Queue one broadcast campaign for its whole audience. */
export async function queueCampaign(campaign) {
    const supabase = getSupabaseAdmin();
    const contacts = await resolveAudience(campaign.audience || {});
    const day = todayIST();
    const rows = contacts.map((c) => messageRow(c, campaign, { campaign_id: campaign.id, scheduled_date: day }));
    const queued = await insertQueue(rows, 'campaign_id,contact_id');
    await supabase.from('wa_campaigns')
        .update({ status: 'queued', queued_at: new Date().toISOString() })
        .eq('id', campaign.id);
    return { queued, audience: contacts.length };
}

/**
 * Daily job. Queues (1) scheduled broadcasts whose time has come and
 * (2) today's step of every active day-wise sequence. Idempotent.
 */
export async function buildDailyQueue() {
    const supabase = getSupabaseAdmin();
    const today = todayIST();
    const summary = { campaigns: 0, sequenceMessages: 0 };

    // 1. Due scheduled campaigns
    const { data: due, error: dueErr } = await supabase.from('wa_campaigns')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString());
    if (dueErr) throw dueErr;
    for (const c of due || []) {
        await queueCampaign(c);
        summary.campaigns += 1;
    }

    // 2. Day-wise sequences
    const { data: sequences, error: seqErr } = await supabase.from('wa_sequences')
        .select('*, wa_sequence_steps(*)')
        .eq('active', true);
    if (seqErr) throw seqErr;

    for (const seq of sequences || []) {
        if (!seq.group_id || !seq.wa_sequence_steps?.length) continue;
        const stepsByDay = new Map(seq.wa_sequence_steps.map((s) => [s.day_number, s]));
        const members = await selectAll(() => supabase.from('wa_group_members')
            .select('added_at, wa_contacts(id, name, phone, opted_out)')
            .eq('group_id', seq.group_id));
        const excluded = new Set(seq.excluded_contact_ids || []);

        const rows = [];
        for (const m of members) {
            const c = m.wa_contacts;
            if (!c || c.opted_out || excluded.has(c.id)) continue;
            const step = stepsByDay.get(sequenceDayNumber(seq, m.added_at, today));
            if (!step) continue;
            rows.push(messageRow(c, step, { sequence_id: seq.id, step_id: step.id, scheduled_date: today }));
        }
        summary.sequenceMessages += await insertQueue(rows, 'step_id,contact_id');
    }

    return summary;
}

/** Preview: what each sequence will send in the next N days (for the admin UI). */
export async function previewSequence(sequenceId, days = 7) {
    const supabase = getSupabaseAdmin();
    const { data: seq, error } = await supabase.from('wa_sequences')
        .select('*, wa_sequence_steps(*)').eq('id', sequenceId).single();
    if (error) throw error;
    if (!seq.group_id) return [];
    const members = await selectAll(() => supabase.from('wa_group_members')
        .select('added_at, wa_contacts(id, opted_out)').eq('group_id', seq.group_id));
    const excluded = new Set(seq.excluded_contact_ids || []);
    const stepsByDay = new Map((seq.wa_sequence_steps || []).map((s) => [s.day_number, s]));

    const out = [];
    for (let i = 0; i < days; i += 1) {
        const date = todayIST(i);
        let count = 0;
        const stepCounts = {};
        for (const m of members) {
            const c = m.wa_contacts;
            if (!c || c.opted_out || excluded.has(c.id)) continue;
            const dayNumber = sequenceDayNumber(seq, m.added_at, date);
            if (stepsByDay.has(dayNumber)) {
                count += 1;
                stepCounts[dayNumber] = (stepCounts[dayNumber] || 0) + 1;
            }
        }
        out.push({ date, count, steps: stepCounts });
    }
    return out;
}

// ── Sending (Meta Cloud API) ──────────────────────────────────────────────

async function sendViaCloudApi(msg) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`;
    let payload;
    if (msg.meta_template_name) {
        // Approved template with the recipient's first name as {{1}} and an
        // optional image header — matches the poster-style promos.
        const first = (titleCase(msg.name).split(/\s+/)[0]) || 'there';
        const components = [{ type: 'body', parameters: [{ type: 'text', text: first }] }];
        if (msg.image_url) components.unshift({ type: 'header', parameters: [{ type: 'image', image: { link: msg.image_url } }] });
        payload = {
            messaging_product: 'whatsapp',
            to: msg.phone,
            type: 'template',
            template: { name: msg.meta_template_name, language: { code: msg.meta_template_lang || 'en' }, components },
        };
    } else {
        const text = msg.cta_url ? `${msg.body}\n\n${msg.cta_label || 'Link'}: ${msg.cta_url}` : msg.body;
        payload = msg.image_url
            ? { messaging_product: 'whatsapp', to: msg.phone, type: 'image', image: { link: msg.image_url, caption: text.slice(0, 1024) } }
            : { messaging_product: 'whatsapp', to: msg.phone, type: 'text', text: { body: text, preview_url: true } };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WA_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.error?.message || `WhatsApp API error ${res.status}`);
    }
    return json?.messages?.[0]?.id || null;
}

/**
 * Send up to `limit` of today's (or overdue) pending messages through the
 * Cloud API. Kept small per call so it fits inside a 30s serverless
 * function — the admin "Send all" button calls it repeatedly until done.
 */
export async function dispatchPending({ limit = 25, ids } = {}) {
    if (!apiConfigured()) {
        const err = new Error('Automatic sending is not connected. Add WA_CLOUD_TOKEN and WA_PHONE_NUMBER_ID to the backend environment, or send from the queue by hand.');
        err.status = 400;
        throw err;
    }
    const supabase = getSupabaseAdmin();
    // `ids` restricts sending to specific messages (direct messages), so
    // "send these 5" never also fires unrelated pending queue items.
    let q = supabase.from('wa_messages')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_date', todayIST());
    if (ids?.length) q = q.in('id', ids);
    const { data: batch, error } = await q
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) throw error;

    let sent = 0;
    let failed = 0;
    for (const msg of batch || []) {
        try {
            const providerId = await sendViaCloudApi(msg);
            await supabase.from('wa_messages').update({
                status: 'sent', channel: 'api', sent_at: new Date().toISOString(), provider_message_id: providerId, error: null,
            }).eq('id', msg.id);
            sent += 1;
        } catch (e) {
            logger.warn(`[whatsapp] send to ${msg.phone} failed: ${e.message}`);
            await supabase.from('wa_messages').update({ status: 'failed', channel: 'api', error: e.message.slice(0, 500) }).eq('id', msg.id);
            failed += 1;
        }
    }

    let rq = supabase.from('wa_messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('scheduled_date', todayIST());
    if (ids?.length) rq = rq.in('id', ids);
    const { count } = await rq;

    return { sent, failed, remaining: count || 0 };
}
