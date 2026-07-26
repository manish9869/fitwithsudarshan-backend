// src/controllers/adminProfileController.js
//
// The admin's own account details (display name, qualification, contact) —
// distinct from the public-facing "Coach Bio" site content. req.admin only
// carries what was baked into the JWT at login time, so these read/write
// straight to the `admins` table for a fresh, current value.
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';

const PROFILE_COLUMNS = 'id, username, display_name, role, qualification, contact';

export async function getAdminProfile(req, res) {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('admins')
            .select(PROFILE_COLUMNS)
            .eq('id', req.admin.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Admin not found.' });
        return res.json({ profile: data });
    } catch (err) {
        logger.error(`[admin-profile] get failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to load profile.' });
    }
}

export async function updateAdminProfile(req, res) {
    try {
        const { displayName, qualification, contact } = req.body || {};
        const row = {};
        if (displayName !== undefined) row.display_name = displayName;
        if (qualification !== undefined) row.qualification = qualification;
        if (contact !== undefined) row.contact = contact;

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('admins')
            .update(row)
            .eq('id', req.admin.id)
            .select(PROFILE_COLUMNS)
            .single();
        if (error) throw error;

        logger.info(`[admin-profile] ${req.admin.username} updated their profile`);
        return res.json({ profile: data });
    } catch (err) {
        logger.error(`[admin-profile] update failed: ${err.message}`);
        return res.status(400).json({ error: 'Failed to update profile.' });
    }
}
