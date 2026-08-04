// src/services/contentService.js
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

const CACHE_TTL_MS = 30_000;
let _cache = { data: null, ts: 0 };

// Bumped on every content mutation. The frontend polls this cheaply (no DB
// query, just a number in memory) to know when to refetch the full content
// payload — that's what lets an already-open customer tab pick up an admin
// price/content change without the customer having to hard-refresh.
let _version = Date.now();

export function invalidateContentCache() {
    _cache = { data: null, ts: 0 };
    _version = Date.now();
    // Defined further down, but this function only ever runs after the
    // whole module has finished evaluating — safe to reset here so a
    // saved logging-toggle change takes effect on the very next log call
    // instead of waiting out the cache TTL.
    _verboseLoggingCache = { value: null, ts: 0 };
}

export function getContentVersion() {
    return _version;
}

export const ALLOWED_TABLES = [
    'coaching_types',
    'durations',
    'diet_foods',
    'diet_exercises',
    'recode_method',
    'testimonials',
    'blog_posts',
    'transformations',
    'faqs',
    'legal_pages',
];

const SITE_KEYS = [
    'brand',
    'coach',
    'contact',
    'why_recode',
    'target_audience',
    'plan_inclusions',
    'hero',
    'navbar',
    'footer',
    'whatsapp_templates',
    'sticky_cta',
    'floating_whatsapp',
    'pricing_sale_flags',
    'pricing_popular_flags',
    'maintenance',
    'logging',
    'diet_units',
];

function assertTable(table) {
    if (!ALLOWED_TABLES.includes(table)) {
        const err = new Error(`Unknown content table: ${table}`);
        err.status = 400;
        throw err;
    }
}

function assertSiteKey(key) {
    if (!SITE_KEYS.includes(key)) {
        const err = new Error(`Unknown site content key: ${key}`);
        err.status = 400;
        throw err;
    }
}

// ── Generic table CRUD (admin) ────────────────────────────────────────────
export async function listRows(table) {
    assertTable(table);

    const supabase = getSupabaseAdmin();

    // legal_pages has no sort_order column — it's keyed by slug, not ranked.
    let query = supabase.from(table).select('*');
    query = table === 'legal_pages'
        ? query.order('slug', { ascending: true })
        : query.order('sort_order', { ascending: true });

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
}

export async function createRow(table, payload) {
    assertTable(table);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from(table)
        .insert([payload])
        .select()
        .single();

    if (error) throw error;

    invalidateContentCache();

    return data;
}

export async function updateRow(table, id, payload, idColumn = 'id') {
    assertTable(table);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq(idColumn, id)
        .select()
        .single();

    if (error) throw error;

    invalidateContentCache();

    return data;
}

export async function deleteRow(table, id, idColumn = 'id') {
    assertTable(table);

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
        .from(table)
        .delete()
        .eq(idColumn, id);

    if (error) throw error;

    invalidateContentCache();
}

// ── Legal pages ───────────────────────────────────────────────────────────
export async function upsertLegalPage(slug, payload) {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('legal_pages')
        .upsert(
            {
                slug,
                ...payload,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: 'slug',
            }
        )
        .select()
        .single();

    if (error) throw error;

    invalidateContentCache();

    return data;
}

// ── site_content singleton keys ───────────────────────────────────────────
export async function getSiteContent(key) {
    assertSiteKey(key);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('site_content')
        .select('value')
        .eq('key', key)
        .maybeSingle();

    if (error) throw error;

    return data?.value ?? null;
}

export async function setSiteContent(key, value) {
    assertSiteKey(key);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('site_content')
        .upsert(
            {
                key,
                value,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: 'key',
            }
        )
        .select()
        .single();

    if (error) throw error;

    invalidateContentCache();

    return data.value;
}

// Cheap standalone check for the payment flow — does NOT go through the
// getPublicContent() cache, so an admin flipping maintenance on takes
// effect on the very next checkout attempt instead of waiting up to
// CACHE_TTL_MS for the public payload cache to expire.
export async function isMaintenanceModeEnabled() {
    const value = await getSiteContent('maintenance');
    return !!value?.enabled;
}

// ── Verbose logging toggle ────────────────────────────────────────────────
// Unlike isMaintenanceModeEnabled(), this IS cached — logTxnStep() calls this
// on every single transaction-log write (many per checkout: order created,
// signature checked, DB updated, coupon incremented, ledger inserted, each
// email...), so a fresh DB read per call would itself add back a meaningful
// chunk of the load this setting exists to cut. A short TTL keeps an admin's
// toggle taking effect within seconds rather than needing a restart.
const LOGGING_SETTING_CACHE_TTL_MS = 30_000;
let _verboseLoggingCache = { value: null, ts: 0 };

