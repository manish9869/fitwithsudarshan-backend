/**
 * Regression test for the SSRF fix: fetchPdfAttachment() used to fetch
 * whatever URL it was given. If that URL were ever attacker-influenced
 * (e.g. an admin-editable "pdfUrl" field), the server could be made to
 * fetch arbitrary internal/external URLs and email the response out as an
 * attachment. It's now restricted to the one storage host this app uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPdfAttachment, isAllowedPdfUrl, DEFAULT_RESOURCE_VAULT_PDF_URL } from '../../src/services/pdfAttachmentService.js';

describe('isAllowedPdfUrl', () => {
    it('allows the real storage host over https', () => {
        expect(isAllowedPdfUrl(DEFAULT_RESOURCE_VAULT_PDF_URL)).toBe(true);
    });

    it('rejects an arbitrary external host', () => {
        expect(isAllowedPdfUrl('https://evil.example.com/payload.pdf')).toBe(false);
    });

    it('rejects a cloud metadata / internal-network SSRF target', () => {
        expect(isAllowedPdfUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
        expect(isAllowedPdfUrl('http://localhost:8080/admin')).toBe(false);
        expect(isAllowedPdfUrl('http://127.0.0.1/')).toBe(false);
    });

    it('rejects the right host over plain http (not just wrong host)', () => {
        const httpVersion = DEFAULT_RESOURCE_VAULT_PDF_URL.replace('https://', 'http://');
        expect(isAllowedPdfUrl(httpVersion)).toBe(false);
    });

    it('rejects a non-URL string instead of throwing', () => {
        expect(isAllowedPdfUrl('not a url')).toBe(false);
        expect(isAllowedPdfUrl('')).toBe(false);
    });

    it('rejects a lookalike host (prefix/suffix trick)', () => {
        expect(isAllowedPdfUrl('https://vducmiggraxtqdgt.public.blob.vercel-storage.com.evil.com/x.pdf')).toBe(false);
        expect(isAllowedPdfUrl('https://evilvducmiggraxtqdgt.public.blob.vercel-storage.com/x.pdf')).toBe(false);
    });
});

describe('fetchPdfAttachment', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    it('never calls fetch() at all for a disallowed URL', async () => {
        const result = await fetchPdfAttachment('https://evil.example.com/payload.pdf');
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fetches and returns an attachment for an allowed URL', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            headers: { get: (k) => ({ 'content-type': 'application/pdf', 'content-length': '3' }[k]) },
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        });

        const result = await fetchPdfAttachment(DEFAULT_RESOURCE_VAULT_PDF_URL, 'test.pdf');
        expect(result).not.toBeNull();
        expect(result.filename).toBe('test.pdf');
        expect(global.fetch).toHaveBeenCalledWith(DEFAULT_RESOURCE_VAULT_PDF_URL);
    });
});
