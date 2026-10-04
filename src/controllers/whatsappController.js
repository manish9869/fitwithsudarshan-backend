/**
 * src/controllers/whatsappController.js
 * Admin endpoints for the WhatsApp marketing module (mounted at
 * /api/admin/whatsapp) plus the daily cron endpoint.
 */

import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';
import {
    normalizePhone, syncContacts, resolveAudience, queueCampaign, buildDailyQueue,
    previewSequence, dispatchPending, apiConfigured, todayIST, personalize,
} from '../services/whatsappService.js';

const db = () => getSupabaseAdmin();

// Wraps a handler: uniform JSON errors + logging.
const handle = (fn) => async (req, res) => {
    try {
        const out = await fn(req, res);
        if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
        logger.error(`[whatsapp] ${req.method} ${req.originalUrl} failed: ${err.message}`);
        res.status(err.status || 500).json({ error: err.message || 'Request failed.' });
    }
};

function bad(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'))
    .filter(Boolean))].slice(0, 20);
const uuidList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)) : []);

function cleanAudience(a = {}) {
    return {
        all: !!a.all,
        groupIds: uuidList(a.groupIds),
        tags: cleanTags(a.tags),
        contactIds: uuidList(a.contactIds),
        excludeContactIds: uuidList(a.excludeContactIds),
    };
}

function cleanMessage(b) {
    const body = str(b.body, 4000);
    if (!body) throw bad('Message text is required.');
    const ctaUrl = str(b.cta_url, 1000);
    if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) throw bad('Button link must start with https://');
    return {
        body,
        image_url: str(b.image_url, 1000) || null,
        cta_label: str(b.cta_label, 40) || null,
        cta_url: ctaUrl || null,
        meta_template_name: str(b.meta_template_name, 120) || null,
        meta_template_lang: str(b.meta_template_lang, 10) || 'en',
    };
}

// ── Overview ──────────────────────────────────────────────────────────────

