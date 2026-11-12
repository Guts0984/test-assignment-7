import { describe, expect, it } from 'vitest';
import { formatDecimal, formatInteger, parseDecimal, parseInteger, separators } from './number';

const ok = (value: string) => ({ ok: true, value });
const bad = (reason: 'empty' | 'invalid' = 'invalid') => ({ ok: false, reason });
const NBSP = ' ';

describe('platform separators (what the UI formats with)', () => {
  it('uk groups with a space-like character and uses a comma decimal; en the reverse', () => {
    expect(separators('uk').decimal).toBe(',');
    expect(separators('uk').group).toMatch(/\s/u);
    expect(separators('en')).toEqual({ group: ',', decimal: '.' });
  });
});

describe('parseDecimal - uk', () => {
  it.each([
    ['1 234,50', '1234.50'],
    [`1${NBSP}234,50`, '1234.50'],
    ['1 234,5', '1234.5'],
    ['1234,5', '1234.5'],
    ['1234', '1234'],
    ['0,5', '0.5'],
    [',5', '0.5'],
    ['5,', '5'],
    ['  12,30  ', '12.30'],
    ['007,10', '7.10'],
    ['1 234 567,89', '1234567.89'],
    ['12.5', '12.5'], // numeric keypad habit: a lone dot is a decimal mark
  ])('%j -> %s', (input, value) => expect(parseDecimal(input, 'uk')).toEqual(ok(value)));

  it.each([
    '1.234,5',
    '1,234.50',
    '1,2,3',
    '1..2',
    '1,,2',
    'abc',
    '12abc',
    '1e3',
    '0x10',
    'Infinity',
    'NaN',
    '--1',
    '+5',
    ',',
    '.',
    '1 2 , 5 5',
    '1, 5',
    '1 ,5',
  ])('rejects %j', (input) => expect(parseDecimal(input, 'uk').ok).toBe(false));
  it('empty is reported as empty, not invalid', () => {
    expect(parseDecimal('', 'uk')).toEqual(bad('empty'));
    expect(parseDecimal('   ', 'uk')).toEqual(bad('empty'));
  });
  it('negatives only when allowed', () => {
    expect(parseDecimal('-5,5', 'uk')).toEqual(bad());
    expect(parseDecimal('-5,5', 'uk', { allowNegative: true })).toEqual(ok('-5.5'));
    expect(parseDecimal('−5,5', 'uk', { allowNegative: true })).toEqual(ok('-5.5')); // typographic minus
  });
});

describe('parseDecimal - en', () => {
  it.each([
    ['1,234.50', '1234.50'],
    ['1234.5', '1234.5'],
    ['1,234,567.89', '1234567.89'],
    ['0.5', '0.5'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['1234', '1234'],
    ['  7.00 ', '7.00'],
  ])('%j -> %s', (input, value) => expect(parseDecimal(input, 'en')).toEqual(ok(value)));

  it.each([
    '1,5',
    '12,34',
    '1,23',
    '1234,567',
    '1,234,56',
    '1.234,5',
    '1 234.50',
    '1.2.3',
    'abc',
    '1e3',
    ',5',
    '1,',
    '1,,234',
    '1,234.5.6',
  ])('rejects %j (never silently reinterpreted)', (input) =>
    expect(parseDecimal(input, 'en').ok).toBe(false),
  );
  it('the SAME text means different things per locale - and is refused when it would be ambiguous', () => {
    expect(parseDecimal('1,234', 'en')).toEqual(ok('1234')); // thousand
    expect(parseDecimal('1,234', 'uk')).toEqual(ok('1.234')); // decimal (then price validation rejects 3 digits)
  });
});

describe('parseInteger', () => {
  it.each([
    ['1 234', 'uk', '1234'],
    ['1,234', 'en', '1234'],
    ['0', 'en', '0'],
    ['12,0', 'uk', '12'],
    ['12.00', 'en', '12'],
  ] as const)('%j (%s) -> %s', (input, loc, value) =>
    expect(parseInteger(input, loc)).toEqual(ok(value)),
  );
  it.each([
    ['12,5', 'uk'],
    ['12.5', 'en'],
    ['1,5', 'en'],
    ['abc', 'uk'],
    ['-1', 'uk'],
  ] as const)('rejects %j (%s)', (input, loc) => expect(parseInteger(input, loc).ok).toBe(false));
});

describe('formatDecimal / formatInteger', () => {
  it('formats exactly, with the locale separators and two fraction digits', () => {
    expect(formatDecimal('1234.5', 'en')).toBe('1,234.50');
    expect(formatDecimal('1234.5', 'uk').replace(/\s/gu, ' ')).toBe('1 234,50');
    expect(formatDecimal('0.05', 'en')).toBe('0.05');
    expect(formatDecimal('999999999999.99', 'en')).toBe('999,999,999,999.99');
    expect(formatDecimal('7', 'en')).toBe('7.00');
  });
  it('round trip: format then parse gives the same value', () => {
    for (const loc of ['uk', 'en'] as const) {
      for (const v of ['0.01', '1.50', '1234.56', '999999999999.99', '10.00']) {
        expect(parseDecimal(formatDecimal(v, loc), loc)).toEqual(ok(v));
      }
    }
  });
  it('integers', () => {
    expect(formatInteger(1234567, 'en')).toBe('1,234,567');
    expect(formatInteger(1234567, 'uk').replace(/\s/gu, ' ')).toBe('1 234 567');
    expect(formatInteger(0, 'en')).toBe('0');
    expect(formatInteger(999, 'en')).toBe('999');
  });
  it('does not mangle non-decimal input', () => {
    expect(formatDecimal('abc', 'en')).toBe('abc');
  });
});

describe('uk: a space is a thousands separator only between groups of three', () => {
  it.each(['12 34', '1 2345', '1234 567', '12  345', '1 23', '12 3456,5'])('rejects %j', (t) =>
    expect(parseDecimal(t, 'uk').ok).toBe(false),
  );
  it.each([
    ['1 234', '1234'],
    ['12\u00a0345,5', '12345.5'],
    ['1\u202f234\u202f567', '1234567'],
    ['999', '999'],
  ])('accepts %j', (t, v) => expect(parseDecimal(t, 'uk')).toEqual({ ok: true, value: v }));
  it('integers too: "12 34" is not 1234', () => expect(parseInteger('12 34', 'uk').ok).toBe(false));
});
