/**
 * FIXED: inject() now properly returns the processed HTML
 * and handles {{placeholder}} token replacement.
 *
 * Replace your src/services/emailTemplates.js with this file.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount) {
    if (!amount && amount !== 0) return '—';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(amount);
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
    }).format(d);
}

function readTemplate(name) {
    const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Template file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf-8');
}

/**
 * FIX: inject() was previously defined but never returned anything.
 * Now it:
 *   1. Handles {{#if key}}...{{/if}} and {{#if key}}...{{else}}...{{/if}} blocks
 *   2. Replaces all {{key}} tokens with values from data
 *   3. Returns the fully processed HTML string
 */
function inject(html, data) {
    // 1. Handle {{#if key}}...{{else}}...{{/if}} and {{#if key}}...{{/if}} blocks
    html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, block) => {
        const elseSplit = block.match(/^([\s\S]*?)\{\{else\}\}([\s\S]*)$/);
        if (elseSplit) {
            const [, truthyBlock, falsyBlock] = elseSplit;
            return data[key] ? truthyBlock : falsyBlock;
        }
        return data[key] ? block : '';
    });

    // 2. Replace all {{key}} tokens — unknown keys fall back to '—'
    html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = data[key];
        if (val === undefined || val === null) return '—';
        if (typeof val === 'boolean') return val ? 'Yes' : 'No';
        return String(val);
    });

    // 3. ✅ RETURN the processed HTML (this was missing before)
    return html;
}

function formatGoals(goals) {
    return Array.isArray(goals) && goals.length ? goals.join(', ') : '—';
}

// ── Template definitions ──────────────────────────────────────────────────────

