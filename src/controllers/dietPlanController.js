// src/controllers/dietPlanController.js
import {
    listDietPlans, getDietPlanWithDays, createDietPlan, updateDietPlan,
    deleteDietPlan, replaceDietPlanDays, getDietPlanByEnrollmentId,
} from '../services/dietPlanService.js';
import logger from '../config/logger.js';

export async function adminListDietPlans(req, res) {
    try {
        return res.json({ plans: await listDietPlans() });
    } catch (err) {
        logger.error(`[admin] listDietPlans failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load diet plans.' });
    }
}

export async function adminGetDietPlanByEnrollment(req, res) {
    try {
        const plan = await getDietPlanByEnrollmentId(req.params.enrollmentId);
        return res.json({ plan: plan || null });
    } catch (err) {
        logger.error(`[admin] getDietPlanByEnrollment failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to check diet plan.' });
    }
}

export async function adminGetDietPlan(req, res) {
    try {
        const plan = await getDietPlanWithDays(req.params.id);
        if (!plan) return res.status(404).json({ error: 'Diet plan not found.' });
        return res.json({ plan });
    } catch (err) {
        logger.error(`[admin] getDietPlan failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load diet plan.' });
    }
}

export async function adminCreateDietPlan(req, res) {
    try {
        const { days, ...planPayload } = req.body || {};
        if (!planPayload.client_name?.trim()) {
            return res.status(400).json({ error: 'Client name is required.' });
        }
        const plan = await createDietPlan(planPayload);
        if (Array.isArray(days) && days.length) {
            await replaceDietPlanDays(plan.id, days);
        }
        logger.info(`[admin] ${req.admin.username} created diet plan for ${plan.client_name}`);
        return res.status(201).json({ plan });
    } catch (err) {
        logger.error(`[admin] createDietPlan failed: ${err.message}`);
        return res.status(400).json({ error: 'Failed to create diet plan.' });
    }
}

export async function adminUpdateDietPlan(req, res) {
    try {
        const { days, ...planPayload } = req.body || {};
        const plan = await updateDietPlan(req.params.id, planPayload);
        if (Array.isArray(days)) {
            await replaceDietPlanDays(req.params.id, days);
        }
        logger.info(`[admin] ${req.admin.username} updated diet plan ${req.params.id}`);
        return res.json({ plan });
    } catch (err) {
        logger.error(`[admin] updateDietPlan failed: ${err.message}`);
        return res.status(400).json({ error: 'Failed to update diet plan.' });
    }
}

export async function adminDeleteDietPlan(req, res) {
    try {
        await deleteDietPlan(req.params.id);
        logger.info(`[admin] ${req.admin.username} deleted diet plan ${req.params.id}`);
        return res.json({ success: true });
    } catch (err) {
        logger.error(`[admin] deleteDietPlan failed: ${err.message}`);
        return res.status(400).json({ error: 'Failed to delete diet plan.' });
    }
}
