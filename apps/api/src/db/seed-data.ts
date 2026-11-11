import { CATEGORIES, EDITABLE_FIELDS, type Category, type ProductState } from '@catalog/shared';

/** Deterministic PRNG so every environment gets the same catalogue. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ADJ = [
  'Compact',
  'Premium',
  'Classic',
  'Smart',
  'Eco',
  'Pro',
  'Ultra',
  'Mini',
  'Deluxe',
  'Basic',
];
const NOUN = [
  'Lamp',
  'Kettle',
  'Chair',
  'Router',
  'Backpack',
  'Blender',
  'Monitor',
  'Drill',
  'Puzzle',
  'Notebook',
];
const TAGS = ['new', 'sale', 'hit', 'eco', 'gift', 'limited', 'bestseller', 'import'];

export const SEED_USERS: readonly {
  login: string;
  role: string;
  categories: readonly Category[];
}[] = [
  { login: 'admin', role: 'admin', categories: [] },
  { login: 'editor1', role: 'editor', categories: CATEGORIES.slice(0, 5) },
  { login: 'editor2', role: 'editor', categories: CATEGORIES.slice(5, 10) },
  { login: 'viewer', role: 'viewer', categories: [] },
];

export const PRODUCT_COUNT = 2000;

export const generateProducts = (
  count = PRODUCT_COUNT,
  seed = 20240601,
): (ProductState & { versions: Record<string, number> })[] => {
  const rnd = mulberry32(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
  const zeroVersions = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, 0]));
  return Array.from({ length: count }, (_, i) => {
    const r = rnd();
    const status = r < 0.7 ? 'active' : r < 0.9 ? 'draft' : 'archived';
    // Drafts are sometimes incomplete: that is exactly what the active-requires rule is for.
    const incomplete = status === 'draft' && rnd() < 0.4;
    const priceCents = 100 + Math.floor(rnd() * 99_900);
    const price = incomplete ? null : (priceCents / 100).toFixed(2);
    const hasOld = price !== null && rnd() < 0.25;
    const oldPrice = hasOld
      ? ((priceCents + 50 + Math.floor(rnd() * 5000)) / 100).toFixed(2)
      : null;
    const tags = Array.from(
      new Set(Array.from({ length: Math.floor(rnd() * 4) }, () => pick(TAGS))),
    );
    const day = new Date(Date.UTC(2024, 0, 1) + Math.floor(rnd() * 700) * 86_400_000);
    return {
      // Round-robin keeps categories evenly sized (100 each) so permission tests are predictable.
      category: incomplete && rnd() < 0.5 ? null : CATEGORIES[i % CATEGORIES.length]!,
      sku: `SKU-${String(i + 1).padStart(5, '0')}`,
      name: `${pick(ADJ)} ${pick(NOUN)} ${i + 1}`,
      price,
      oldPrice,
      stock: Math.floor(rnd() * 500),
      status,
      tags,
      arrivalDate: day.toISOString().slice(0, 10),
      versions: { ...zeroVersions },
    };
  });
};
