const PDF_RUNTIME = process.env.PDF_RUNTIME || 'local';

// ── Singleton browser — reused across warm invocations on the same instance ──
// On Vercel each function instance is isolated, so this won't cross requests
// in production, but it DOES help when multiple PDFs are generated within the
// same invocation (e.g. bulk email jobs or retry logic).
let _browser = null;

// puppeteer/puppeteer-core/@sparticuz/chromium are imported dynamically
// below instead of at module top-level. This module sits at the end of an
// import chain that every route pulls in eagerly (app.js -> routes/payment.js
// -> paymentController.js -> invoiceService.js -> here), so a top-level
// import here loaded all three packages — including the Lambda-packaged
// Chromium binary — on every cold start of the function, even for requests
// that never touch a PDF (e.g. the public /api/content/all landing-page
// fetch every visitor's first load depends on). That was adding several
// seconds of pure module-load overhead to every cold hit across the whole
// API, not just the invoice/receipt routes that actually need it.
async function createBrowser() {
    if (PDF_RUNTIME === 'vercel') {
        const [{ default: puppeteerCore }, { default: chromium }] = await Promise.all([
            import('puppeteer-core'),
            import('@sparticuz/chromium'),
        ]);

        return puppeteerCore.launch({
            args: [
                ...chromium.args,
                '--hide-scrollbars',
                '--disable-web-security',
                '--disable-dev-shm-usage',
                '--no-zygote',           // ← faster cold start
                '--single-process',      // ← faster cold start on Lambda-style envs
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
    }

    const { default: puppeteer } = await import('puppeteer');

    return puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ],
    });
}

export async function launchBrowser() {
    // Return existing browser if still connected
    if (_browser) {
        try {
            // isConnected() is synchronous — cheap check
            if (_browser.isConnected()) return _browser;
        } catch {
            // fall through to create a new one
        }
        _browser = null;
    }

    _browser = await createBrowser();

    // Clean up reference when the browser crashes/closes unexpectedly
    _browser.on('disconnected', () => { _browser = null; });

    return _browser;
}

/**
 * Use this instead of browser.newPage() to avoid leaking pages.
 * Always call page.close() in a finally block after use.
 */
export async function withPage(fn) {
    const browser = await launchBrowser();
    const page = await browser.newPage();

    // Block unnecessary resource types — speeds up page.setContent() significantly
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        // Allow: document, stylesheet (inline <style> tags still work)
        // Block: images loaded via <img src="http..."> — the logo uses a remote URL,
        // but since we're rendering server-side HTML we can skip it for speed.
        // Remove 'image' from the blocked list if the logo MUST render in the PDF.
        if (['font', 'media', 'websocket', 'manifest', 'other'].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    try {
        return await fn(page);
    } finally {
        await page.close().catch(() => { });
    }
}