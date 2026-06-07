/**
 * src/services/emailTemplates.js
 *
 * Reads HTML files from src/templates/, injects data via {{placeholder}}
 * replacement, and returns { subject, html }.
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
 * Replace all {{key}} tokens in html with values from the data object.
 * Unknown keys are replaced with '—'.
 * Also handles simple block conditionals: {{#if key}}...{{/if}}
 */
function inject(html, data) {
    // Handle {{#if key}}...{{/if}} blocks
    html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
        return data[key] ? inner : '';
    });
    // Replace {{key}} tokens
    return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = data[key];
        return val !== undefined && val !== null ? String(val) : '—';
    });
}

// ── Template definitions ──────────────────────────────────────────────────────
// Each entry maps a template name → (data) => { subject, html }

const templateBuilders = {

    enrollment_coach(d) {
        const subject = `🎉 New Enrollment — ${d.customerName} · ${d.enrollmentId}`;
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
            razorpayPaymentId: d.razorpayPaymentId || '—',
            razorpayOrderId: d.razorpayOrderId || '—',
            paymentDate: fmtDate(d.paymentDate),
        });
        return { subject, html };
    },

    enrollment_customer(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `✅ You're enrolled in RECODE™ — ${d.programName}`;
        const html = inject(readTemplate('enrollment_customer'), {
            firstName,
            programName: d.programName || '—',
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : '—',
            planTypeLabel: d.planType === 'couple' ? 'Couple Plan' : 'Individual',
            enrollmentId: d.enrollmentId || '—',
            amountFormatted: fmt(d.amountPaid),
            paymentDate: fmtDate(d.paymentDate),
            razorpayPaymentId: d.razorpayPaymentId || '—',
        });
        return { subject, html };
    },

    welcome(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `🚀 Your RECODE™ Journey Officially Begins — Welcome, ${firstName}!`;
        const html = inject(readTemplate('welcome'), { firstName });
        return { subject, html };
    },

    payment_failed(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const subject = `⚠️ Payment Unsuccessful — RECODE™ Enrollment`;
        const html = inject(readTemplate('payment_failed'), {
            firstName,
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
};

// ── Public API ────────────────────────────────────────────────────────────────

export const TEMPLATE_NAMES = Object.keys(templateBuilders);

/**
 * Render a template by name.
 * @param {string} templateName
 * @param {object} data
 * @returns {{ subject: string, html: string }}
 */
export function renderTemplate(templateName, data) {
    const builder = templateBuilders[templateName];
    if (!builder) {
        throw new Error(
            `Unknown email template: "${templateName}". Available: ${TEMPLATE_NAMES.join(', ')}`
        );
    }
    return builder(data);
}