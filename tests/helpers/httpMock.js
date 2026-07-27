import { vi } from 'vitest';

export function createMockRes() {
    const res = {};
    res.statusCode = 200;
    res.headers = {};
    res.body = undefined;
    res.headersSent = false;
    res.status = vi.fn((code) => { res.statusCode = code; return res; });
    res.json = vi.fn((payload) => { res.body = payload; res.headersSent = true; return res; });
    res.send = vi.fn((payload) => { res.body = payload; res.headersSent = true; return res; });
    res.setHeader = vi.fn((k, v) => { res.headers[k] = v; return res; });
    return res;
}

export function createMockReq({ body = {}, params = {}, query = {}, headers = {}, ip = '127.0.0.1', admin } = {}) {
    return { body, params, query, headers, ip, admin };
}