export const getStatus = handle(async () => {
    const today = todayIST();
    const count = async (q) => (await q).count || 0;
    const [contacts, optedOut, pendingToday, sentToday, overdue] = await Promise.all([
        count(db().from('wa_contacts').select('id', { count: 'exact', head: true })),
        count(db().from('wa_contacts').select('id', { count: 'exact', head: true }).eq('opted_out', true)),
        count(db().from('wa_messages').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('scheduled_date', today)),
        count(db().from('wa_messages').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', `${today}T00:00:00+05:30`)),
        count(db().from('wa_messages').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('scheduled_date', today)),
    ]);
    return { apiConfigured: apiConfigured(), today, contacts, optedOut, pendingToday, sentToday, overdue };
});

// ── Contacts ──────────────────────────────────────────────────────────────

export const listContacts = handle(async (req) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.min(100, Math.max(10, parseInt(req.query.size, 10) || 50));
    const search = str(req.query.search, 80).replace(/[%,()]/g, '');
    const tag = str(req.query.tag, 40);
    const groupId = str(req.query.groupId, 40);
    const optedOut = req.query.optedOut;

    let q = db().from('wa_contacts').select('*', { count: 'exact' });
    if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search.replace(/\D/g, '') || search}%`);
    if (tag) q = q.contains('tags', [tag]);
    if (optedOut === 'true') q = q.eq('opted_out', true);
    if (optedOut === 'false') q = q.eq('opted_out', false);
    if (groupId) {
        const { data: members, error } = await db().from('wa_group_members').select('contact_id').eq('group_id', groupId).limit(10000);
        if (error) throw error;
        const ids = (members || []).map((m) => m.contact_id);
        if (!ids.length) return { rows: [], total: 0, page, size };
        q = q.in('id', ids.slice(0, 2000));
    }
    const { data, count, error } = await q
        .order('created_at', { ascending: false })
        .range((page - 1) * size, page * size - 1);
    if (error) throw error;

    // Attach group memberships for the visible page.
    const ids = (data || []).map((c) => c.id);
    let memberships = [];
    if (ids.length) {
        const { data: m } = await db().from('wa_group_members').select('contact_id, group_id').in('contact_id', ids);
        memberships = m || [];
    }
    const rows = (data || []).map((c) => ({
        ...c,
        groupIds: memberships.filter((m) => m.contact_id === c.id).map((m) => m.group_id),
    }));
    return { rows, total: count || 0, page, size };
});

export const listTags = handle(async () => {
    const { data, error } = await db().from('wa_contacts').select('tags').limit(10000);
    if (error) throw error;
    const counts = {};
    (data || []).forEach((r) => (r.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    return { tags: Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) };
});

export const createContact = handle(async (req) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw bad('Enter a valid phone number (10 digits, or with country code).');
    const { data, error } = await db().from('wa_contacts')
        .insert({ name: str(req.body.name, 120), phone, tags: cleanTags(req.body.tags), source: 'manual', notes: str(req.body.notes, 1000) || null })
        .select().single();
    if (error) {
        if (error.code === '23505') throw bad('A contact with this phone number already exists.');
        throw error;
    }
    const groupIds = uuidList(req.body.groupIds);
    if (groupIds.length) {
        await db().from('wa_group_members').upsert(groupIds.map((g) => ({ group_id: g, contact_id: data.id })), { onConflict: 'group_id,contact_id', ignoreDuplicates: true });
    }
    return { contact: data };
});

/** Bulk paste/CSV: rows [{ name, phone }] (or `text` with one "name, phone" per line). */
export const importContacts = handle(async (req) => {
    let rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length && typeof req.body.text === 'string') {
        rows = req.body.text.split(/\r?\n/).map((line) => {
            const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
            const phoneIdx = parts.findIndex((p) => /\d{7,}/.test(p.replace(/\D/g, '')));
            if (phoneIdx === -1) return null;
            const name = parts.filter((_, i) => i !== phoneIdx).join(' ');
            return { name, phone: parts[phoneIdx] };
        }).filter(Boolean);
    }
    if (rows.length > 5000) throw bad('Import at most 5,000 contacts at a time.');
    const tags = cleanTags(req.body.tags);
    const seen = new Set();
    const valid = [];
    let invalid = 0;
    for (const r of rows) {
        const phone = normalizePhone(r?.phone);
        if (!phone) { invalid += 1; continue; }
        if (seen.has(phone)) continue;
        seen.add(phone);
        valid.push({ name: str(r.name, 120), phone, tags, source: 'import' });
    }

    let added = 0;
    for (let i = 0; i < valid.length; i += 500) {
        const { data, error } = await db().from('wa_contacts')
            .upsert(valid.slice(i, i + 500), { onConflict: 'phone', ignoreDuplicates: true }).select('id');
        if (error) throw error;
        added += data?.length || 0;
    }

    const groupId = uuidList([req.body.groupId])[0];
    if (groupId && valid.length) {
        const phones = valid.map((v) => v.phone);
        for (let i = 0; i < phones.length; i += 300) {
            const { data: ids } = await db().from('wa_contacts').select('id').in('phone', phones.slice(i, i + 300));
            await db().from('wa_group_members').upsert((ids || []).map((c) => ({ group_id: groupId, contact_id: c.id })), { onConflict: 'group_id,contact_id', ignoreDuplicates: true });
        }
    }
    return { added, skippedExisting: valid.length - added, invalid };
});

export const updateContact = handle(async (req) => {
    const patch = { updated_at: new Date().toISOString() };
    if ('name' in req.body) patch.name = str(req.body.name, 120);
    if ('tags' in req.body) patch.tags = cleanTags(req.body.tags);
    if ('notes' in req.body) patch.notes = str(req.body.notes, 1000) || null;
    if ('phone' in req.body) {
        const phone = normalizePhone(req.body.phone);
        if (!phone) throw bad('Enter a valid phone number.');
        patch.phone = phone;
    }
    if ('opted_out' in req.body) {
        patch.opted_out = !!req.body.opted_out;
        patch.opted_out_at = patch.opted_out ? new Date().toISOString() : null;
    }
    const { data, error } = await db().from('wa_contacts').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (patch.opted_out) {
        // Opting out cancels anything already queued for them.
        await db().from('wa_messages').update({ status: 'skipped', error: 'Contact opted out' }).eq('contact_id', req.params.id).eq('status', 'pending');
    }
    return { contact: data };
});

export const deleteContact = handle(async (req) => {
    const { error } = await db().from('wa_contacts').delete().eq('id', req.params.id);
    if (error) throw error;
});

export const runSync = handle(async () => syncContacts());

// ── Groups ────────────────────────────────────────────────────────────────

export const listGroups = handle(async () => {
    const { data, error } = await db().from('wa_groups').select('*, wa_group_members(count)').order('created_at', { ascending: false });
    if (error) throw error;
    return { groups: (data || []).map((g) => ({ ...g, memberCount: g.wa_group_members?.[0]?.count || 0, wa_group_members: undefined })) };
});

export const createGroup = handle(async (req) => {
    const name = str(req.body.name, 80);
    if (!name) throw bad('Group name is required.');
    const { data, error } = await db().from('wa_groups').insert({ name, description: str(req.body.description, 500) || null }).select().single();
    if (error) throw error;
    return { group: data };
});

export const updateGroup = handle(async (req) => {
    const patch = {};
    if ('name' in req.body) patch.name = str(req.body.name, 80);
    if ('description' in req.body) patch.description = str(req.body.description, 500) || null;
    const { data, error } = await db().from('wa_groups').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    return { group: data };
});

export const deleteGroup = handle(async (req) => {
    const { error } = await db().from('wa_groups').delete().eq('id', req.params.id);
    if (error) throw error;
});

/** Add members by explicit ids and/or everyone with given tags. */
export const addGroupMembers = handle(async (req) => {
    const ids = new Set(uuidList(req.body.contactIds));
    const tags = cleanTags(req.body.tags);
    if (tags.length) {
        const contacts = await resolveAudience({ tags });
        contacts.forEach((c) => ids.add(c.id));
    }
    const rows = [...ids].map((contact_id) => ({ group_id: req.params.id, contact_id }));
    let added = 0;
    for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await db().from('wa_group_members')
            .upsert(rows.slice(i, i + 500), { onConflict: 'group_id,contact_id', ignoreDuplicates: true }).select('contact_id');
        if (error) throw error;
        added += data?.length || 0;
    }
    return { added };
});

export const removeGroupMembers = handle(async (req) => {
    const ids = uuidList(req.body.contactIds);
    if (!ids.length) throw bad('No contacts selected.');
    const { error } = await db().from('wa_group_members').delete().eq('group_id', req.params.id).in('contact_id', ids);
    if (error) throw error;
    return { removed: ids.length };
});

// ── Audience preview ──────────────────────────────────────────────────────

export const previewAudience = handle(async (req) => {
    const contacts = await resolveAudience(cleanAudience(req.body.audience));
    const sampleBody = str(req.body.body, 4000);
    return {
        count: contacts.length,
        sample: contacts.slice(0, 5).map((c) => ({ id: c.id, name: c.name, phone: c.phone, preview: sampleBody ? personalize(sampleBody, c) : undefined })),
    };
});

// ── Campaigns ─────────────────────────────────────────────────────────────

export const listCampaigns = handle(async () => {
    const { data, error } = await db().from('wa_campaigns').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    // Delivery stats per campaign.
    const ids = (data || []).map((c) => c.id);
    const stats = {};
    if (ids.length) {
        const { data: msgs } = await db().from('wa_messages').select('campaign_id, status').in('campaign_id', ids).limit(50000);
        (msgs || []).forEach((m) => {
            stats[m.campaign_id] = stats[m.campaign_id] || { pending: 0, sent: 0, skipped: 0, failed: 0 };
            stats[m.campaign_id][m.status] = (stats[m.campaign_id][m.status] || 0) + 1;
        });
    }
    return { campaigns: (data || []).map((c) => ({ ...c, stats: stats[c.id] || null })) };
});

function campaignPayload(b) {
    const name = str(b.name, 120);
    if (!name) throw bad('Campaign name is required.');
    const scheduled = b.scheduled_for ? new Date(b.scheduled_for) : null;
    if (scheduled && Number.isNaN(scheduled.getTime())) throw bad('Invalid schedule time.');
    return { name, ...cleanMessage(b), audience: cleanAudience(b.audience), scheduled_for: scheduled ? scheduled.toISOString() : null };
}

export const createCampaign = handle(async (req) => {
    const { data, error } = await db().from('wa_campaigns').insert({ ...campaignPayload(req.body), status: 'draft' }).select().single();
    if (error) throw error;
    return { campaign: data };
});

export const updateCampaign = handle(async (req) => {
    const { data: cur } = await db().from('wa_campaigns').select('status').eq('id', req.params.id).single();
    if (cur?.status === 'queued') throw bad('This broadcast has already been queued and can no longer be edited.');
    const { data, error } = await db().from('wa_campaigns').update(campaignPayload(req.body)).eq('id', req.params.id).select().single();
    if (error) throw error;
    return { campaign: data };
});

export const deleteCampaign = handle(async (req) => {
    const { error } = await db().from('wa_campaigns').delete().eq('id', req.params.id);
    if (error) throw error;
});

/** Queue now, or mark scheduled if scheduled_for is in the future. */
export const launchCampaign = handle(async (req) => {
    const { data: c, error } = await db().from('wa_campaigns').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    if (c.status === 'queued') throw bad('Already queued.');
    if (c.scheduled_for && new Date(c.scheduled_for) > new Date()) {
        await db().from('wa_campaigns').update({ status: 'scheduled' }).eq('id', c.id);
        return { scheduled: true, scheduled_for: c.scheduled_for };
    }
    return { scheduled: false, ...(await queueCampaign(c)) };
});

export const cancelCampaign = handle(async (req) => {
    await db().from('wa_campaigns').update({ status: 'cancelled' }).eq('id', req.params.id);
    const { data } = await db().from('wa_messages')
        .update({ status: 'skipped', error: 'Broadcast cancelled' })
        .eq('campaign_id', req.params.id).eq('status', 'pending').select('id');
    return { skipped: data?.length || 0 };
});

// ── Sequences ─────────────────────────────────────────────────────────────

export const listSequences = handle(async () => {
    const { data, error } = await db().from('wa_sequences')
        .select('*, wa_sequence_steps(*), wa_groups(id, name)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return {
        sequences: (data || []).map((s) => ({
            ...s,
            steps: (s.wa_sequence_steps || []).sort((a, b) => a.day_number - b.day_number),
            group: s.wa_groups || null,
            wa_sequence_steps: undefined,
            wa_groups: undefined,
        })),
    };
});

function sequencePayload(b) {
    const name = str(b.name, 120);
    if (!name) throw bad('Sequence name is required.');
    const startMode = b.start_mode === 'fixed' ? 'fixed' : 'joined';
    const startDate = str(b.start_date, 10);
    if (startMode === 'fixed' && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw bad('Pick a start date for a fixed-date sequence.');
    return {
        name,
        description: str(b.description, 500) || null,
        group_id: uuidList([b.group_id])[0] || null,
        start_mode: startMode,
        start_date: startMode === 'fixed' ? startDate : null,
        excluded_contact_ids: uuidList(b.excluded_contact_ids),
        active: b.active !== false,
    };
}

async function replaceSteps(sequenceId, steps) {
    if (!Array.isArray(steps)) return;
    const clean = [];
    const days = new Set();
    for (const s of steps) {
        const day = parseInt(s.day_number, 10);
        if (!day || day < 1 || day > 365) throw bad('Each message needs a day number between 1 and 365.');
        if (days.has(day)) throw bad(`Two messages are set for Day ${day}. Each day can have one message.`);
        days.add(day);
        clean.push({ sequence_id: sequenceId, day_number: day, ...cleanMessage(s) });
    }
    // Keep step ids stable for unchanged days so already-sent history stays linked.
    const { data: existing } = await db().from('wa_sequence_steps').select('id, day_number').eq('sequence_id', sequenceId);
    const toDelete = (existing || []).filter((e) => !days.has(e.day_number)).map((e) => e.id);
    if (toDelete.length) await db().from('wa_sequence_steps').delete().in('id', toDelete);
    if (clean.length) {
        const { error } = await db().from('wa_sequence_steps').upsert(clean, { onConflict: 'sequence_id,day_number' });
        if (error) throw error;
    }
}

export const createSequence = handle(async (req) => {
    const { data, error } = await db().from('wa_sequences').insert(sequencePayload(req.body)).select().single();
    if (error) throw error;
    await replaceSteps(data.id, req.body.steps || []);
    return { sequence: data };
});

export const updateSequence = handle(async (req) => {
    const { data, error } = await db().from('wa_sequences').update(sequencePayload(req.body)).eq('id', req.params.id).select().single();
    if (error) throw error;
    await replaceSteps(data.id, req.body.steps);
    return { sequence: data };
});

export const toggleSequence = handle(async (req) => {
    const { data, error } = await db().from('wa_sequences').update({ active: !!req.body.active }).eq('id', req.params.id).select().single();
    if (error) throw error;
    return { sequence: data };
});

export const deleteSequence = handle(async (req) => {
    const { error } = await db().from('wa_sequences').delete().eq('id', req.params.id);
    if (error) throw error;
});

export const getSequencePreview = handle(async (req) => ({ days: await previewSequence(req.params.id, 7) }));

// ── Queue ─────────────────────────────────────────────────────────────────

export const listQueue = handle(async (req) => {
    const status = str(req.query.status, 20) || 'pending';
    const date = str(req.query.date, 10);
    let q = db().from('wa_messages')
        .select('*, wa_campaigns(name), wa_sequences(name), wa_sequence_steps(day_number)')
        .order('scheduled_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(500);
    if (status !== 'all') q = q.eq('status', status);
    if (status === 'pending') q = q.lte('scheduled_date', date || todayIST());
    else if (date) q = q.eq('scheduled_date', date);
    const { data, error } = await q;
    if (error) throw error;
    return {
        rows: (data || []).map((m) => ({
            ...m,
            source: m.wa_campaigns?.name
                ? `Broadcast · ${m.wa_campaigns.name}`
                : m.wa_sequences?.name ? `${m.wa_sequences.name} · Day ${m.wa_sequence_steps?.day_number ?? '?'}` : 'Direct message',
            wa_campaigns: undefined, wa_sequences: undefined, wa_sequence_steps: undefined,
        })),
    };
});

export const runBuildQueue = handle(async () => buildDailyQueue());

/** Assisted send: mark a message sent / skipped / back to pending. */
export const updateQueueItem = handle(async (req) => {
    const status = str(req.body.status, 20);
    if (!['sent', 'skipped', 'pending'].includes(status)) throw bad('Invalid status.');
    const patch = { status, channel: status === 'sent' ? 'assisted' : null, sent_at: status === 'sent' ? new Date().toISOString() : null };
    const { data, error } = await db().from('wa_messages').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    return { message: data };
});

export const bulkSkipQueue = handle(async (req) => {
    const ids = uuidList(req.body.ids);
    if (!ids.length) throw bad('Nothing selected.');
    const { error } = await db().from('wa_messages').update({ status: 'skipped' }).in('id', ids).eq('status', 'pending');
    if (error) throw error;
    return { skipped: ids.length };
});

export const runDispatch = handle(async (req) => dispatchPending({ limit: 25, ids: uuidList(req.body?.ids) }));

/**
 * Direct message: one personalised message to chosen contacts and/or groups,
 * without creating a broadcast. Rows go into wa_messages (no campaign/step)
 * so they're logged and show up in the queue's Sent history. Returned rows
 * are sent by hand from the modal, or via dispatch with their ids.
 */
export const createDirectMessages = handle(async (req) => {
    const msg = cleanMessage(req.body);
    const contacts = await resolveAudience({
        contactIds: uuidList(req.body.contactIds),
        groupIds: uuidList(req.body.groupIds),
    });
    if (!contacts.length) throw bad('No one to message. They may have stopped messages, or the group is empty.');
    if (contacts.length > 1000) throw bad('That is over 1,000 people. Use a broadcast for large audiences.');
    const day = todayIST();
    const rows = contacts.map((c) => ({
        contact_id: c.id,
        phone: c.phone,
        name: c.name,
        body: personalize(msg.body, c),
        image_url: msg.image_url,
        cta_label: msg.cta_label,
        cta_url: msg.cta_url,
        meta_template_name: msg.meta_template_name,
        meta_template_lang: msg.meta_template_lang,
        scheduled_date: day,
    }));
    const created = [];
    for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await db().from('wa_messages').insert(rows.slice(i, i + 500)).select();
        if (error) throw error;
        created.push(...(data || []));
    }
    return { messages: created, apiConfigured: apiConfigured() };
});

// ── Cron (Vercel) ─────────────────────────────────────────────────────────

/**
 * GET /api/cron/whatsapp — called by Vercel Cron once a day (vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Builds today's queue
 * and, if the Cloud API is connected, sends a first batch.
 */
export async function cronWhatsApp(req, res) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const built = await buildDailyQueue();
        let dispatched = null;
        if (apiConfigured()) dispatched = await dispatchPending({ limit: 40 });
        logger.info(`[whatsapp-cron] built ${JSON.stringify(built)} dispatched ${JSON.stringify(dispatched)}`);
        return res.json({ ok: true, built, dispatched });
    } catch (err) {
        logger.error(`[whatsapp-cron] failed: ${err.message}`);
        return res.status(500).json({ error: err.message });
    }
}
