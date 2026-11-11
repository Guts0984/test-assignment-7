import { describe, expect, it } from 'vitest';
import { compareDecimal, fromScaled, isDecimalString, normalizeDecimal, toScaled } from './decimal';

describe('decimal', () => {
  it('compares without float error (0.1+0.2 class of bugs)', () => {
    expect(compareDecimal('0.30', '0.3')).toBe(0);
    expect(compareDecimal('0.01', '0.00')).toBe(1);
    expect(compareDecimal('999999999999.99', '999999999999.98')).toBe(1);
  });
  it('keeps precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(fromScaled(toScaled('999999999999.99'))).toBe('999999999999.99');
  });
  it.each([
    '',
    '1.',
    '.5',
    '-1',
    '1e3',
    '1,5',
    ' 1',
    '1.234',
    '0x10',
    'NaN',
    'Infinity',
    '1'.repeat(13),
  ])('rejects %j', (s) => expect(isDecimalString(s)).toBe(false));
  it.each([
    ['1', '1.00'],
    ['1.5', '1.50'],
    ['007.10', '7.10'],
  ])('normalises %s', (a, b) => expect(normalizeDecimal(a)).toBe(b));
});
