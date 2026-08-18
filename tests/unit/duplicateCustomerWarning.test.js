/**
 * The other half of the "website + admin, same client" race: instead of
 * finding the existing pending/paid row and recording a payment against it,
 * the admin doesn't spot it and creates a brand-new manual enrollment for
 * the same customer — two live enrollments instead of one. This doesn't
 * block creation (a genuine second/different program for the same client
 * is legitimate), but it must surface what it found so the admin can catch
 * the mistake before it happens, and must not warn again once they've
 * explicitly confirmed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { createManualEnrollment } = await import('../../src/controllers/manualEnrollmentController.js');

const ADMIN = { id: 'admin-1', username: 'test-admin' };

function seedContent(extra = {}) {
    return {
        coaching_types: [{ id: 'online', active: true, sort_order: 1, name: 'Online Coaching' }],
        durations: [{ months: '1', label: '1 Month', sort_order: 1 }],
        ...extra,
    };
}

const PAYLOAD = {
    customerName: 'Om Anand',
    customerEmail: 'om@example.com',
    customerPhone: '9661995076',
    totalAmount: 199,
    coachingType: 'online',
    planType: 'individual',
    durationMonths: '1',
};

describe('POST /api/admin/enrollments/manual — duplicate customer warning', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase(seedContent({
            enrollments: [{
                id: 'existing-1', enrollment_id: 'FIT-2026-000111', customer_name: 'Om Anand',
                customer_email: 'om@example.com', customer_phone: '9661995076',
                payment_status: 'pending', source: 'website', deleted_at: null,
            }],
        }));
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('warns (409) instead of creating, when an active enrollment already exists for the same email', async () => {
        const res = createMockRes();
        await createManualEnrollment(createMockReq({ body: PAYLOAD, admin: ADMIN }), res);

        expect(res.statusCode).toBe(409);
        expect(res.body.duplicates).toHaveLength(1);
        expect(res.body.duplicates[0].enrollment_id).toBe('FIT-2026-000111');
        expect(res.body.error).toMatch(/Om Anand/);
        // Nothing was created.
        expect(fake.tables.enrollments).toHaveLength(1);
    });

    it('creates it anyway once the admin explicitly confirms', async () => {
        const res = createMockRes();
        await createManualEnrollment(createMockReq({ body: { ...PAYLOAD, confirmDuplicate: true }, admin: ADMIN }), res);

        expect(res.statusCode).toBe(201);
        expect(fake.tables.enrollments).toHaveLength(2);
    });

    it('does not warn for a customer with no matching email/phone', async () => {
        const res = createMockRes();
        await createManualEnrollment(createMockReq({
            body: { ...PAYLOAD, customerEmail: 'someone-else@example.com', customerPhone: '9999999999' },
            admin: ADMIN,
        }), res);

        expect(res.statusCode).toBe(201);
    });

    it('does not warn when the only match is soft-deleted or failed/refunded', async () => {
        fake.tables.enrollments[0].deleted_at = new Date().toISOString();
        const res = createMockRes();
        await createManualEnrollment(createMockReq({ body: PAYLOAD, admin: ADMIN }), res);
        expect(res.statusCode).toBe(201);
    });
});
