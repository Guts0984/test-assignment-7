export type AppLocale = 'uk' | 'en';

export type ParseResult = { ok: true; value: string } | { ok: false; reason: 'empty' | 'invalid' };

const GROUP_SPACES = /[ \u00a0\u202f]/g;

type Seps = { group: string; decimal: string };
const sepsCache = new Map<string, Seps>();
/** Group/decimal separators straight from the platform's CLDR data (uk: NBSP and comma, en: comma and dot). */
export const separators = (locale: AppLocale): Seps => {
  const hit = sepsCache.get(locale);
  if (hit) return hit;
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const seps = {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
  sepsCache.set(locale, seps);
  return seps;
};

const stripSign = (s: string): { neg: boolean; rest: string } => {
  const m = /^([-−–]?)(.*)$/su.exec(s)!;
  return { neg: m[1] !== '', rest: m[2]! };
};

/**
 * Parses what a person types, by locale, into a canonical machine string ("1234.50").
 *  - uk: `1 234,50` (space/NBSP groups, comma decimal). A dot is also accepted as the decimal mark
 *    when there is no comma, because that is what people type on a numeric keypad.
 *  - en: `1,234.50` (comma groups, dot decimal). A comma that is not a valid thousands separator is rejected,
 *    never silently reinterpreted.
 * Exponents, "Infinity", mixed styles ("1.234,5") and stray characters are invalid.
 */
export const parseDecimal = (
  input: string,
  locale: AppLocale,
  opts: { allowNegative?: boolean } = {},
): ParseResult => {
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  const { neg, rest } = stripSign(text);
  if (neg && !opts.allowNegative) return { ok: false, reason: 'invalid' };

  let intPart: string;
  let fracPart: string;
  if (locale === 'uk') {
    const body = rest.replace(GROUP_SPACES, '');
    const commas = (body.match(/,/g) ?? []).length;
    const dots = (body.match(/\./g) ?? []).length;
    if (commas + dots > 1 || (commas > 0 && dots > 0)) return { ok: false, reason: 'invalid' };
    [intPart = '', fracPart = ''] = body.split(commas ? ',' : '.');
    // spaces are only valid as thousands separators: "12 345" and "1 234 567" - never "12 34" or "1 2345"
    const rawInt = rest.split(/[,.]/)[0]!;
    if (/[ \u00a0\u202f]/.test(rawInt) && !/^\d{1,3}([ \u00a0\u202f]\d{3})+$/.test(rawInt))
      return { ok: false, reason: 'invalid' };
    if (
      /\s/.test(rest.replace(GROUP_SPACES, '')) ||
      /(^|[,.])[ \u00a0\u202f]|[ \u00a0\u202f]($|[,.])/.test(rest)
    ) {
      return { ok: false, reason: 'invalid' };
    }
  } else {
    if (/\s/u.test(rest)) return { ok: false, reason: 'invalid' };
    const [i = '', f, ...more] = rest.split('.');
    if (more.length) return { ok: false, reason: 'invalid' };
    if (i.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(i)) return { ok: false, reason: 'invalid' };
    intPart = i.replaceAll(',', '');
    fracPart = f ?? '';
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return { ok: false, reason: 'invalid' };
  if (intPart === '' && fracPart === '') return { ok: false, reason: 'invalid' };
  const int = intPart.replace(/^0+(?=\d)/, '') || '0';
  const value = `${neg ? '-' : ''}${int}${fracPart ? `.${fracPart}` : ''}`;
  return { ok: true, value };
};

/** Whole numbers: same grouping rules, no fraction at all ("12,5" is an error, not 125). */
export const parseInteger = (
  input: string,
  locale: AppLocale,
  opts: { allowNegative?: boolean } = {},
): ParseResult => {
  const r = parseDecimal(input, locale, opts);
  if (!r.ok) return r;
  if (r.value.includes('.'))
    return /^-?\d+\.0+$/.test(r.value)
      ? { ok: true, value: r.value.split('.')[0]! }
      : { ok: false, reason: 'invalid' };
  return r;
};

const groupInt = (digits: string, group: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);

/** Exact formatting from the decimal string (no float round trip). `1234.5` -> "1 234,50" (uk) / "1,234.50" (en). */
export const formatDecimal = (value: string, locale: AppLocale, fractionDigits = 2): string => {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return value;
  const { group, decimal } = separators(locale);
  const frac = (m[3] ?? '')
    .padEnd(fractionDigits, '0')
    .slice(0, Math.max(fractionDigits, (m[3] ?? '').length));
  return `${m[1]}${groupInt(m[2]!, group)}${frac ? decimal + frac : ''}`;
};

export const formatInteger = (n: number, locale: AppLocale): string => {
  const { group } = separators(locale);
  const neg = n < 0 ? '-' : '';
  return `${neg}${groupInt(String(Math.abs(Math.trunc(n))), group)}`;
};