export async function isVerboseLoggingEnabled() {
    const now = Date.now();
    if (_verboseLoggingCache.value !== null && now - _verboseLoggingCache.ts < LOGGING_SETTING_CACHE_TTL_MS) {
        return _verboseLoggingCache.value;
    }
    // Default OFF — reducing load is the point until an admin opts in.
    let verbose = false;
    try {
        const value = await getSiteContent('logging');
        verbose = !!value?.verbose;
    } catch {
        // Leave the last-known value in place on a transient read failure
        // rather than assuming a state we haven't actually confirmed.
        return _verboseLoggingCache.value ?? false;
    }
    _verboseLoggingCache = { value: verbose, ts: now };
    return verbose;
}

// ── basic_consultation singleton ──────────────────────────────────────────
export async function getBasicConsultation() {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('basic_consultation')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

    if (error) throw error;

    return data;
}

export async function updateBasicConsultation(payload) {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('basic_consultation')
        .upsert(
            {
                id: 1,
                ...payload,
            },
            {
                onConflict: 'id',
            }
        )
        .select()
        .single();

    if (error) throw error;

    invalidateContentCache();

    return data;
}

// ── pricing ───────────────────────────────────────────────────────────────
// Nested shape:
// {
//   [coachingTypeId]: {
//     [planType]: {
//       [months]: price
//     }
//   }
// }

export async function getPricingRows() {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('pricing')
        .select('*');

    if (error) throw error;

    return data || [];
}

export function nestPricing(rows) {
    const table = {};

    for (const r of rows) {
        table[r.coaching_type_id] ??= {};
        table[r.coaching_type_id][r.plan_type] ??= {};

        table[r.coaching_type_id][r.plan_type][r.duration_months] =
            Number(r.price);
    }

    return table;
}

export async function getPricingTable() {
    return nestPricing(await getPricingRows());
}

// rows:
// [{ coachingTypeId, planType, durationMonths, price }]
export async function bulkUpsertPricing(rows) {
    const supabase = getSupabaseAdmin();

    const payload = rows.map((r) => ({
        coaching_type_id: r.coachingTypeId,
        plan_type: r.planType,
        duration_months: String(r.durationMonths),
        price: Number(r.price),
    }));

    const { error } = await supabase
        .from('pricing')
        .upsert(payload, {
            onConflict: 'coaching_type_id,plan_type,duration_months',
        });

    if (error) throw error;

    invalidateContentCache();

    return getPricingTable();
}

export async function deletePricingRow(id) {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
        .from('pricing')
        .delete()
        .eq('id', id);

    if (error) throw error;

    invalidateContentCache();
}

// ── Assembled public payload (cached) ────────────────────────────────────
// Everything the landing site needs.
export async function getPublicContent() {
    const now = Date.now();

    if (_cache.data && now - _cache.ts < CACHE_TTL_MS) {
        return _cache.data;
    }

    const [
        brand,
        coach,
        contact,
        whyRecode,
        targetAudience,
        planInclusions,
        hero,
        navbar,
        footer,
        whatsappTemplates,
        stickyCta,
        floatingWhatsapp,
        saleFlags,
        popularFlags,
        maintenance,
        coachingTypes,
        durationsRows,
        pricingRows,
        basicConsultation,
        recodeMethod,
        testimonials,
        blogPosts,
        transformations,
        faqsRows,
        legalPagesRows,
    ] = await Promise.all([
        getSiteContent('brand'),
        getSiteContent('coach'),
        getSiteContent('contact'),
        getSiteContent('why_recode'),
        getSiteContent('target_audience'),
        getSiteContent('plan_inclusions'),

        getSiteContent('hero'),
        getSiteContent('navbar'),
        getSiteContent('footer'),
        getSiteContent('whatsapp_templates'),
        getSiteContent('sticky_cta'),
        getSiteContent('floating_whatsapp'),
        getSiteContent('pricing_sale_flags'),
        getSiteContent('pricing_popular_flags'),
        getSiteContent('maintenance'),

        listRows('coaching_types'),
        listRows('durations'),
        getPricingRows(),
        getBasicConsultation(),
        listRows('recode_method'),
        listRows('testimonials'),
        listRows('blog_posts'),
        listRows('transformations'),
        listRows('faqs'),
        listRows('legal_pages'),
    ]);

    const pricingTableMapped = nestPricing(pricingRows);
    // Map keyed by "coachingTypeId:planType:durationMonths" → { onSale, originalPrice }.
    // Replaces the old durations.on_sale column, which applied to every
    // coaching type and plan type at once instead of one specific cell.
    const saleFlagsMapped = (saleFlags && typeof saleFlags === 'object' && !Array.isArray(saleFlags)) ? saleFlags : {};
    // Map keyed by "coachingTypeId:planType:durationMonths" → true. Replaces
    // the old durations.popular column, which marked a duration as "Most
    // Popular" for every coaching type and plan type at once instead of one
    // specific cell.
    const popularFlagsMapped = (popularFlags && typeof popularFlags === 'object' && !Array.isArray(popularFlags)) ? popularFlags : {};

    const data = {
        brand: brand || {},
        coach: coach || {},
        contact: contact || {},

        whyRecode: whyRecode || {
            others: [],
            recode: [],
        },

        targetAudience: targetAudience || [],
        planInclusions: planInclusions || [],

        hero: hero || {},

        navbar: navbar || {
            navItems: [],
        },

        footer: footer || {
            navSections: [],
            programs: [],
            resources: [],
            legalLinks: [],
        },

        whatsappTemplates: whatsappTemplates || {},
        stickyCta: stickyCta || {},
        floatingWhatsapp: floatingWhatsapp || {},
        saleFlags: saleFlagsMapped,
        popularFlags: popularFlagsMapped,
        maintenance: maintenance || { enabled: false },

        coachingTypes: coachingTypes
            .filter((c) => c.active)
            .map(mapCoachingType),

        durations: durationsRows.map(mapDuration),

        pricingTable: pricingTableMapped,

        basicConsultation: mapBasicConsultation(basicConsultation, pricingTableMapped, saleFlagsMapped),

        recodeMethod: recodeMethod.map(mapRecodeMethod),

        testimonials: testimonials
            .filter((t) => t.active)
            .map(mapTestimonial),

        blogPosts: blogPosts
            .filter((b) => b.active)
            .map(mapBlogPost),

        transformations: transformations
            .filter((t) => t.active)
            .map(mapTransformation),

        faqs: faqsRows
            .filter((f) => f.active)
            .map(mapFaq),

        // legal_pages uses slug as its identifier.
        // Convert:
        // [{ slug: 'terms', ... }, { slug: 'privacy-policy', ... }]
        //
        // into:
        // {
        //   terms: {...},
        //   'privacy-policy': {...}
        // }
        legalPages: Object.fromEntries(
            (legalPagesRows || []).map((p) => [p.slug, p])
        ),
    };

    _cache = {
        data,
        ts: now,
    };

    return data;
}

