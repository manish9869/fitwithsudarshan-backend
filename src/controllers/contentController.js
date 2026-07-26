// src/controllers/contentController.js
import { getPublicContent, getContentVersion } from '../services/contentService.js';
import logger from '../config/logger.js';

export async function getPublicContentHandler(req, res) {
    try {
        const data = await getPublicContent();
        res.setHeader('Cache-Control', 'public, max-age=30');
        return res.json(data);
    } catch (err) {
        logger.error(`[content] getPublicContent failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load site content.' });
    }
}

// Polled frequently by the frontend to detect admin changes without the
// customer needing to hard-refresh. Deliberately tiny — no DB query.
export function getContentVersionHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ version: getContentVersion() });
}