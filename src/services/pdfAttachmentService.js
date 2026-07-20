/**
 * src/services/pdfAttachmentService.js
 *
 * Fetches a PDF from a public URL (e.g. a Google Drive direct-download
 * link, Vercel Blob URL, etc.) and returns it as a nodemailer attachment
 * object. Used by the resource_vault email so the actual file doesn't need
 * to live in this repo — just point it at wherever the PDF is hosted.
 *
 * Never throws: a missing/broken URL just means "send without the
 * attachment" rather than failing the whole email.
 */
import logger from '../config/logger.js';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB safety cap

export async function fetchPdfAttachment(url, filename = 'RECODE-Comeback-Blueprint.pdf') {
    if (!url) return null;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            logger.warn(`[pdfAttachment] Fetch failed (${res.status}) for ${url}`);
            return null;
        }

        const contentType = res.headers.get('content-type') || '';
        const contentLength = Number(res.headers.get('content-length') || 0);
        if (contentLength && contentLength > MAX_PDF_BYTES) {
            logger.warn(`[pdfAttachment] File too large (${contentLength} bytes) — skipping attachment.`);
            return null;
        }

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > MAX_PDF_BYTES) {
            logger.warn(`[pdfAttachment] File too large (${buffer.length} bytes) — skipping attachment.`);
            return null;
        }

        return {
            filename,
            content: buffer,
            contentType: contentType.includes('pdf') ? contentType : 'application/pdf',
        };
    } catch (err) {
        logger.warn(`[pdfAttachment] Could not fetch ${url}: ${err.message}`);
        return null;
    }
}