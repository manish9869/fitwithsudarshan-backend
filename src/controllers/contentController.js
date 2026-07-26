// src/controllers/contentController.js
import { getPublicContent } from '../services/contentService.js';
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