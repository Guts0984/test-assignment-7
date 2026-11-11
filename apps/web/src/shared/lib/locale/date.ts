import { isoDate } from '@catalog/shared';
import type { AppLocale } from './number';

type Order = { order: ('day' | 'month' | 'year')[]; sep: string };
const orderCache = new Map<string, Order>();

/** Field order and separator of the locale's numeric date, from the platform (uk: dd.MM.yyyy, en: MM/dd/yyyy). */
const dateOrder = (locale: AppLocale): Order => {
  const hit = orderCache.get(locale);
  if (hit) return hit;
  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2001, 10, 22)));
  const order = parts
    .filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year')
    .map((p) => p.type as 'day' | 'month' | 'year');
  const sep = parts.find((p) => p.type === 'literal')?.value.trim() || '.';
  const o = { order, sep };
  orderCache.set(locale, o);
  return o;
};

export type DateParse = { ok: true; value: string } | { ok: false; reason: 'empty' | 'invalid' };

/** ISO is always accepted; otherwise the locale's own order. Impossible dates (31.02) are invalid. */
export const parseDate = (input: string, locale: AppLocale): DateParse => {
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    return isoDate(text) ? { ok: true, value: text } : { ok: false, reason: 'invalid' };
  const { order } = dateOrder(locale);
  const m = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})$/.exec(text);
  if (!m) return { ok: false, reason: 'invalid' };
  const nums = [m[1]!, m[2]!, m[3]!];
  const get = (f: 'day' | 'month' | 'year') => nums[order.indexOf(f)]!;
  const [d, mo, y] = [get('day'), get('month'), get('year')];
  if (y.length !== 4) return { ok: false, reason: 'invalid' }; // no 2-digit years: ambiguous
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isoDate(iso) ? { ok: true, value: iso } : { ok: false, reason: 'invalid' };
};

/** "2024-03-07" -> "07.03.2024" (uk) / "03/07/2024" (en). Time zones cannot shift it: it is a calendar date. */
export const formatDate = (iso: string, locale: AppLocale): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !isoDate(iso)) return iso;
  const { order, sep } = dateOrder(locale);
  const f = { year: m[1]!, month: m[2]!, day: m[3]! };
  return order.map((o) => f[o]).join(sep);
};

export const datePlaceholder = (locale: AppLocale): string => {
  const { order, sep } = dateOrder(locale);
  const label =
    locale === 'uk'
      ? { day: 'дд', month: 'мм', year: 'рррр' }
      : { day: 'dd', month: 'mm', year: 'yyyy' };
  return order.map((o) => label[o]).join(sep);
};