// ── snake_case (DB) → camelCase (frontend) ────────────────────────────────
// Matches the old SiteData.js frontend shape.

function mapCoachingType(r) {
    return {
        id: r.id,
        name: r.name,
        shortName: r.short_name,
        tagline: r.tagline,
        description: r.description,
        features: r.features || [],
        note: r.note,
        cta: r.cta,
    };
}

function mapDuration(r) {
    return {
        months: r.months,
        label: r.label,
        sublabel: r.sublabel,
        description: r.description,
        popular: r.popular,
    };
}

// Basic Consultation is just another cell in the unified pricing table
// (coaching type "online", plan type "basic_individual"/"basic_couple",
// duration "1") — NOT a separate priced entity. The basic_consultation
// table only holds marketing copy (name/tagline/description/features) now.
// Price and "on sale" state both come from the same source every other
// plan uses, so there's exactly one place to edit either.
function mapBasicConsultation(r, pricingTable, saleFlags) {
    if (!r) return null;

    const individualKey = 'online:basic_individual:1';
    const coupleKey = 'online:basic_couple:1';

    return {
        coachingId: 'basic',
        name: r.name,
        tagline: r.tagline,
        description: r.description,
        priceIndividual: Number(pricingTable.online?.basic_individual?.['1'] ?? 0),
        priceCouple: Number(pricingTable.online?.basic_couple?.['1'] ?? 0),
        originalPriceIndividual: saleFlags[individualKey]?.onSale ? Number(saleFlags[individualKey].originalPrice) || null : null,
        originalPriceCouple: saleFlags[coupleKey]?.onSale ? Number(saleFlags[coupleKey].originalPrice) || null : null,
        saleLabel: r.sale_label,
        features: r.features || [],
    };
}

function mapRecodeMethod(r) {
    return {
        step: r.step,
        title: r.title,
        description: r.description,
        color: r.color,
        accent: r.accent,
    };
}

function mapTestimonial(r) {
    return {
        id: r.id,
        name: r.name,
        role: r.role,
        transformation: r.transformation,
        weightLost: r.weight_lost,
        quote: r.quote,
        rating: r.rating,
        avatar: r.avatar,
    };
}

function mapBlogPost(r) {
    return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        excerpt: r.excerpt,
        category: r.category,
        readTime: r.read_time,
        date: r.post_date,
        image: r.image,
        content: r.content,
    };
}

function mapTransformation(r) {
    return {
        id: r.id,
        name: r.name,
        role: r.role,
        duration: r.duration,
        weightLost: r.weight_lost,
        category: r.category,
        quote: r.quote,
        stats: r.stats || {},
        photoBefore: r.photo_before,
        photoAfter: r.photo_after,
    };
}

function mapFaq(r) {
    return {
        id: r.id,
        category: r.category,
        question: r.question,
        answer: r.answer,
    };
}