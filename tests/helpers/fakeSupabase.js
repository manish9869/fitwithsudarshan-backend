/**
 * tests/helpers/fakeSupabase.js
 *
 * A minimal in-memory stand-in for the Supabase JS client, covering exactly
 * the query-builder surface this codebase actually uses (select / insert /
 * update / delete / upsert, eq / neq / is / in / gt / gte / lt / lte / ilike,
 * order / range / limit, single / maybeSingle, plus rpc() and storage()).
 *
 * Using a real (tiny) in-memory table — rather than canned per-call
 * responses — means tests exercise real state transitions: e.g. the
 * `.eq('payment_status', 'pending')` idempotency guard in confirmPayment /
 * the webhook actually has to match real row state, not a scripted answer.
 */
import { vi } from 'vitest';

let idCounter = 0;
function nextId() {
    idCounter += 1;
    return `fake-id-${idCounter}`;
}

function matchesFilters(row, filters) {
    return filters.every(([type, col, val]) => {
        const cell = row[col];
        switch (type) {
            case 'eq': return cell === val;
            case 'neq': return cell !== val;
            case 'is': return val === null ? cell === null || cell === undefined : cell === val;
            case 'gt': return cell != null && cell > val;
            case 'gte': return cell != null && cell >= val;
            case 'lt': return cell != null && cell < val;
            case 'lte': return cell != null && cell <= val;
            case 'in': return val.includes(cell);
            case 'ilike': {
                const pattern = String(val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
                return new RegExp(`^${pattern}$`, 'i').test(String(cell ?? ''));
            }
            default: return true;
        }
    });
}

export function createFakeSupabase(initialTables = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(initialTables)) {
        tables[name] = rows.map((r) => ({ ...r }));
    }
    const ensure = (name) => (tables[name] ??= []);

    function makeChain(tableName) {
        const filters = [];
        let mode = 'select';
        let payload = null;
        let onConflict = null;
        let wantSingle = false;
        let wantMaybeSingle = false;

        const api = {};
        const op = (type) => (col, val) => { filters.push([type, col, val]); return api; };

        api.select = () => api;
        api.insert = (rows) => { mode = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return api; };
        api.update = (vals) => { mode = 'update'; payload = vals; return api; };
        api.delete = () => { mode = 'delete'; return api; };
        api.upsert = (rows, opts) => { mode = 'upsert'; payload = Array.isArray(rows) ? rows : [rows]; onConflict = opts?.onConflict; return api; };
        api.eq = op('eq');
        api.neq = op('neq');
        api.is = op('is');
        api.in = op('in');
        api.gt = op('gt');
        api.gte = op('gte');
        api.lt = op('lt');
        api.lte = op('lte');
        api.ilike = op('ilike');
        api.or = () => api; // not modeled — none of the flows under test rely on OR filters
        api.not = () => api;
        api.order = () => api;
        api.range = () => api;
        api.limit = () => api;

        function execute() {
            const table = ensure(tableName);

            if (mode === 'insert') {
                const inserted = payload.map((r) => ({ id: nextId(), ...r }));
                table.push(...inserted);
                return { data: wantSingle || wantMaybeSingle ? inserted[0] : inserted, error: null };
            }

            if (mode === 'update') {
                const matched = table.filter((r) => matchesFilters(r, filters));
                matched.forEach((r) => Object.assign(r, payload));
                return { data: wantSingle || wantMaybeSingle ? (matched[0] ?? null) : matched, error: null };
            }

            if (mode === 'delete') {
                const matched = table.filter((r) => matchesFilters(r, filters));
                tables[tableName] = table.filter((r) => !matchesFilters(r, filters));
                return { data: matched, error: null };
            }

            if (mode === 'upsert') {
                const conflictCols = (onConflict || '').split(',').filter(Boolean);
                let last = null;
                payload.forEach((row) => {
                    const existing = conflictCols.length
                        ? table.find((r) => conflictCols.every((c) => r[c] === row[c]))
                        : null;
                    if (existing) { Object.assign(existing, row); last = existing; }
                    else { last = { id: nextId(), ...row }; table.push(last); }
                });
                return { data: wantSingle || wantMaybeSingle ? last : payload, error: null };
            }

            // select
            const matched = table.filter((r) => matchesFilters(r, filters));
            if (wantSingle) {
                return matched.length === 1
                    ? { data: matched[0], error: null }
                    : { data: null, error: { message: 'Row not found (fake single())' } };
            }
            if (wantMaybeSingle) {
                return { data: matched[0] ?? null, error: null };
            }
            return { data: matched, error: null, count: matched.length };
        }

        api.single = () => { wantSingle = true; return Promise.resolve(execute()); };
        api.maybeSingle = () => { wantMaybeSingle = true; return Promise.resolve(execute()); };
        api.then = (resolve, reject) => Promise.resolve(execute()).then(resolve, reject);
        api.catch = (reject) => Promise.resolve(execute()).catch(reject);
        return api;
    }

    const client = {
        from: vi.fn((name) => makeChain(name)),
        rpc: vi.fn((fnName, args) => {
            if (fnName === 'increment_coupon_usage') {
                const coupon = ensure('coupons').find((c) => c.id === args.coupon_id);
                if (coupon) coupon.used_count = (coupon.used_count || 0) + 1;
                return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
        }),
        storage: {
            from: vi.fn(() => ({
                upload: vi.fn(() => Promise.resolve({ data: {}, error: null })),
                getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/fake.png' } })),
                createSignedUrl: vi.fn(() => Promise.resolve({ data: { signedUrl: 'https://example.com/signed' }, error: null })),
                getBucket: vi.fn(() => Promise.resolve({ data: { name: 'bucket' }, error: null })),
                createBucket: vi.fn(() => Promise.resolve({ data: {}, error: null })),
            })),
        },
    };

    return { client, tables };
}
