import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser } from './puppeteerBrowser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRAND_LOGO_URL =
    'https://vducmiggraxtqdgt.public.blob.vercel-storage.com/Black-bg%20Logo.jpeg';

function fmt(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(Number(amount || 0));
}

function fmtDate(iso) {
    if (!iso) return '—';

    const d = new Date(iso);

    return isNaN(d)
        ? '—'
        : new Intl.DateTimeFormat('en-IN', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
              timeZone: 'Asia/Kolkata',
          }).format(d);
}

function escapeHtml(value) {
    return String(value ?? '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function replaceTemplateValues(template, values) {
    return Object.entries(values).reduce((html, [key, value]) => {
        return html.replaceAll(`{{${key}}}`, value ?? '');
    }, template);
}

async function readInvoiceTemplate() {
    const templatePath = path.resolve(__dirname, '../templates/invoice.html');
    return fs.readFile(templatePath, 'utf8');
}

function buildInvoiceTemplateData(enrollment = {}) {
    const amountPaid = Number(
        enrollment.amountPaid ||
        enrollment.amount_paid ||
        0
    );

    const couponSavings = Number(
        enrollment.couponSavings ||
        enrollment.coupon_savings ||
        0
    );

    const couponCode =
        enrollment.couponCode ||
        enrollment.coupon_code ||
        '';

    const hasCoupon = Boolean(couponCode && couponSavings > 0);

    const originalAmount = Number(
        enrollment.originalAmount ||
        enrollment.original_amount ||
        amountPaid + couponSavings ||
        amountPaid
    );

    const durationMonths = Number(
        enrollment.durationMonths ||
        enrollment.duration_months ||
        0
    );

    const durationText = durationMonths
        ? `${durationMonths} Month${durationMonths > 1 ? 's' : ''}`
        : '—';

    const discountTableRow = hasCoupon
        ? `
            <tr class="discount-row">
                <td colspan="3">
                    <span class="discount-label">Discount Applied</span>
                    <span class="discount-code"> · Coupon: ${escapeHtml(couponCode)}</span>
                </td>
                <td>
                    <span class="discount-amount">-${fmt(couponSavings)}</span>
                </td>
            </tr>
        `
        : '';

    const originalAmountLine = hasCoupon
        ? `<span class="amount-original">${fmt(originalAmount)}</span>`
        : '';

    const summaryRows = hasCoupon
        ? `
            <div class="summary-row">
                <span>Original Price</span>
                <strong style="text-decoration: line-through; color: #9ca3af;">
                    ${fmt(originalAmount)}
                </strong>
            </div>

            <div class="summary-row discount">
                <span>Discount (${escapeHtml(couponCode)})</span>
                <strong>-${fmt(couponSavings)}</strong>
            </div>

            <div class="summary-row net">
                <span>Net Amount</span>
                <strong>${fmt(amountPaid)}</strong>
            </div>
        `
        : `
            <div class="summary-row net">
                <span>Net Amount</span>
                <strong>${fmt(amountPaid)}</strong>
            </div>
        `;

    return {
        logoUrl: BRAND_LOGO_URL,

        invoiceNumber: escapeHtml(
            enrollment.enrollmentId ||
            enrollment.enrollment_id ||
            '—'
        ),

        enrollmentId: escapeHtml(
            enrollment.enrollmentId ||
            enrollment.enrollment_id ||
            '—'
        ),

        razorpayPaymentId: escapeHtml(
            enrollment.razorpayPaymentId ||
            enrollment.razorpay_payment_id ||
            '—'
        ),

        razorpayOrderId: escapeHtml(
            enrollment.razorpayOrderId ||
            enrollment.razorpay_order_id ||
            '—'
        ),

        customerName: escapeHtml(
            enrollment.customerName ||
            enrollment.customer_name ||
            '—'
        ),

        customerEmail: escapeHtml(
            enrollment.customerEmail ||
            enrollment.customer_email ||
            '—'
        ),

        customerPhone: escapeHtml(
            enrollment.customerPhone ||
            enrollment.customer_phone ||
            '—'
        ),

        invoiceDate: escapeHtml(
            fmtDate(enrollment.paymentDate || enrollment.payment_date)
        ),

        coachingType: escapeHtml(
            enrollment.coachingType ||
            enrollment.coaching_type ||
            'Online'
        ),

        durationText: escapeHtml(durationText),

        amountPaid: escapeHtml(fmt(amountPaid)),

        originalAmountLine,
        discountTableRow,
        summaryRows,
    };
}

export async function buildInvoiceHtml(enrollment) {
    const template = await readInvoiceTemplate();
    const data = buildInvoiceTemplateData(enrollment);

    return replaceTemplateValues(template, data);
}

export async function generateInvoiceBuffer(enrollment) {
    let browser;

    try {
        const html = await buildInvoiceHtml(enrollment);

        browser = await launchBrowser();

        const page = await browser.newPage();

        await page.setContent(html, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            margin: {
                top: '0mm',
                right: '0mm',
                bottom: '0mm',
                left: '0mm',
            },
        });

        return Buffer.from(pdfBuffer);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}