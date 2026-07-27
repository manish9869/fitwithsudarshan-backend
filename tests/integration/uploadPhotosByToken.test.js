/**
 * tests/integration/uploadPhotosByToken.test.js
 *
 * Covers the "upload photos later" feature: a client who skipped photos
 * during onboarding gets a token back and can return to attach them,
 * without ever needing an account. Security-relevant properties tested:
 *   - the token is the only key — a wrong/guessed token must find nothing
 *   - the status-check route leaks nothing beyond first name/plan/booleans
 *   - a photo update via token never touches the OTHER photo slot
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const { createClient } = await import('@supabase/supabase-js');
const {
    submitAssessmentHandler, getPhotoUploadStatusHandler, uploadPhotosByTokenHandler,
} = await import('../../src/controllers/assessmentController.js');

const nodemailer = (await import('nodemailer')).default;

function validBody(overrides = {}) {
    return {
        firstName: 'ravi', whatsapp: '9876543210', age: '32', gender: 'male', city: 'Pune', plan: 'online',
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

describe('Upload-photos-later token flow', () => {
    const fake = createFakeSupabase({ assessments: [] });
    createClient.mockReturnValue(fake.client);

    const sendMailMock = vi.fn(() => Promise.resolve({ messageId: 'x' }));
    nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

    beforeEach(() => {
        fake.tables.assessments = [];
        sendMailMock.mockClear();
    });

    async function submitWithoutPhotos() {
        const req = createMockReq({ body: validBody() });
        req.files = {};
        const res = createMockRes();
        await submitAssessmentHandler(req, res, (err) => { throw err; });
        return res.body;
    }

    it('hands back an unguessable token on submission that photo-status can be checked with', async () => {
        const { photoUploadToken } = await submitWithoutPhotos();
        expect(photoUploadToken).toMatch(/^[0-9a-f-]{36}$/i); // UUID v4 shape

        const statusRes = createMockRes();
        await getPhotoUploadStatusHandler(createMockReq({ params: { token: photoUploadToken } }), statusRes, (e) => { throw e; });

        expect(statusRes.statusCode).toBe(200);
        expect(statusRes.body).toEqual({
            firstName: 'Ravi', plan: 'online', photoFrontUploaded: false, photoSideUploaded: false,
        });
    });

    it('returns 404 for a wrong/guessed token — leaks nothing about whether any assessment exists', async () => {
        await submitWithoutPhotos();

        const res = createMockRes();
        await getPhotoUploadStatusHandler(
            createMockReq({ params: { token: '00000000-0000-0000-0000-000000000000' } }),
            res,
            (e) => { throw e; }
        );

        expect(res.statusCode).toBe(404);
    });

    it('rejects an upload attempt against an invalid token', async () => {
        const res = createMockRes();
        const req = createMockReq({ params: { token: 'not-a-real-token' } });
        req.files = { photoFront: [fakeFile('f.jpg', 'image/jpeg')] };

        await uploadPhotosByTokenHandler(req, res, (e) => { throw e; });

        expect(res.statusCode).toBe(404);
    });

    it('rejects an upload with no files attached', async () => {
        const { photoUploadToken } = await submitWithoutPhotos();

        const res = createMockRes();
        const req = createMockReq({ params: { token: photoUploadToken } });
        req.files = {};

        await uploadPhotosByTokenHandler(req, res, (e) => { throw e; });

        expect(res.statusCode).toBe(400);
    });

    it('attaches only the photo that was sent, leaving the other slot untouched, and re-notifies the coach', async () => {
        const { photoUploadToken } = await submitWithoutPhotos();
        await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1)); // the original submission email
        sendMailMock.mockClear();

        const req = createMockReq({ params: { token: photoUploadToken } });
        req.files = { photoFront: [fakeFile('front-later.jpg', 'image/jpeg')] };
        const res = createMockRes();

        await uploadPhotosByTokenHandler(req, res, (e) => { throw e; });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const updated = fake.tables.assessments.find((a) => a.photo_upload_token === photoUploadToken);
        expect(updated.photo_front_path).toMatch(/front-.+\.jpg$/);
        expect(updated.photo_side_path).toBeNull(); // untouched

        await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
        expect(sendMailMock.mock.calls[0][0].to).toBe(process.env.COACH_EMAIL);
        expect(sendMailMock.mock.calls[0][0].subject).toContain('Photos Added');
    });

    it('a second later-upload for the other slot does not clobber the first photo', async () => {
        const { photoUploadToken } = await submitWithoutPhotos();

        await uploadPhotosByTokenHandler(
            Object.assign(createMockReq({ params: { token: photoUploadToken } }), { files: { photoFront: [fakeFile('front.jpg', 'image/jpeg')] } }),
            createMockRes(),
            (e) => { throw e; }
        );
        await uploadPhotosByTokenHandler(
            Object.assign(createMockReq({ params: { token: photoUploadToken } }), { files: { photoSide: [fakeFile('side.jpg', 'image/jpeg')] } }),
            createMockRes(),
            (e) => { throw e; }
        );

        const updated = fake.tables.assessments.find((a) => a.photo_upload_token === photoUploadToken);
        expect(updated.photo_front_path).toMatch(/front-.+\.jpg$/);
        expect(updated.photo_side_path).toMatch(/side-.+\.jpg$/);
    });
});
