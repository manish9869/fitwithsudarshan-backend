// src/controllers/analyticsController.js
import { getLiveUsers, isGa4Configured } from '../services/gaRealtimeService.js';
import { getAnalyticsOverview } from '../services/gaReportService.js';
import logger from '../config/logger.js';

export async function getLiveUsersHandler(req, res) {
    if (!isGa4Configured()) {
        return res.json({ configured: false });
    }

    try {
        const data = await getLiveUsers();
        return res.json({ configured: true, ...data });
    } catch (err) {
        logger.error(`[analytics] getLiveUsers failed: ${err.message}`);
        return res.status(502).json({ configured: true, error: 'Could not reach Google Analytics.' });
    }
}

const ALLOWED_RANGES = [7, 30, 90];

export async function getAnalyticsOverviewHandler(req, res) {
    if (!isGa4Configured()) {
        return res.json({ configured: false });
    }

    const days = ALLOWED_RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : 30;

    try {
        const data = await getAnalyticsOverview(days);
        return res.json({ configured: true, ...data });
    } catch (err) {
        logger.error(`[analytics] getAnalyticsOverview failed: ${err.message}`);
        return res.status(502).json({ configured: true, error: 'Could not reach Google Analytics.' });
    }
}
