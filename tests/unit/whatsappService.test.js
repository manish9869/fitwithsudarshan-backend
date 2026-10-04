import { describe, it, expect } from 'vitest';
import { normalizePhone, personalize, sequenceDayNumber } from '../../src/services/whatsappService.js';

describe('normalizePhone', () => {
    it('adds the India country code to a bare 10-digit number', () => {
        expect(normalizePhone('98765 43210')).toBe('919876543210');
    });
    it('strips a leading trunk 0 and formatting', () => {
        expect(normalizePhone('098765-43210')).toBe('919876543210');
    });
    it('keeps an existing country code', () => {
        expect(normalizePhone('+91 98765 43210')).toBe('919876543210');
        expect(normalizePhone('+1 (312) 847-1928')).toBe('13128471928');
    });
    it('handles the 00 international prefix', () => {
        expect(normalizePhone('0091 9876543210')).toBe('919876543210');
    });
    it('rejects junk and too-short numbers', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone('12345')).toBeNull();
        expect(normalizePhone('abc')).toBeNull();
    });
});

describe('personalize', () => {
    it('fills {{name}} and {{first_name}} in title case', () => {
        const out = personalize('Hey {{first_name}}! ({{name}})', { name: 'sudarshan chavan' });
        expect(out).toBe('Hey Sudarshan! (Sudarshan Chavan)');
    });
    it('tolerates spacing inside braces and is case-insensitive', () => {
        expect(personalize('Hi {{ FIRST_NAME }}', { name: 'riya' })).toBe('Hi Riya');
    });
    it('falls back to "there" when the name is missing', () => {
        expect(personalize('Hey {{first_name}}', { name: '' })).toBe('Hey there');
    });
});

describe('sequenceDayNumber', () => {
    const joined = { start_mode: 'joined' };

    it('is Day 1 on the IST day the member joined', () => {
        expect(sequenceDayNumber(joined, '2026-10-04T04:00:00Z', '2026-10-04')).toBe(1);
        expect(sequenceDayNumber(joined, '2026-10-04T04:00:00Z', '2026-10-05')).toBe(2);
    });

    it('uses the IST calendar day, not UTC (late-night joins)', () => {
        // 20:00 UTC on Oct 3 = 01:30 IST on Oct 4 → Oct 4 is Day 1.
        expect(sequenceDayNumber(joined, '2026-10-03T20:00:00Z', '2026-10-04')).toBe(1);
    });

    it('counts from the batch date in fixed mode, ignoring join time', () => {
        const fixed = { start_mode: 'fixed', start_date: '2026-10-01' };
        expect(sequenceDayNumber(fixed, '2026-10-03T04:00:00Z', '2026-10-04')).toBe(4);
    });

    it('is not started (<= 0) before the start date', () => {
        const fixed = { start_mode: 'fixed', start_date: '2026-10-10' };
        expect(sequenceDayNumber(fixed, null, '2026-10-04')).toBeLessThanOrEqual(0);
    });

    it('spans month boundaries correctly', () => {
        const fixed = { start_mode: 'fixed', start_date: '2026-10-30' };
        expect(sequenceDayNumber(fixed, null, '2026-11-02')).toBe(4);
    });
});
