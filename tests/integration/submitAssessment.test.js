/**
 * tests/integration/submitAssessment.test.js
 *
 * The onboarding/body-assessment journey: a visitor fills the multi-step
 * assessment form (goals, current stats, food/training habits, optional
 * photos + blood report), submits it, gets saved to the DB with their files
 * uploaded to private storage, and the coach (+ optionally the customer)
 * gets an email about it.
 *
 * assessmentService.js keeps its own private Supabase client (separate from
 * utils/supabaseAdmin.js used by the rest of the app), so it's mocked at the
 * @supabase/supabase-js level here instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const { createClient } = await import('@supabase/supabase-js');
const { submitAssessmentHandler } = await import('../../src/controllers/assessmentController.js');

const nodemailer = (await import('nodemailer')).default;

function validBody(overrides = {}) {
    return {
        firstName: 'ravi', lastName: 'kumar', email: 'ravi@example.com',
        whatsapp: '9876543210', age: '32', gender: 'male', city: 'Pune', plan: 'online',
        currentWeight: '85', height: '175', mainGoal: 'Lose fat', desiredResult: 'Lean and fit',
        whyNow: 'Health scare', workoutStatus: 'beginner', trainingDays: '4',
        foodPreference: 'veg', dailyFoodRoutine: '3 meals', biggestStruggle: 'Late night snacking',
        sleepHours: '6',
        ...overrides,
    };
}

function fakeFile(name, mimetype) {
    return { originalname: name, mimetype, buffer: Buffer.from('fake-bytes') };
}

describe('POST /api/submit-assessment', () => {
    // assessmentService.js caches its Supabase client in a module-level
    // singleton the first time getSupabase() runs and never calls
    // createClient() again — so the fake client (and its `.from` override
    // used by the last test below) must be the SAME object for the whole
    // file. Per-test isolation comes from clearing the fake table's rows,
    // not from creating a new client.
    const fake = createFakeSupabase({ assessments: [] });
    createClient.mockReturnValue(fake.client);
    const realFrom = fake.client.from;

    // assessmentController.js's own getTransporter() caches its transporter
    // the same way — one sendMail mock for the whole file, cleared per test.
    const sendMailMock = vi.fn(() => Promise.resolve({ messageId: 'x' }));
    nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

    beforeEach(() => {
        fake.tables.assessments = [];
        fake.client.from = realFrom;
        sendMailMock.mockClear();
    });

    it('saves a complete submission (with all three files) and emails the coach + customer', async () => {
        const req = createMockReq({
            body: validBody(),
            // simulates what multer's upload.fields() would have populated
        });
        req.files = {
            photoFront: [fakeFile('front.jpg', 'image/jpeg')],
            photoSide: [fakeFile('side.png', 'image/png')],
            bloodReport: [fakeFile('report.pdf', 'application/pdf')],
        };
        const res = createMockRes();

        await submitAssessmentHandler(req, res, (err) => { throw err; });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(fake.tables.assessments).toHaveLength(1);

        const row = fake.tables.assessments[0];
        expect(row.first_name).toBe('Ravi'); // title-cased
        expect(row.status).toBe('new');
        expect(row.photo_front_path).toMatch(/front-.+\.jpg$/);
        expect(row.photo_side_path).toMatch(/side-.+\.png$/);
        expect(row.blood_report_path).toMatch(/blood-report-.+\.pdf$/);

        await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(2));
        const coachCall = sendMailMock.mock.calls[0][0];
        expect(coachCall.to).toBe(process.env.COACH_EMAIL);
        const customerCall = sendMailMock.mock.calls[1][0];
        expect(customerCall.to).toBe('ravi@example.com');
    });

    it('accepts a submission with zero files — photos/blood report are optional', async () => {
        const req = createMockReq({ body: validBody({ email: '' }) });
        req.files = {};
        const res = createMockRes();

        await submitAssessmentHandler(req, res, (err) => { throw err; });

        expect(res.statusCode).toBe(201);
        const row = fake.tables.assessments[0];
        expect(row.photo_front_path).toBeNull();
        expect(row.photo_side_path).toBeNull();
        expect(row.blood_report_path).toBeNull();

        // No customer email on file → only the coach email should fire.
        await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
        expect(sendMailMock.mock.calls[0][0].to).toBe(process.env.COACH_EMAIL);
    });

    it('rejects a submission missing required fields, before touching the DB', async () => {
        const req = createMockReq({ body: validBody({ whatsapp: '', mainGoal: '' }) });
        req.files = {};
        const res = createMockRes();

        await submitAssessmentHandler(req, res, (err) => { throw err; });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('whatsapp');
        expect(res.body.error).toContain('mainGoal');
        expect(fake.tables.assessments).toHaveLength(0);
    });

    it('rejects fields that are present but only whitespace', async () => {
        const req = createMockReq({ body: validBody({ city: '   ' }) });
        req.files = {};
        const res = createMockRes();

        await submitAssessmentHandler(req, res, (err) => { throw err; });

        expect(res.statusCode).toBe(400);
        expect(fake.tables.assessments).toHaveLength(0);
    });

    it('does not fail the request if the DB insert fails after files were uploaded — surfaces the error', async () => {
        fake.client.from = vi.fn(() => ({
            insert: () => ({
                select: () => ({
                    single: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }),
                }),
            }),
        }));

        const req = createMockReq({ body: validBody() });
        req.files = {};
        const res = createMockRes();
        const next = vi.fn();

        await submitAssessmentHandler(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(next.mock.calls[0][0].message).toMatch(/failed to save assessment/i);
    });
});
