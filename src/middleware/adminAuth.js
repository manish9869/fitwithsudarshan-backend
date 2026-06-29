/**
 * backend/src/middleware/adminAuth.js
 *
 * Verifies the admin JWT on protected routes. Expects:
 *   Authorization: Bearer <token>
 *
 * On success, attaches req.admin = { id, username, displayName, role }.
 * On failure, responds 401 — never falls through silently.
 *
 * Requires ADMIN_JWT_SECRET in env (.env). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
 */
import jwt from 'jsonwebtoken';

export function requireAdminAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Missing or malformed authorization header.' });
    }

    const secret = process.env.ADMIN_JWT_SECRET;
    if (!secret) {
        // Fail closed, not open — a missing secret must never mean "allow everyone".
        console.error('[adminAuth] ADMIN_JWT_SECRET is not set.');
        return res.status(500).json({ error: 'Server misconfiguration.' });
    }

    try {
        const payload = jwt.verify(token, secret);
        req.admin = {
            id: payload.sub,
            username: payload.username,
            displayName: payload.displayName,
            role: payload.role,
        };
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }
}