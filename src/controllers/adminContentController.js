// src/controllers/adminContentController.js
import {
    listRows,
    createRow,
    updateRow,
    deleteRow,
    getSiteContent,
    setSiteContent,
    getBasicConsultation,
    updateBasicConsultation,
    getPricingTable,
    bulkUpsertPricing,
    deletePricingRow,
    upsertLegalPage,
} from '../services/contentService.js';

import logger from '../config/logger.js';

// ── Resolve primary key column for generic content tables ─────────────────
function idColumnFor(table) {
    if (table === 'durations') return 'months';
    if (table === 'legal_pages') return 'slug';

    return 'id';
}

// ── Generic table CRUD ────────────────────────────────────────────────────
export async function listTable(req, res) {
    try {
        return res.json({
            rows: await listRows(req.params.table),
        });
    } catch (err) {
        logger.error(
            `[admin-content] listTable failed: ${err.message}`
        );

        return res
            .status(err.status || 500)
            .json({
                error: err.message || 'Failed to load.',
            });
    }
}

export async function createTableRow(req, res) {
    try {
        const row = await createRow(
            req.params.table,
            req.body
        );

        logger.info(
            `[admin-content] ${req.admin.username} created row in ${req.params.table}`
        );

        return res
            .status(201)
            .json({ row });
    } catch (err) {
        logger.error(
            `[admin-content] createTableRow failed: ${err.message}`
        );

        return res
            .status(err.status || 400)
            .json({
                error: err.message || 'Failed to create.',
            });
    }
}

export async function updateTableRow(req, res) {
    try {
        const row = await updateRow(
            req.params.table,
            req.params.id,
            req.body,
            idColumnFor(req.params.table)
        );

        logger.info(
            `[admin-content] ${req.admin.username} updated row ${req.params.id} in ${req.params.table}`
        );

        return res.json({ row });
    } catch (err) {
        logger.error(
            `[admin-content] updateTableRow failed: ${err.message}`
        );

        return res
            .status(err.status || 400)
            .json({
                error: err.message || 'Failed to update.',
            });
    }
}

export async function deleteTableRow(req, res) {
    try {
        await deleteRow(
            req.params.table,
            req.params.id,
            idColumnFor(req.params.table)
        );

        logger.info(
            `[admin-content] ${req.admin.username} deleted row ${req.params.id} from ${req.params.table}`
        );

        return res.json({
            success: true,
        });
    } catch (err) {
        logger.error(
            `[admin-content] deleteTableRow failed: ${err.message}`
        );

        return res
            .status(err.status || 400)
            .json({
                error: err.message || 'Failed to delete.',
            });
    }
}

// ── Legal pages ───────────────────────────────────────────────────────────
export async function putLegalPageHandler(req, res) {
    try {
        const row = await upsertLegalPage(
            req.params.slug,
            req.body
        );

        logger.info(
            `[admin-content] ${req.admin.username} updated legal page ${req.params.slug}`
        );

        return res.json({ row });
    } catch (err) {
        logger.error(
            `[admin-content] putLegalPageHandler failed: ${err.message}`
        );

        return res
            .status(err.status || 400)
            .json({
                error:
                    err.message ||
                    'Failed to update legal page.',
            });
    }
}

// ── site_content singleton ────────────────────────────────────────────────
export async function getSiteKey(req, res) {
    try {
        return res.json({
            value: await getSiteContent(
                req.params.key
            ),
        });
    } catch (err) {
        return res
            .status(err.status || 500)
            .json({
                error: err.message || 'Failed to load.',
            });
    }
}

export async function putSiteKey(req, res) {
    try {
        const value = await setSiteContent(
            req.params.key,
            req.body.value
        );

        logger.info(
            `[admin-content] ${req.admin.username} updated site_content.${req.params.key}`
        );

        return res.json({ value });
    } catch (err) {
        return res
            .status(err.status || 400)
            .json({
                error: err.message || 'Failed to save.',
            });
    }
}

// ── basic consultation ────────────────────────────────────────────────────
export async function getBasicConsultationHandler(req, res) {
    try {
        return res.json({
            basicConsultation:
                await getBasicConsultation(),
        });
    } catch (err) {
        return res
            .status(500)
            .json({
                error: err.message,
            });
    }
}

export async function putBasicConsultationHandler(req, res) {
    try {
        const basicConsultation =
            await updateBasicConsultation(
                req.body
            );

        logger.info(
            `[admin-content] ${req.admin.username} updated basic_consultation`
        );

        return res.json({
            basicConsultation,
        });
    } catch (err) {
        return res
            .status(400)
            .json({
                error: err.message,
            });
    }
}

// ── pricing ───────────────────────────────────────────────────────────────
export async function getPricingHandler(req, res) {
    try {
        return res.json({
            pricingTable:
                await getPricingTable(),
        });
    } catch (err) {
        return res
            .status(500)
            .json({
                error: err.message,
            });
    }
}

export async function putPricingHandler(req, res) {
    try {
        const rows = req.body.rows;

        if (!Array.isArray(rows)) {
            return res
                .status(400)
                .json({
                    error: '`rows` array is required.',
                });
        }

        const pricingTable =
            await bulkUpsertPricing(rows);

        logger.info(
            `[admin-content] ${req.admin.username} updated ${rows.length} pricing row(s)`
        );

        return res.json({
            pricingTable,
        });
    } catch (err) {
        return res
            .status(400)
            .json({
                error: err.message,
            });
    }
}

export async function deletePricingHandler(req, res) {
    try {
        await deletePricingRow(
            req.params.id
        );

        return res.json({
            success: true,
        });
    } catch (err) {
        return res
            .status(400)
            .json({
                error: err.message,
            });
    }
}