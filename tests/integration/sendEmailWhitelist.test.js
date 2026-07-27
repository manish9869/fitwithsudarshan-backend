/**
 * Regression test: POST /api/send-email is public and unauthenticated (the
 * contact form has no login to gate it behind). It used to accept ANY of
 * the ~12 email templates plus an arbitrary `to` address — meaning anyone
 * could use this business's Gmail account as a relay to blast an arbitrary
 * recipient with e.g. "enrollment_coach" or "payment_receipt_email"
 * templates. It's now restricted to only the two templates the real contact
 * form actually sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockReq, createMockRes } from '../helpers/httpMock.js';

const { sendEmail } = await import('../../src/controllers/emailController.js');
const nodemailer = (await import('nodemailer')).default;

describe('POST /api/send-email template whitelist', () => {
    let sendMailMock;

    beforeEach(() => {
        sendMailMock = vi.fn(() => Promise.resolve({ messageId: 'x' }));
        nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });
    });

    it('allows the contact form templates the site actually uses', async () => {
        const res = createMockRes();
        await sendEmail(
            createMockReq({ body: { template: 'contact_inquiry_coach', to: 'coach@example.com', data: { name: 'Jane' } } }),
            res,
            (err) => { throw err; }
        );
        expect(res.body.success).toBe(true);
        expect(sendMailMock).toHaveBeenCalledOnce();
    });

    it.each([
        'enrollment_coach',
        'enrollment_customer',
        'payment_receipt_email',
        'balance_due_reminder',
        'welcome',
        'payment_failed',
    ])('rejects the internal/payment template "%s" on this public route', async (template) => {
        const res = createMockRes();
        await sendEmail(
            createMockReq({ body: { template, to: 'victim@example.com', data: {} } }),
            res,
            (err) => { throw err; }
        );

        expect(res.statusCode).toBe(400);
        expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('rejects a request with no `to` address', async () => {
        const res = createMockRes();
        await sendEmail(
            createMockReq({ body: { template: 'contact_inquiry_coach', data: {} } }),
            res,
            (err) => { throw err; }
        );
        expect(res.statusCode).toBe(400);
        expect(sendMailMock).not.toHaveBeenCalled();
    });
});
