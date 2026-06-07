import { jsPDF } from 'jspdf';

function fmt(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(amount);
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
    }).format(d);
}

export function generateInvoiceBuffer(enrollment) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297;
    const ML = 16, MR = 16;
    const CW = PW - ML - MR;

    // Colors
    const BRAND = [231, 23, 99];
    const BG = [10, 10, 14];
    const CARD = [18, 18, 24];
    const CARD2 = [24, 24, 32];
    const BORDER = [42, 42, 56];
    const WHITE = [255, 255, 255];
    const GREY60 = [153, 153, 168];
    const GREY35 = [90, 90, 105];
    const GREEN = [52, 211, 153];
    const GREEN_BG = [18, 52, 38];

    const tc = (c) => doc.setTextColor(...c);
    const fc = (c) => doc.setFillColor(...c);
    const dc = (c) => doc.setDrawColor(...c);

    // Background
    fc(BG); doc.rect(0, 0, PW, PH, 'F');

    // Header
    const HDR_H = 62;
    fc(CARD); doc.rect(0, 0, PW, HDR_H, 'F');
    fc(BRAND); doc.rect(0, 0, PW, 3, 'F');

    // Brand name
    const BX = ML + 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    tc(WHITE);
    const fw = doc.getTextWidth('FitWith');
    doc.text('FitWith', BX, 30);
    tc(BRAND);
    doc.text('Sudarshan', BX + fw, 30);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    tc(GREY35);
    doc.text('your transformation coach', BX, 37);

    // INVOICE title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(28);
    tc(WHITE);
    doc.text('INVOICE', PW - MR, 30, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    tc(GREY35);
    doc.text(`No.  ${enrollment.enrollmentId || '—'}`, PW - MR, 37.5, { align: 'right' });

    // PAID badge
    const BADGE_W = 34, BADGE_H = 10;
    const BADGE_X = PW - MR - BADGE_W;
    const BADGE_Y = HDR_H - BADGE_H - 8;
    fc(GREEN_BG); doc.roundedRect(BADGE_X, BADGE_Y, BADGE_W, BADGE_H, 2, 2, 'F');
    dc(GREEN); doc.setLineWidth(0.5);
    doc.roundedRect(BADGE_X, BADGE_Y, BADGE_W, BADGE_H, 2, 2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    tc(GREEN);
    doc.text('PAID', BADGE_X + BADGE_W / 2, BADGE_Y + BADGE_H / 2 + 2.8, { align: 'center' });

    fc(BRAND); doc.rect(0, HDR_H, PW, 2.5, 'F');

    // FROM / BILL TO / DATE
    let y = HDR_H + 2.5 + 12;
    const COL1 = ML;
    const COL2 = ML + CW * 0.38;
    const COL3 = ML + CW * 0.68;

    const sectionLabel = (x, yy, text) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        tc(BRAND); doc.text(text, x, yy);
    };
    const bodyLine = (x, yy, text, bold = false, color = GREY60) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(bold ? 9 : 7.8);
        tc(bold ? WHITE : color);
        doc.text(String(text || '—'), x, yy);
    };

    sectionLabel(COL1, y, 'FROM');
    bodyLine(COL1, y + 6, 'FitWithSudarshan', true);
    bodyLine(COL1, y + 12, 'RECODE™ Transformation Program');
    bodyLine(COL1, y + 17, 'Mumbai, Maharashtra, India');
    bodyLine(COL1, y + 22, 'Fitwithsudarshanofficial@gmail.com');
    bodyLine(COL1, y + 27, '+91 96197 08124');

    sectionLabel(COL2, y, 'BILL TO');
    bodyLine(COL2, y + 6, enrollment.customerName, true);
    bodyLine(COL2, y + 12, enrollment.customerEmail);
    bodyLine(COL2, y + 17, enrollment.customerPhone || '');

    sectionLabel(COL3, y, 'INVOICE DATE');
    bodyLine(COL3, y + 6, fmtDate(enrollment.paymentDate), true);
    sectionLabel(COL3, y + 14, 'PAYMENT STATUS');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    tc(GREEN);
    doc.text('VERIFIED & PAID', COL3, y + 20);

    y += 36;
    dc(BORDER); doc.setLineWidth(0.2);
    doc.line(ML, y, PW - MR, y);
    y += 8;

    // Reference IDs
    const REF_H = 18;
    fc(CARD); doc.roundedRect(ML, y, CW, REF_H, 2.5, 2.5, 'F');
    dc(BORDER); doc.setLineWidth(0.18);
    doc.roundedRect(ML, y, CW, REF_H, 2.5, 2.5, 'S');
    const C1W = CW / 3;
    doc.line(ML + C1W, y + 3, ML + C1W, y + REF_H - 3);
    doc.line(ML + C1W * 2, y + 3, ML + C1W * 2, y + REF_H - 3);

    const refCell = (cx, label, value) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        tc(GREY35); doc.text(label, cx, y + 7);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        tc(WHITE); doc.text(String(value || '—'), cx, y + 13);
    };
    refCell(ML + 5, 'ENROLLMENT ID', enrollment.enrollmentId || '—');
    refCell(ML + C1W + 5, 'PAYMENT ID', enrollment.razorpayPaymentId || '—');
    refCell(ML + C1W * 2 + 5, 'ORDER ID', enrollment.razorpayOrderId || '—');
    y += REF_H + 8;

    // Line items table
    const TBL_X = ML, TBL_W = CW;
    const C_DESC = TBL_X + 5;
    const C_TYPE = TBL_X + 100;
    const C_DUR = TBL_X + 130;
    const C_AMT = TBL_X + TBL_W - 5;
    const TH = 10;

    fc(BRAND); doc.rect(TBL_X, y, TBL_W, TH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    tc(WHITE);
    doc.text('DESCRIPTION', C_DESC, y + 6.8);
    doc.text('TYPE', C_TYPE, y + 6.8);
    doc.text('DURATION', C_DUR, y + 6.8);
    doc.text('AMOUNT', C_AMT, y + 6.8, { align: 'right' });
    y += TH;

    const TR = 16;
    fc(CARD2); doc.rect(TBL_X, y, TBL_W, TR, 'F');
    dc(BORDER); doc.setLineWidth(0.18);
    doc.rect(TBL_X, y, TBL_W, TR, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    tc(WHITE);
    doc.text('RECODE™ Coaching Plan', C_DESC, y + TR / 2 + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    tc(GREY60);
    doc.text(enrollment.coachingType || 'Online', C_TYPE, y + TR / 2 + 3);
    doc.text(
        enrollment.durationMonths
            ? `${enrollment.durationMonths} Month${enrollment.durationMonths > 1 ? 's' : ''}`
            : '—',
        C_DUR, y + TR / 2 + 3,
    );
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    tc(WHITE);
    doc.text(fmt(enrollment.amountPaid), C_AMT, y + TR / 2 + 3, { align: 'right' });
    y += TR + 6;

    // Totals
    const TOT_W = 90;
    const TOT_X = TBL_X + TBL_W - TOT_W;
    const LAB_X = TOT_X + 6;
    const VAL_X = TOT_X + TOT_W - 6;

    fc(CARD); doc.rect(TOT_X, y, TOT_W, 9, 'F');
    dc(BORDER); doc.setLineWidth(0.15);
    doc.rect(TOT_X, y, TOT_W, 9, 'S');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); tc(GREY60);
    doc.text('Subtotal', LAB_X, y + 5.8);
    tc(WHITE); doc.text(fmt(enrollment.amountPaid), VAL_X, y + 5.8, { align: 'right' });
    y += 9;

    fc(CARD2); doc.rect(TOT_X, y, TOT_W, 9, 'F');
    dc(BORDER); doc.rect(TOT_X, y, TOT_W, 9, 'S');
    tc(GREY60); doc.text('GST / Tax', LAB_X, y + 5.8);
    doc.text('Included', VAL_X, y + 5.8, { align: 'right' });
    y += 9;

    const TOT_ROW_H = 14;
    fc(BRAND); doc.rect(TOT_X, y, TOT_W, TOT_ROW_H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); tc(WHITE);
    doc.text('TOTAL PAID', LAB_X, y + TOT_ROW_H / 2 + 2.5);
    doc.setFontSize(10);
    doc.text(fmt(enrollment.amountPaid), VAL_X, y + TOT_ROW_H / 2 + 2.5, { align: 'right' });
    y += TOT_ROW_H + 10;

    // What happens next
    const NEXT_H = 52;
    fc(CARD); doc.roundedRect(ML, y, CW, NEXT_H, 3, 3, 'F');
    fc(BRAND); doc.roundedRect(ML, y, 4, NEXT_H, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    tc(BRAND);
    doc.text('WHAT HAPPENS NEXT', ML + 10, y + 9);
    const steps = [
        '1   Our coaching team reviews your enrollment details within 24 hours.',
        '2   Onboarding instructions sent via WhatsApp & email.',
        '3   Sudarshan crafts your personalised RECODE™ workout & nutrition plan.',
        '4   Begin your recovery-based transformation with full coach support!',
    ];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    tc(GREY60);
    steps.forEach((s, i) => doc.text(s, ML + 10, y + 17 + i * 8));
    y += NEXT_H + 6;

    // Footer
    const FY = PH - 20;
    fc(CARD); doc.rect(0, FY, PW, 20, 'F');
    fc(BRAND); doc.rect(0, FY, PW, 1.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    tc(GREY60);
    doc.text(
        'FitWithSudarshan  ·  Fitwithsudarshanofficial@gmail.com  ·  +91 96197 08124  ·  Mumbai, India',
        PW / 2, FY + 8, { align: 'center' },
    );
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
    tc(GREY35);
    doc.text(
        'This is a computer-generated invoice and does not require a physical signature.',
        PW / 2, FY + 14, { align: 'center' },
    );

    // Return as Buffer (Node.js compatible)
    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
}