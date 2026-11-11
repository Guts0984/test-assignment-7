import { CATEGORIES, EDITABLE_FIELDS, type ProductRow } from '@catalog/shared';

/** Deterministic catalogue for tests, Storybook and MSW (same shape and distribution as the real seed). */
export const makeProducts = (count = 2000): ProductRow[] => {
  let a = 20240601;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const zero = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, 0])) as ProductRow['versions'];
  return Array.from({ length: count }, (_, i) => {
    const r = rnd();
    const status = r < 0.7 ? 'active' : r < 0.9 ? 'draft' : 'archived';
    const incomplete = status === 'draft' && rnd() < 0.4;
    const cents = 100 + Math.floor(rnd() * 99_900);
    const price = incomplete ? null : (cents / 100).toFixed(2);
    const oldPrice =
      price !== null && rnd() < 0.25
        ? ((cents + 50 + Math.floor(rnd() * 5000)) / 100).toFixed(2)
        : null;
    const n = String(i + 1);
    return {
      id: `00000000-0000-4000-8000-${n.padStart(12, '0')}`,
      sku: `SKU-${n.padStart(5, '0')}`,
      name: `${pick(['Compact', 'Premium', 'Smart', 'Eco', 'Pro'])} ${pick(['Lamp', 'Kettle', 'Chair', 'Router', 'Drill'])} ${n}`,
      category: incomplete && rnd() < 0.5 ? null : CATEGORIES[i % CATEGORIES.length]!,
      price,
      oldPrice,
      stock: Math.floor(rnd() * 500),
      status,
      tags: rnd() < 0.5 ? [pick(['new', 'sale', 'hit', 'eco'])] : [],
      arrivalDate: new Date(Date.UTC(2024, 0, 1) + Math.floor(rnd() * 700) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      versions: { ...zero },
    };
  });
};
