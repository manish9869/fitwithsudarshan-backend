/**
 * src/services/pdfAttachmentService.js
 *
 * Fetches a PDF from a public URL and returns it as a nodemailer attachment
 * object. Never throws — a missing/broken URL just means "send without the
 * attachment" rather than failing the whole email.
 */
import logger from '../config/logger.js';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB safety cap

// Default Comeback Blueprint PDF — used whenever no per-send `pdfUrl` and no
// RESOURCE_VAULT_PDF_URL env var is provided.
export const DEFAULT_RESOURCE_VAULT_PDF_URL =
    'https://vducmiggraxtqdgt.public.blob.vercel-storage.com/RECODE%E2%84%A2%20COMEBACK%20BLUEPRINT.pdf';

// Hosts this server is allowed to fetch PDFs from. `fetchPdfAttachment` does
// a raw fetch() with no other restriction, so an unrestricted `url` (e.g. an
// admin-editable pdfUrl override) would let the caller make this server
// fetch arbitrary internal/external URLs (SSRF) and have the response
// emailed out as an attachment. Only the storage host this app actually
// uses is allowed; anything else is rejected rather than fetched.
const ALLOWED_PDF_HOSTS = ['vducmiggraxtqdgt.public.blob.vercel-storage.com'];

export function isAllowedPdfUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && ALLOWED_PDF_HOSTS.includes(parsed.hostname);
    } catch {
        return false;
    }
}

export async function fetchPdfAttachment(url, filename = 'RECODE-Comeback-Blueprint.pdf') {
    if (!url || !isAllowedPdfUrl(url)) return null;

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