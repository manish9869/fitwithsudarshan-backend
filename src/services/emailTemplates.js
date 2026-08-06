/**
 * src/services/emailTemplates.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

const _templateCache = new Map();

function readTemplate(name) {
    if (_templateCache.has(name)) return _templateCache.get(name);

    const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Template file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    _templateCache.set(name, content);
    return content;
}

const KNOWN_TEMPLATES = [
    'enrollment_coach', 'enrollment_customer', 'welcome',
    'enrollment_extended_coach', 'enrollment_extended_customer',
    'payment_failed', 'payment_reminder',
    'contact_inquiry_coach', 'contact_inquiry_customer',
    'assessment_coach', 'assessment_customer', 'balance_due_reminder',
    'resource_vault', 'payment_receipt_email',
];
for (const name of KNOWN_TEMPLATES) {
    try { readTemplate(name); } catch { /* not fatal at boot */ }
}

// Default Comeback Blueprint Drive link — pass `driveLink` per-send to override.
const DEFAULT_RESOURCE_VAULT_LINK =
    'https://drive.google.com/drive/folders/1RqwkO6Z5HADSoD86rkVFRiaDgB0Ro1RO?usp=drive_link';

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


function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inject(html, data) {
    html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, block) => {
        const elseSplit = block.match(/^([\s\S]*?)\{\{else\}\}([\s\S]*)$/);
        if (elseSplit) {
            const [, truthyBlock, falsyBlock] = elseSplit;
            return data[key] ? truthyBlock : falsyBlock;
        }
        return data[key] ? block : '';
    });

    html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = data[key];
        if (val === undefined || val === null) return '—';
        if (typeof val === 'boolean') return val ? 'Yes' : 'No';
        return escapeHtml(val);
    });

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

    enrollment_extended_coach(d) {
        const subject = `🎉 Plan Extended — ${d.customerName} · ${d.enrollmentId}`;
        const couponSavingsFormatted = d.couponSavings > 0 ? fmt(d.couponSavings) : '';
        const html = inject(readTemplate('enrollment_extended_coach'), {
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
            razorpayPaymentId: d.razorpayPaymentId || '—',
            paymentDate: fmtDate(d.paymentDate),
        });
        return { subject, html };
    },

    enrollment_extended_customer(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const durationLabel = d.durationMonths ? `${d.durationMonths} Month${d.durationMonths > 1 ? 's' : ''}` : 'more time';
        const subject = `🎉 Your RECODE™ plan has been extended — ${durationLabel} added`;
        const couponSavingsFormatted = d.couponSavings > 0 ? fmt(d.couponSavings) : '';
        const html = inject(readTemplate('enrollment_extended_customer'), {
            firstName,
            programName: d.programName || '—',
            durationLabel,
            planTypeLabel: d.planType === 'couple' ? 'Couple Plan' : 'Individual',
            enrollmentId: d.enrollmentId || '—',
            amountFormatted: fmt(d.amountPaid),
            originalAmount: fmt(d.originalAmount || d.amountPaid),
            couponCode: d.couponCode || '',
            couponSavings: couponSavingsFormatted,
            hasCoupon: !!(d.couponCode && d.couponSavings > 0),
            paymentDate: fmtDate(d.paymentDate),
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
        const photosMissing = !d.photo_front_path || !d.photo_side_path;
        const uploadPhotosUrl = (photosMissing && config.publicSiteUrl && d.photo_upload_token)
            ? `${config.publicSiteUrl}/upload-photos/${d.photo_upload_token}`
            : '';
        const html = inject(readTemplate('assessment_customer'), {
            first_name: firstName,
            plan: d.plan || '—',
            main_goal: d.main_goal || '—',
            uploadPhotosUrl,
        });
        return { subject, html };
    },

    balance_due_reminder(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const totalAmt = Number(d.totalAmount || 0);
        const paidAmt = Number(d.amountPaid || 0);
        const paidPercent = totalAmt > 0
            ? Math.min(100, Math.max(0, Math.round((paidAmt / totalAmt) * 100)))
            : 0;

        const subject = `💳 Balance due — ${fmt(d.balanceDue)} remaining on your RECODE™ plan`;
        const html = inject(readTemplate('balance_due_reminder'), {
            firstName,
            programName: d.programName || '—',
            durationLabel: d.durationMonths ? `${d.durationMonths} Month${Number(d.durationMonths) > 1 ? 's' : ''}` : '—',
            totalAmountFormatted: fmt(d.totalAmount),
            amountPaidFormatted: fmt(d.amountPaid),
            balanceDueFormatted: fmt(d.balanceDue),
            paidPercent: String(paidPercent),
            enrollmentId: d.enrollmentId || '—',
        });
        return { subject, html };
    },

    payment_receipt_email(d) {
        const firstName = (d.customerName || 'there').split(' ')[0];
        const totalAmt = Number(d.totalAmount || 0);
        const paidAmt = Number(d.paidToDate ?? d.amountPaid ?? 0);
        const paidPercent = totalAmt > 0
            ? Math.min(100, Math.max(0, Math.round((paidAmt / totalAmt) * 100)))
            : 100;
        const balanceDue = Number(d.balanceDue || 0);
        const isFullyPaid = balanceDue <= 0;

        const subject = isFullyPaid
            ? `✅ Payment Received — You're fully paid up on RECODE™!`
            : `✅ Payment Received — ${fmt(d.amountPaid)} towards your RECODE™ plan`;

        const html = inject(readTemplate('payment_receipt_email'), {
            firstName,
            programName: d.programName || '—',
            amountPaidFormatted: fmt(d.amountPaid),
            paidToDateFormatted: fmt(d.paidToDate),
            totalAmountFormatted: fmt(d.totalAmount),
            balanceDueFormatted: fmt(d.balanceDue),
            paidPercent: String(paidPercent),
            paymentDate: fmtDate(d.paymentDate),
            reference: d.reference || '—',
            enrollmentId: d.enrollmentId || '—',
            isFullyPaid,
        });
        return { subject, html };
    },

    // ── Comeback Blueprint / resource vault delivery email ──
    resource_vault(d) {
        const firstName = (d.customerName || d.firstName || 'there').toString().split(' ')[0];
        const subject = `📚 Your RECODE™ Comeback Blueprint is ready, ${firstName}!`;
        const html = inject(readTemplate('resource_vault'), {
            firstName,
            driveLink: d.driveLink || DEFAULT_RESOURCE_VAULT_LINK,
            hasAttachment: !!d.hasAttachment,
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