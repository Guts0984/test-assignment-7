import { describe, expect, it } from 'vitest';
import { datePlaceholder, formatDate, parseDate } from './date';

describe('formatDate', () => {
  it('is dd.MM.yyyy in Ukrainian and MM/dd/yyyy in English', () => {
    expect(formatDate('2024-03-07', 'uk')).toBe('07.03.2024');
    expect(formatDate('2024-03-07', 'en')).toBe('03/07/2024');
  });
  it('a calendar date never shifts with the time zone (no Date objects in local time)', () => {
    const tz = process.env.TZ;
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zone;
      expect(formatDate('2024-01-01', 'uk')).toBe('01.01.2024');
      expect(formatDate('2024-12-31', 'en')).toBe('12/31/2024');
    }
    process.env.TZ = tz;
  });
  it('returns junk unchanged instead of throwing', () => {
    expect(formatDate('not a date', 'en')).toBe('not a date');
    expect(formatDate('2024-02-30', 'en')).toBe('2024-02-30');
  });
});

describe('parseDate', () => {
  it.each([
    ['07.03.2024', 'uk', '2024-03-07'],
    ['7.3.2024', 'uk', '2024-03-07'],
    ['07/03/2024', 'uk', '2024-03-07'],
    ['03/07/2024', 'en', '2024-03-07'],
    ['3/7/2024', 'en', '2024-03-07'],
    ['2024-03-07', 'uk', '2024-03-07'],
    ['2024-03-07', 'en', '2024-03-07'],
    ['29.02.2024', 'uk', '2024-02-29'],
    ['02/29/2024', 'en', '2024-02-29'],
  ] as const)('%s (%s) -> %s', (input, loc, iso) =>
    expect(parseDate(input, loc)).toEqual({ ok: true, value: iso }),
  );

  it('the same digits are a different date per locale (day-first vs month-first)', () => {
    expect(parseDate('04/05/2024', 'uk')).toEqual({ ok: true, value: '2024-05-04' });
    expect(parseDate('04/05/2024', 'en')).toEqual({ ok: true, value: '2024-04-05' });
  });

  it.each([
    ['31.02.2024', 'uk'],
    ['30.02.2024', 'uk'],
    ['29.02.2023', 'uk'],
    ['13/01/2024', 'en'], // month 13 in en
    ['00.01.2024', 'uk'],
    ['01.00.2024', 'uk'],
    ['07.03.24', 'uk'], // 2-digit year is ambiguous
    ['2024.03.07', 'uk'],
    ['abc', 'uk'],
    ['07.03.2024 12:00', 'uk'],
    ['2024-13-01', 'en'],
    ['1899-12-31', 'en'],
    ['99999', 'en'],
  ] as const)('rejects %s (%s)', (input, loc) => expect(parseDate(input, loc).ok).toBe(false));

  it('empty is reported as empty', () => {
    expect(parseDate('  ', 'uk')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('placeholder', () => {
  it('shows the expected order', () => {
    expect(datePlaceholder('uk')).toBe('дд.мм.рррр');
    expect(datePlaceholder('en')).toBe('mm/dd/yyyy');
  });
});
