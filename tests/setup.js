/**
 * tests/setup.js — runs before every test file.
 *
 * Safety net: this repo's real .env has real Razorpay/Supabase/Gmail
 * credentials. Tests must NEVER be able to reach those real services no
 * matter what. Setting these env vars here (before config/env.js — or
 * anything that imports it — ever runs) wins, because dotenv.config()
 * never overwrites a variable that's already set in process.env.
 */
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.ADMIN_JWT_SECRET = 'test_admin_jwt_secret';
process.env.GMAIL_USER = 'coach-test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test_app_password';
process.env.COACH_EMAIL = 'coach-test@example.com';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test_supabase_secret_key';

import { vi } from 'vitest';

// Belt-and-suspenders: any code path that reaches an unmocked global fetch()
// fails loudly instead of silently hitting the real internet.
vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error(
        'fetch() was called without a test-specific mock. Every test that ' +
        'reaches Razorpay must stub global.fetch explicitly.'
    );
}));

// Same for email — nodemailer is mocked globally so a forgotten test-specific
// mock fails the test instead of sending a real email from the real inbox.
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: vi.fn(() => Promise.reject(new Error(
                'sendMail() was called without a test-specific mock.'
            ))),
        })),
    },
}));
