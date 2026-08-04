// src/controllers/analyticsController.js
import { getLiveUsers, isGa4Configured } from '../services/gaRealtimeService.js';
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