const templateBuilders = {

    enrollment_coach(d) {
        const subject = `🎉 New Enrollment — ${d.customerName} · ${d.enrollmentId}`;
        const couponSavingsFormatted = d.couponSavings > 0 ? fmt(d.couponSavings) : '';
        const hasPartnerGoals = Array.isArray(d.partnerGoals) && d.partnerGoals.length > 0;
        const html = inject(readTemplate('enrollment_coach'), {
            customerName: d.customerName || '—',
            customerEmail: d.customerEmail || '—',
            customerPhone: d.customerPhone || '—',
            customerPhoneClean: (d.customerPhone || '').replace(/\D/g, ''),
            programName: d.programName || '—',
            coachingType: d.coachingType || '—',
            planTypeLabel: d.planType === 'couple' ? 'Couple' : 'Individual',
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : '—',
            enrollmentId: d.enrollmentId || '—',
            amountFormatted: fmt(d.amountPaid),
            originalAmount: fmt(d.originalAmount || d.amountPaid),
            couponCode: d.couponCode || '',
            couponSavings: couponSavingsFormatted,
            hasCoupon: !!(d.couponCode && d.couponSavings > 0),
            customerGoals: formatGoals(d.goals),
            partnerGoals: formatGoals(d.partnerGoals),
            hasPartnerGoals,
            razorpayPaymentId: d.razorpayPaymentId || '—',
            razorpayOrderId: d.razorpayOrderId || '—',
            paymentDate: fmtDate(d.paymentDate),
        });
        return { subject, html };
    },

    enrollment_customer(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `✅ You're enrolled in RECODE™ — ${d.programName}`;
        const couponSavingsFormatted = d.couponSavings > 0 ? fmt(d.couponSavings) : '';
        const html = inject(readTemplate('enrollment_customer'), {
            firstName,
            programName: d.programName || '—',
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : '—',
            planTypeLabel: d.planType === 'couple' ? 'Couple Plan' : 'Individual',
            enrollmentId: d.enrollmentId || '—',
            amountFormatted: fmt(d.amountPaid),
            originalAmount: fmt(d.originalAmount || d.amountPaid),
            couponCode: d.couponCode || '',
            couponSavings: couponSavingsFormatted,
            hasCoupon: !!(d.couponCode && d.couponSavings > 0),
            customerGoals: formatGoals(d.goals),
            paymentDate: fmtDate(d.paymentDate),
            razorpayPaymentId: d.razorpayPaymentId || '—',
        });
        return { subject, html };
    },

    welcome(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `🚀 Your RECODE™ Journey Officially Begins — Welcome, ${firstName}!`;
        const html = inject(readTemplate('welcome'), {
            firstName,
            programName: d.programName || '—',
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : '—',
            amountFormatted: fmt(d.amountPaid),
            paymentDate: fmtDate(d.paymentDate),
            customerGoals: formatGoals(d.goals),
        });
        return { subject, html };
    },

    payment_failed(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `⚠️ Payment Unsuccessful — RECODE™ Enrollment`;
        const html = inject(readTemplate('payment_failed'), {
            firstName,
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : '—',
            programName: d.programName || '',
        });
        return { subject, html };
    },

    payment_reminder(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `👋 Hey ${firstName} — your RECODE™ spot is still available`;
        const html = inject(readTemplate('payment_reminder'), {
            firstName,
            programName: d.programName || '',
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : '',
        });
        return { subject, html };
    },

    contact_inquiry_coach(d) {
        const subject = `📩 New Inquiry — ${d.name} · ${d.goal || 'General'}`;
        const html = inject(readTemplate('contact_inquiry_coach'), {
            name: d.name || '—',
            email: d.email || '—',
            phone: d.phone || '—',
            phoneClean: (d.phone || '').replace(/\D/g, ''),
            goal: d.goal || '—',
            message: d.message || '—',
        });
        return { subject, html };
    },

    contact_inquiry_customer(d) {
        const firstName = (d.name || 'there').split(' ')[0];
        const subject = `✅ Got your message, ${firstName}! — RECODE™`;
        const html = inject(readTemplate('contact_inquiry_customer'), {
            firstName,
            name: d.name || '—',
            email: d.email || '—',
            phone: d.phone || '—',
            goal: d.goal || '—',
            message: d.message || '—',
        });
        return { subject, html };
    },

    assessment_coach(d) {
        const subject = `📋 New Assessment — ${d.first_name || ''} ${d.last_name || ''}`.trim();
        const html = inject(readTemplate('assessment_coach'), {
            first_name: d.first_name || '—',
            last_name: d.last_name || '',
            whatsapp: d.whatsapp || '—',
            whatsappClean: (d.whatsapp || '').replace(/\D/g, ''),
            age: d.age || '—',
            gender: d.gender || '—',
            city: d.city || '—',
            plan: d.plan || '—',
            current_weight: d.current_weight || '—',
            height: d.height || '—',
            workout_status: d.workout_status || '—',
            training_days: d.training_days || '—',
            training_location: d.training_location || '—',
            profession: d.profession || '—',
            main_goal: d.main_goal || '—',
            desired_result: d.desired_result || '—',
            why_now: d.why_now || '—',
            food_preference: d.food_preference || '—',
            sleep_hours: d.sleep_hours || '—',
            daily_food_routine: d.daily_food_routine || '—',
            biggest_struggle: d.biggest_struggle || '—',
            medical_conditions: d.medical_conditions || 'None reported.',
            commitment: d.commitment ?? '—',
            photoFrontUrl: d.photoFrontUrl || '',
            photoSideUrl: d.photoSideUrl || '',
            bloodReportUrl: d.bloodReportUrl || '',
        });
        return { subject, html };
    },

    assessment_customer(d) {
        const firstName = d.first_name || 'there';
        const subject = `✅ Assessment received, ${firstName}! — RECODE™`;
        const html = inject(readTemplate('assessment_customer'), {
            first_name: firstName,
            plan: d.plan || '—',
            main_goal: d.main_goal || '—',
        });
        return { subject, html };
    },

};

// ── Public API ────────────────────────────────────────────────────────────────

export const TEMPLATE_NAMES = Object.keys(templateBuilders);

export function renderTemplate(templateName, data) {
    const builder = templateBuilders[templateName];
    if (!builder) {
        throw new Error(
            `Unknown email template: "${templateName}". Available: ${TEMPLATE_NAMES.join(', ')}`
        );
    }
    return builder(data);
}