/**
 * src/services/paymentReceiptService.js
 *
 * Generates a PDF receipt for a SINGLE payment/installment on an
 * enrollment — used when a client pays in parts (deposit + balance,
 * multiple UPI transfers, etc). Reuses the exact same invoice.html
 * template as the full invoice, but the numbers reflect just this one
 * payment plus a running balance summary (total price / paid to date /
 * balance remaining) instead of the enrollment's grand total.
 */
import { withPage } from './puppeteerBrowser.js';
import {
    readInvoiceTemplate,
    replaceTemplateValues,
    fmt,
    fmtDate,
    escapeHtml,
} from './invoiceService.js';

const METHOD_LABELS = {
    razorpay: 'Razorpay (Website)',
    razorpay_link: 'Razorpay Link',
    upi: 'UPI',
    bank_transfer: 'Bank Transfer',
    cash: 'Cash',
    other: 'Other',
};

function methodLabel(m) {
    return METHOD_LABELS[m] || 'Other';
}

function buildPaymentReceiptTemplateData(enrollment = {}, payment = {}, paidToDate) {
    const totalAmount = Number(
        enrollment.totalAmount ?? enrollment.total_amount ??
        enrollment.amountPaid ?? enrollment.amount_paid ?? 0
    );
    const thisPaymentAmount = Number(payment.amount || 0);

    // Falls back to the enrollment's current amount_paid if no running
    // total was supplied (correct when this is the only/latest payment).
    const paidSoFar = paidToDate != null
        ? Number(paidToDate)
        : Number(enrollment.amountPaid ?? enrollment.amount_paid ?? thisPaymentAmount);
    const balanceDue = Math.max(0, totalAmount - paidSoFar);

    const durationMonths = Number(enrollment.durationMonths || enrollment.duration_months || 0);
    const durationText = durationMonths
        ? `${durationMonths} Month${durationMonths > 1 ? 's' : ''}` : '—';

    const paymentRef = payment.reference || payment.razorpay_payment_id || '—';
    const paymentMethodLabel = methodLabel(payment.method);

    const discountTableRow = `
        <tr class="discount-row">
            <td colspan="3">
                <span class="discount-label">Payment Method</span>
                <span class="discount-code"> · ${escapeHtml(paymentMethodLabel)}${payment.reference ? ` · Ref: ${escapeHtml(payment.reference)}` : ''
        }</span>
            </td>
            <td><span class="discount-amount" style="color:#111827;">${fmt(thisPaymentAmount)}</span></td>
        </tr>`;

    const summaryRows = `
        <div class="summary-row">
            <span>Total Program Price</span>
            <strong>${fmt(totalAmount)}</strong>
        </div>
        <div class="summary-row discount">
            <span>Paid to Date</span>
            <strong style="color:#047857;">${fmt(paidSoFar)}</strong>
        </div>
        <div class="summary-row net">
            <span>${balanceDue > 0 ? 'Balance Remaining' : 'Fully Paid'}</span>
            <strong>${fmt(balanceDue)}</strong>
        </div>`;

    const shortPaymentId = payment.id ? String(payment.id).replace(/-/g, '').slice(0, 6).toUpperCase() : 'X';

    return {
        logoUrl: 'https://vducmiggraxtqdgt.public.blob.vercel-storage.com/Black-bg%20Logo.jpeg',
        invoiceNumber: escapeHtml(`${enrollment.enrollmentId || enrollment.enrollment_id || '—'}-P${shortPaymentId}`),
        enrollmentId: escapeHtml(enrollment.enrollmentId || enrollment.enrollment_id || '—'),
        razorpayPaymentId: escapeHtml(paymentRef),
        razorpayOrderId: escapeHtml(enrollment.razorpayOrderId || enrollment.razorpay_order_id || '—'),
        customerName: escapeHtml(enrollment.customerName || enrollment.customer_name || '—'),
        customerEmail: escapeHtml(enrollment.customerEmail || enrollment.customer_email || '—'),
        customerPhone: escapeHtml(enrollment.customerPhone || enrollment.customer_phone || '—'),
        invoiceDate: escapeHtml(fmtDate(payment.paid_at || payment.paidAt)),
        coachingType: escapeHtml(enrollment.coachingType || enrollment.coaching_type || 'Online'),
        durationText: escapeHtml(durationText),
        amountPaid: escapeHtml(fmt(thisPaymentAmount)),
        originalAmountLine: '',
        discountTableRow,
        summaryRows,
    };
}

export async function buildPaymentReceiptHtml(enrollment, payment, paidToDate) {
    const template = await readInvoiceTemplate();
    let html = replaceTemplateValues(
        template,
        buildPaymentReceiptTemplateData(enrollment, payment, paidToDate)
    );

    // Relabel a couple of static strings so it reads as a receipt for one
    // installment rather than a full-amount invoice.
    html = html
        .replace('<h1 class="invoice-title">INVOICE</h1>', '<h1 class="invoice-title">RECEIPT</h1>')
        .replace('<span>Amount Paid</span>', '<span>This Payment</span>');

    return html;
}

export async function generatePaymentReceiptBuffer(enrollment, payment, paidToDate) {
    const html = await buildPaymentReceiptHtml(enrollment, payment, paidToDate);

    return withPage(async (page) => {
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        });

        return Buffer.from(pdfBuffer);
    });
}