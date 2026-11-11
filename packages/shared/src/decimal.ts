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

/** Integer division rounding half away from zero. */
export const divRound = (n: bigint, d: bigint): bigint => {
  const neg = n < 0n !== d < 0n;
  const a = n < 0n ? -n : n;
  const b = d < 0n ? -d : d;
  const q = (2n * a + b) / (2n * b);
  return neg ? -q : q;
};

/** Signed decimal ("-2.5", "10") -> scaled BigInt (x100). Caller validates the shape. */
export const toScaledSigned = (s: string): bigint =>
  s.startsWith('-') ? -toScaled(s.slice(1)) : toScaled(s);

export type AdjustResult = { ok: true; value: string | number } | { ok: false; message: string };

/**
 * "price +10%" / "stock -5" arithmetic, exact (BigInt), half-away-from-zero rounding.
 * Money stays a 2-digit decimal string, stock stays an integer. Range checks (price > 0, int max, ...)
 * are the field validators' job, so a negative result simply fails validation upstream.
 */
export const computeAdjust = (
  field: 'price' | 'oldPrice' | 'stock',
  current: string | number | null,
  mode: 'percent' | 'absolute',
  amount: string,
): AdjustResult => {
  if (current === null) return { ok: false, message: `${field} is empty` };
  if (field === 'stock') {
    const cur = BigInt(current);
    if (mode === 'percent') {
      return { ok: true, value: Number(divRound(cur * (10000n + toScaledSigned(amount)), 10000n)) };
    }
    if (!/^-?\d+$/.test(amount)) return { ok: false, message: 'stock changes by a whole number' };
    return { ok: true, value: Number(cur + BigInt(amount)) };
  }
  const cur = toScaled(String(current));
  const next =
    mode === 'percent'
      ? divRound(cur * (10000n + toScaledSigned(amount)), 10000n)
      : cur + toScaledSigned(amount);
  return { ok: true, value: fromScaled(next) };
};
