/**
 * backend/src/controllers/adminAuthController.js
 *
 * POST /api/admin/login        — { username, password } → { token, admin }
 * GET  /api/admin/me           — validates current token, returns admin info
 * POST /api/admin/change-password — { currentPassword, newPassword }
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';

const TOKEN_TTL = '12h';

function signToken(admin) {
    const secret = process.env.ADMIN_JWT_SECRET;
    return jwt.sign(
        {
            sub: admin.id,
            username: admin.username,
            displayName: admin.display_name,
            role: admin.role,
        },
        secret,
        { expiresIn: TOKEN_TTL }
    );
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
export async function adminLogin(req, res) {
    try {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const supabase = getSupabaseAdmin();
        const { data: admin, error } = await supabase
            .from('admins')
            .select('id, username, password_hash, display_name, role')
            .eq('username', String(username).toLowerCase().trim())
            .maybeSingle();

        // Always compare against *something* to avoid timing leaks that reveal
        // whether a username exists. Compare against a dummy hash if not found.
        const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO3rH4xtIRsW7e8jJYIY3UQbpDoTr0sP6';
        const validPassword = await bcrypt.compare(
            password,
            admin?.password_hash || DUMMY_HASH
        );

        if (error || !admin || !validPassword) {
            logger.warn(`[admin-auth] Failed login attempt for username="${username}" ip=${req.ip}`);
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        // Fire-and-forget last_login_at update
        supabase
            .from('admins')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', admin.id)
            .then(() => { })
            .catch(() => { });

        const token = signToken(admin);
        logger.info(`[admin-auth] ✅ Login success — ${admin.username}`);

        return res.json({
            token,
            admin: {
                id: admin.id,
                username: admin.username,
                displayName: admin.display_name,
                role: admin.role,
            },
        });
    } catch (err) {
        logger.error(`[admin-auth] login error: ${err.message}`);
        return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
}

// ── GET /api/admin/me ──────────────────────────────────────────────────────────
// req.admin is already populated by requireAdminAuth middleware by the time
// this runs, so this just echoes it back — useful for the frontend to confirm
// the stored token is still valid on app load.
export function adminMe(req, res) {
    return res.json({ admin: req.admin });
}

// ── POST /api/admin/change-password ────────────────────────────────────────────
export async function adminChangePassword(req, res) {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required.' });
        }
        if (String(newPassword).length < 10) {
            return res.status(400).json({ error: 'New password must be at least 10 characters.' });
        }

        const supabase = getSupabaseAdmin();
        const { data: admin, error } = await supabase
            .from('admins')
            .select('id, password_hash')
            .eq('id', req.admin.id)
            .single();

        if (error || !admin) {
            return res.status(404).json({ error: 'Admin not found.' });
        }

        const ok = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!ok) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }

        const password_hash = await bcrypt.hash(newPassword, 12);
        const { error: updateErr } = await supabase
            .from('admins')
            .update({ password_hash })
            .eq('id', admin.id);

        if (updateErr) {
            return res.status(500).json({ error: 'Failed to update password.' });
        }

        return res.json({ success: true });
    } catch (err) {
        logger.error(`[admin-auth] change-password error: ${err.message}`);
        return res.status(500).json({ error: 'Failed to change password.' });
    }
}