// src/scripts/seedContent.js
// Run from backend root:
// node src/scripts/seedContent.js

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

import {
    brand,
    coach,
    contact,
    whyRecode,
    targetAudience,
    planInclusions,
    coachingTypes,
    pricingTable,
    basicConsultation,
    durations,
    services,
    recodeMethod,
    testimonials,
    blogPosts,
} from '../data/SiteData.js';

// ─────────────────────────────────────────────────────────────────────────────
// Load .env from BACKEND ROOT
//
// Current file:
//   backend/src/scripts/seedContent.js
//
// .env:
//   backend/.env
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.resolve(__dirname, '../../.env'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Validate environment
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL) {
    console.error('❌ SUPABASE_URL is missing from backend .env');
    process.exit(1);
}

if (!SUPABASE_SECRET_KEY) {
    console.error('❌ SUPABASE_SECRET_KEY is missing from backend .env');
    process.exit(1);
}

console.log('✓ Environment loaded');

// ─────────────────────────────────────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
        realtime: {
            transport: WebSocket,
        },
    }
);

// Helper so seed failures don't get silently ignored.
async function check(label, promise) {
    const result = await promise;

    if (result.error) {
        console.error(`❌ ${label} failed:`);
        console.error(result.error);
        throw result.error;
    }

    console.log(`✓ ${label}`);

    return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
    console.log('');
    console.log('🌱 Starting content seed...');
    console.log('');

    // ── site_content — original data ──────────────────────────────────────

    await check(
        'site_content (base)',
        supabase
            .from('site_content')
            .upsert(
                [
                    {
                        key: 'brand',
                        value: brand,
                    },
                    {
                        key: 'coach',
                        value: coach,
                    },
                    {
                        key: 'contact',
                        value: contact,
                    },
                    {
                        key: 'why_recode',
                        value: whyRecode,
                    },
                    {
                        key: 'target_audience',
                        value: targetAudience,
                    },
                    {
                        key: 'plan_inclusions',
                        value: planInclusions,
                    },
                ],
                {
                    onConflict: 'key',
                }
            )
    );

    // ── Hero ──────────────────────────────────────────────────────────────

    await check(
        'site_content.hero',
        supabase
            .from('site_content')
            .upsert(
                {
                    key: 'hero',
                    value: {
                        typewriterWords: [
                            'Recover.',
                            'Regulate.',
                            'Rebuild.',
                        ],
                        trailingLine: 'Your Life.',
                        badgeText:
                            'Founding Member Pricing · Limited to First 20 Members',
                        brandTag:
                            'RECODE™ · Recovery-Based Transformation',
                        subtext1:
                            'A recovery-based transformation system designed to restore structure, regulate the body, and create sustainable physical transformation.',
                        subtext2:
                            'Helping professionals, entrepreneurs, students & families through Online Coaching, Video Consultation & Personal Training in Mumbai.',
                        ctaPrimaryLabel:
                            'Apply For Coaching',
                        ctaSecondaryLabel:
                            'View Transformations',
                        stats: [
                            {
                                icon: 'TrendingUp',
                                value: 29,
                                suffix: 'kg',
                                label: 'Personal Transformation',
                            },
                            {
                                icon: 'Users',
                                value: 200,
                                suffix: '+',
                                label: 'Clients Guided',
                            },
                            {
                                icon: 'Clock',
                                value: 8,
                                suffix: '+',
                                label: 'Years Experience',
                            },
                            {
                                icon: 'Award',
                                value: null,
                                label: 'ACSM Certified',
                                display: 'ACSM',
                            },
                        ],
                    },
                },
                {
                    onConflict: 'key',
                }
            )
    );

    // ── Navbar ────────────────────────────────────────────────────────────

    await check(
        'site_content.navbar',
        supabase
            .from('site_content')
            .upsert(
                {
                    key: 'navbar',
                    value: {
                        navItems: [
                            {
                                name: 'Home',
                                href: '#home',
                            },
                            {
                                name: 'About',
                                href: '#about',
                            },
                            {
                                name: 'Transformations',
                                href: '#transformations',
                            },
                            {
                                name: 'Testimonials',
                                href: '#testimonials',
                            },
                            {
                                name: 'Programs & Pricing',
                                href: '#pricing',
                            },
                            {
                                name: 'Blog',
                                href: '#blog',
                            },
                            {
                                name: 'Contact',
                                href: '#contact',
                            },
                        ],
                    },
                },
                {
                    onConflict: 'key',
                }
            )
    );

    // ── Footer ────────────────────────────────────────────────────────────

    await check(
        'site_content.footer',
        supabase
            .from('site_content')
            .upsert(
                {
                    key: 'footer',
                    value: {
                        navSections: [
                            {
                                name: 'Home',
                                href: '#home',
                            },
                            {
                                name: 'About',
                                href: '#about',
                            },
                            {
                                name: 'Transformations',
                                href: '#transformations',
                            },
                            {
                                name: 'Testimonials',
                                href: '#testimonials',
                            },
                            {
                                name: 'Programs & Pricing',
                                href: '#pricing',
                            },
                            {
                                name: 'Blog',
                                href: '#blog',
                            },
                            {
                                name: 'Contact',
                                href: '#contact',
                            },
                        ],

                        programs: [
                            {
                                name: 'RECODE ONLINE',
                                href: '#pricing',
                            },
                            {
                                name: 'RECODE CONSULT',
                                href: '#pricing',
                            },
                            {
                                name: 'RECODE PERSONAL',
                                href: '#pricing',
                            },
                        ],

                        resources: [
                            {
                                name: 'Free Fitness Blog',
                                href: '#blog',
                            },
                            {
                                name: 'Before & After Results',
                                href: '#transformations',
                            },
                        ],

                        legalLinks: [
                            {
                                name: 'FAQ',
                                to: '/faq',
                            },
                            {
                                name: 'Privacy Policy',
                                to: '/privacy-policy',
                            },
                            {
                                name: 'Terms & Conditions',
                                to: '/terms',
                            },
                            {
                                name: 'Refund Policy',
                                to: '/refund-policy',
                            },
                        ],
                    },
                },
                {
                    onConflict: 'key',
                }
            )
    );

    // ── Other editable site_content ───────────────────────────────────────

    await check(
        'site_content.whatsapp_templates',
        supabase
            .from('site_content')
            .upsert(
                {
                    key: 'whatsapp_templates',
                    value: {},
                },
                {
                    onConflict: 'key',
                }
            )
    );

    await check(
        'site_content.sticky_cta',
        supabase
            .from('site_content')
            .upsert(
                {
                    key: 'sticky_cta',
                    value: {},
                },
                {
                    onConflict: 'key',
                }
            )
    );

    await check(
        'site_content.floating_whatsapp',
        supabase
            .from('site_content')
            .upsert(
                {
                    key: 'floating_whatsapp',
                    value: {},
                },
                {
                    onConflict: 'key',
                }
            )
    );

    // ── coaching_types ────────────────────────────────────────────────────

    await check(
        'coaching_types',
        supabase
            .from('coaching_types')
            .upsert(
                coachingTypes.map((c, i) => ({
                    id: c.id,
                    name: c.name,
                    short_name: c.shortName,
                    tagline: c.tagline,
                    description: c.description,
                    features: c.features,
                    note: c.note || null,
                    cta: c.cta,
                    sort_order: i,
                    active: true,
                })),
                {
                    onConflict: 'id',
                }
            )
    );

    // ── durations ─────────────────────────────────────────────────────────

    await check(
        'durations',
        supabase
            .from('durations')
            .upsert(
                durations.map((d, i) => ({
                    months: d.months,
                    label: d.label,
                    sublabel: d.sublabel,
                    description: d.description,
                    popular: !!d.popular,
                    sort_order: i,
                })),
                {
                    onConflict: 'months',
                }
            )
    );

    // ── pricing ───────────────────────────────────────────────────────────

    const pricingRows = [];

    for (
        const [coachingTypeId, plans]
        of Object.entries(pricingTable)
    ) {
        for (
            const [planType, months]
            of Object.entries(plans)
        ) {
            for (
                const [durationMonths, price]
                of Object.entries(months)
            ) {
                pricingRows.push({
                    coaching_type_id: coachingTypeId,
                    plan_type: planType,
                    duration_months: durationMonths,
                    price: Number(price),
                });
            }
        }
    }

    await check(
        'pricing',
        supabase
            .from('pricing')
            .upsert(
                pricingRows,
                {
                    onConflict:
                        'coaching_type_id,plan_type,duration_months',
                }
            )
    );

    // ── basic_consultation ────────────────────────────────────────────────

    await check(
        'basic_consultation',
        supabase
            .from('basic_consultation')
            .upsert(
                {
                    id: 1,

                    name:
                        basicConsultation.name,

                    tagline:
                        basicConsultation.tagline,

                    description:
                        basicConsultation.description,

                    price_individual:
                        Number(
                            basicConsultation.priceIndividual
                        ),

                    price_couple:
                        Number(
                            basicConsultation.priceCouple
                        ),

                    original_price_individual:
                        Number(
                            basicConsultation.originalPriceIndividual
                        ),

                    original_price_couple:
                        Number(
                            basicConsultation.originalPriceCouple
                        ),

                    sale_label:
                        basicConsultation.saleLabel,

                    features:
                        basicConsultation.features,
                },
                {
                    onConflict: 'id',
                }
            )
    );

    // ── services ──────────────────────────────────────────────────────────

    await check(
        'services',
        supabase
            .from('services')
            .upsert(
                services.map((s, i) => ({
                    id: s.id,
                    title: s.title,
                    subtitle: s.subtitle,
                    features: s.features,
                    badge: s.badge,
                    color: s.color,
                    accent: s.accent,
                    sort_order: i,
                    active: true,
                })),
                {
                    onConflict: 'id',
                }
            )
    );

    // ── recode_method ─────────────────────────────────────────────────────

    await check(
        'recode_method',
        supabase
            .from('recode_method')
            .upsert(
                recodeMethod.map((r, i) => ({
                    step: r.step,
                    title: r.title,
                    description: r.description,
                    color: r.color,
                    accent: r.accent,
                    sort_order: i,
                }))
            )
    );

    // ── testimonials ──────────────────────────────────────────────────────

    await check(
        'testimonials',
        supabase
            .from('testimonials')
            .insert(
                testimonials.map((t, i) => ({
                    // Do NOT send id.
                    // Supabase/Postgres will generate the UUID automatically.
                    name: t.name,
                    role: t.role,
                    transformation: t.transformation,
                    weight_lost: t.weightLost,
                    quote: t.quote,
                    rating: t.rating,
                    avatar: t.avatar,
                    sort_order: i,
                    active: true,
                }))
            )
    );

    // ── blog_posts ────────────────────────────────────────────────────────

    await check(
        'blog_posts',
        supabase
            .from('blog_posts')
            .upsert(
                blogPosts.map((b, i) => ({
                    slug: b.slug,
                    title: b.title,
                    excerpt: b.excerpt,
                    category: b.category,
                    read_time: b.readTime,
                    post_date: b.date,
                    image: b.image,
                    content: b.content || null,
                    sort_order: i,
                    active: true,
                })),
                {
                    onConflict: 'slug',
                }
            )
    );

    // ── FAQs ──────────────────────────────────────────────────────────────

    const faqRows = [
        {
            category: 'Getting Started',
            question:
                'How do your coaching programs work?',
            answer:
                'After you sign up, we have an in-depth consultation to understand your goals, lifestyle, and any limitations. I then create a fully customized workout and nutrition plan. We check in weekly via chat or video call, and I adjust your program based on your progress.',
            sort_order: 0,
            active: true,
        },
        {
            category: 'Getting Started',
            question:
                'How quickly will I see results?',
            answer:
                'Most clients start seeing noticeable changes within 4-6 weeks. Significant transformations typically happen in 3-6 months. Results depend on consistency, adherence to the plan, and individual factors like starting point and genetics.',
            sort_order: 1,
            active: true,
        },
        {
            category: 'Getting Started',
            question:
                'Do I need a gym membership?',
            answer:
                "Not necessarily! I offer both gym-based and home workout programs. If you prefer to train at home, I'll design an effective program using minimal equipment like dumbbells, resistance bands, or just bodyweight.",
            sort_order: 2,
            active: true,
        },
        {
            category:
                'Coaching & Nutrition',
            question:
                'What does the nutrition coaching involve?',
            answer:
                "Depending on your plan, I'll provide macro targets, meal templates, food swaps, and recipe suggestions. I focus on sustainable, flexible eating rather than restrictive diets. Premium and Elite plans include fully custom meal plans.",
            sort_order: 3,
            active: true,
        },
        {
            category:
                'Coaching & Nutrition',
            question:
                'How is online coaching different from in-person training?',
            answer:
                'Online coaching gives you the flexibility to train on your schedule, from anywhere. You get the same level of personalization and accountability — often at a lower cost. We stay connected via app, chat, and video calls.',
            sort_order: 4,
            active: true,
        },
        {
            category: 'Plans & Billing',
            question:
                'Can I cancel or change my plan anytime?',
            answer:
                "Yes. You can upgrade, downgrade, or cancel your plan at any time. If you're not satisfied within the first 7 days, I offer a full refund — no questions asked.",
            sort_order: 5,
            active: true,
        },
    ];

    await check(
        'faqs',
        supabase
            .from('faqs')
            .upsert(faqRows)
    );

    // ── Privacy Policy ────────────────────────────────────────────────────

    const privacySections = [
        {
            title: '1. Information We Collect',
            content:
                `We may collect:
• Name
• Phone number
• Email address
• Age, Height, Weight
• Fitness goals
• Lifestyle information
• Health history
• Food habits
• Training access
• Payment details
• Progress photos and updates`,
        },
        {
            title: '2. How We Use Information',
            content:
                `Your information may be used to:
• Create your coaching plan
• Track progress
• Communicate with you
• Process payments
• Send updates
• Improve services`,
        },
        {
            title: '3. Data Sharing',
            content:
                `We do not sell your personal data.

Information may be shared only with trusted service providers when required for payments, website forms, CRM, email, or service delivery.`,
        },
        {
            title: '4. Photos & Testimonials',
            content:
                `Progress photos, videos, and testimonials will only be used publicly with your explicit consent.

You may request that your identity not be shared publicly at any time.`,
        },
        {
            title: '5. Security',
            content:
                `We take reasonable steps to protect your information, but no digital platform is 100% risk-free.

We use industry-standard encryption and secure payment processing via Razorpay for all transactions.`,
        },
        {
            title: '6. Your Rights',
            content:
                `You have the right to:
• Request access to your data
• Request correction of inaccurate data
• Request deletion of your data
• Withdraw consent for marketing communications

To exercise these rights, contact us at the email below.`,
        },
        {
            title: '7. Contact',
            content:
                `For privacy questions, contact:

Email: Fitwithsudarshanofficial@gmail.com
Phone: 9619708124
Location: Mumbai, Maharashtra, India`,
        },
    ];

    // ── Refund Policy ─────────────────────────────────────────────────────

    const refundSections = [
        {
            title: '1. Coaching Plans',
            icon: '📋',
            content:
                `Once a coaching plan is activated, the payment is non-refundable.

This is because coaching includes personalized onboarding, plan preparation, guidance, and support that begins immediately upon activation.`,
        },
        {
            title: '2. Before Activation',
            icon: '⏳',
            content:
                `If payment is completed but onboarding or coaching has not started, refund requests may be reviewed case-by-case.

Approval is not guaranteed. Please reach out within 24 hours of payment if you wish to discuss this.`,
        },
        {
            title: '3. Missed Check-Ins',
            icon: '📅',
            content:
                `Missed check-ins, lack of response, lack of consistency, or non-adherence to the plan will not qualify for a refund.

Your plan remains active throughout the purchased duration regardless of engagement level.`,
        },
        {
            title:
                '4. Personal Training Sessions',
            icon: '🏋️',
            content:
                `For personal training, cancellations or rescheduling must be informed in advance.

Uninformed missed sessions may be counted as completed. Please give at least 4 hours notice to reschedule a session.`,
        },
        {
            title: '5. Medical Emergency',
            icon: '🏥',
            content:
                `In case of genuine medical emergencies, plan pause or extension may be considered after review.

Documentation may be required. Please contact us immediately via WhatsApp or email.`,
        },
        {
            title:
                '6. Contact for Refund Queries',
            icon: '✉️',
            content:
                `For refund or cancellation questions, contact:

Email: Fitwithsudarshanofficial@gmail.com
WhatsApp: 9619708124

We aim to respond within 24–48 hours on business days.`,
        },
    ];

    // NOTE:
    // We don't currently have your complete Terms.jsx sections in the
    // supplied SiteData file, so this seeds a safe empty sections array.
    // Replace this with the existing Terms.jsx sections when ready.

    const termsSections = [];

    // ── legal_pages ───────────────────────────────────────────────────────

    await check(
        'legal_pages',
        supabase
            .from('legal_pages')
            .upsert(
                [
                    {
                        slug: 'terms',
                        title:
                            'Terms & Conditions',
                        last_updated:
                            'January 2025',
                        intro:
                            'Welcome to FitWithSudarshan and RECODE™.',
                        sections:
                            termsSections,
                    },
                    {
                        slug:
                            'privacy-policy',
                        title:
                            'Privacy Policy',
                        last_updated:
                            'January 2025',
                        intro:
                            'FitWithSudarshan respects your privacy. We collect information only to provide better coaching, communication, and service.',
                        sections:
                            privacySections,
                    },
                    {
                        slug:
                            'refund-policy',
                        title:
                            'Refund & Cancellation Policy',
                        last_updated:
                            'January 2025',
                        intro:
                            'At FitWithSudarshan / RECODE™, every coaching plan involves time, review, planning, and personalized guidance. Please read this policy carefully before enrolling.',
                        sections:
                            refundSections,
                    },
                ],
                {
                    onConflict: 'slug',
                }
            )
    );

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Seed complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

seed().catch((error) => {
    console.error('');
    console.error('❌ Seed failed');
    console.error(error);
    process.exit(1);
});