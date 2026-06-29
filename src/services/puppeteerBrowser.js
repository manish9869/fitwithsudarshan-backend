import puppeteer from 'puppeteer';
import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const PDF_RUNTIME = process.env.PDF_RUNTIME || 'local';

export async function launchBrowser() {
    const isVercelRuntime = PDF_RUNTIME === 'vercel';

    console.log('PDF_RUNTIME:', PDF_RUNTIME);

    if (isVercelRuntime) {
        return puppeteerCore.launch({
            args: [
                ...chromium.args,
                '--hide-scrollbars',
                '--disable-web-security',
                '--disable-dev-shm-usage',
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
    }

    return puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
        ],
    });
}