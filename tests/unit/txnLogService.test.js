/**
 * Tests for the verbose-logging toggle: with it off (the default), only
 * failures/warnings and a handful of essential outcome steps get persisted
 * to transaction_logs — the point being to cut DB write volume from the
 * many step-by-step entries a single checkout generates. With it on,
 * every step is persisted, same as the original always-log behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';

vi.mock('../../src/utils/supabaseAdmin.js', () => ({ getSupabaseAdmin: vi.fn() }));
const { getSupabaseAdmin } = await import('../../src/utils/supabaseAdmin.js');
const { logTxnStep } = await import('../../src/services/txnLogService.js');
const { invalidateContentCache } = await import('../../src/services/contentService.js');

function setVerbose(fake, verbose) {
    fake.tables.site_content = [{ key: 'logging', value: { verbose } }];
    invalidateContentCache(); // clear the cached flag so the new value takes effect immediately
}

describe('logTxnStep — verbose-logging gate', () => {
    let fake;

    beforeEach(() => {
        fake = createFakeSupabase({ transaction_logs: [], site_content: [] });
        getSupabaseAdmin.mockReturnValue(fake.client);
        invalidateContentCache();
    });

    it('defaults to off: a "started" step on a non-essential path is not persisted', async () => {
        await logTxnStep({ step: 'confirm_payment', status: 'started' });
        expect(fake.tables.transaction_logs).toHaveLength(0);
    });

    it('always persists a failure, regardless of the setting', async () => {
        await logTxnStep({ step: 'confirm_payment:coupon_increment', status: 'failed', message: 'boom' });
        expect(fake.tables.transaction_logs).toHaveLength(1);
    });

    it('always persists a warning', async () => {
        await logTxnStep({ step: 'confirm_payment:emails', status: 'warning', message: 'skipped' });
        expect(fake.tables.transaction_logs).toHaveLength(1);
    });

    it('always persists the essential outcome steps even when off', async () => {
        await logTxnStep({ step: 'create_order', status: 'success' });
        await logTxnStep({ step: 'confirm_payment:db_update', status: 'success' });
        await logTxnStep({ step: 'webhook:db_update', status: 'success' });
        expect(fake.tables.transaction_logs).toHaveLength(3);
    });

    it('skips a non-essential success step when off (e.g. ledger insert, email send)', async () => {
        await logTxnStep({ step: 'confirm_payment:ledger_insert', status: 'success' });
        await logTxnStep({ step: 'confirm_payment:email_coach', status: 'success' });
        expect(fake.tables.transaction_logs).toHaveLength(0);
    });

    it('persists everything, including "started" and minor successes, once verbose is turned on', async () => {
        setVerbose(fake, true);

        await logTxnStep({ step: 'confirm_payment', status: 'started' });
        await logTxnStep({ step: 'confirm_payment:ledger_insert', status: 'success' });
        await logTxnStep({ step: 'confirm_payment:email_coach', status: 'success' });

        expect(fake.tables.transaction_logs).toHaveLength(3);
    });

    it('never throws even if the DB insert itself fails', async () => {
        setVerbose(fake, true);
        fake.client.from = vi.fn(() => ({ insert: () => Promise.resolve({ error: { message: 'insert failed' } }) }));

        await expect(logTxnStep({ step: 'create_order', status: 'success' })).resolves.toBeUndefined();
    });
});
