/**
 * Exact decimal helpers for money values. Prices travel as strings ("12.50") so that
 * no precision is lost; comparisons are done on scaled BigInt, never on floats.
 */
export const DECIMAL_SCALE = 2;
export const DECIMAL_RE = /^\d{1,12}(\.\d{1,2})?$/;

export const isDecimalString = (s: string): boolean => DECIMAL_RE.test(s);

/** "12.5" -> 1250n. Caller must have validated the string. */
export const toScaled = (s: string): bigint => {
  const [int = '0', frac = ''] = s.split('.');
  return BigInt(int) * 100n + BigInt(frac.padEnd(DECIMAL_SCALE, '0'));
};

export const fromScaled = (n: bigint): string => {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(DECIMAL_SCALE, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
};

export const compareDecimal = (a: string, b: string): -1 | 0 | 1 => {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Normalise "12.5" / "012" -> "12.50"; returns null when not a valid decimal. */
export const normalizeDecimal = (s: string): string | null =>
  isDecimalString(s) ? fromScaled(toScaled(s)) : null;
