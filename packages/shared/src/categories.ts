export const CATEGORIES = [
  'electronics',
  'computers',
  'phones',
  'home-appliances',
  'furniture',
  'kitchen',
  'garden',
  'tools',
  'toys',
  'books',
  'clothing',
  'shoes',
  'sports',
  'outdoor',
  'beauty',
  'health',
  'grocery',
  'pet-supplies',
  'auto',
  'office',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
