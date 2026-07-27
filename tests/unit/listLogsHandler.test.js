import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { listLogsHandler } = await import('../../src/controllers/logController.js');

function row(overrides = {}) {
    return {
        id: `log-${Math.random()}`, step: 'create_order', status: 'success',
        source: 'backend', message: null, enrollment_id: null, created_at: new Date().toISOString(),
        ...overrides,
    };
}

describe('GET /api/admin/logs', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({
            transaction_logs: [
                row({ step: 'create_order', status: 'success', source: 'backend' }),
                row({ step: 'confirm_payment:db_update', status: 'failed', source: 'backend', message: 'signature mismatch' }),
                row({ step: 'client:checkout_opened', status: 'started', source: 'frontend' }),
            ],
        });
        getSupabaseAdmin.mockReturnValue(fake.client);
    });

    it('returns all rows with no filters', async () => {
        const res = createMockRes();
        await listLogsHandler(createMockReq({ query: {} }), res);
        expect(res.body.rows).toHaveLength(3);
        expect(res.body.total).toBe(3);
    });

    it('filters by status', async () => {
        const res = createMockRes();
        await listLogsHandler(createMockReq({ query: { status: 'failed' } }), res);
        expect(res.body.rows).toHaveLength(1);
        expect(res.body.rows[0].message).toBe('signature mismatch');
    });

    it('filters by source', async () => {
        const res = createMockRes();
        await listLogsHandler(createMockReq({ query: { source: 'frontend' } }), res);
        expect(res.body.rows).toHaveLength(1);
        expect(res.body.rows[0].step).toBe('client:checkout_opened');
    });

    it('clamps pageSize to the max', async () => {
        const res = createMockRes();
        await listLogsHandler(createMockReq({ query: { pageSize: '9999' } }), res);
        expect(res.body.pageSize).toBe(200);
    });

    it('never throws — returns 500 with a message on a DB error', async () => {
        fake.client.from = vi.fn(() => ({
            select: () => ({ or: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' }, count: 0 }) }) }) }),
        }));
        const res = createMockRes();
        await listLogsHandler(createMockReq({ query: { search: 'x' } }), res);
        expect(res.statusCode).toBe(500);
    });
});
