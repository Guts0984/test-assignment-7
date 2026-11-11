import { and, inArray, sql, type SQL } from 'drizzle-orm';
import type { ProductFilter } from '@catalog/shared';
import { products } from '../db/schema';

/** Values are always bound parameters; only the LIKE metacharacters need neutralising. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/** SQL twin of `matchesFilter` from @catalog/shared (a test keeps them in agreement). */
export const filterWhere = (f: ProductFilter): SQL | undefined => {
  const c: SQL[] = [];
  if (f.sku) c.push(sql`${products.sku} ilike ${'%' + escapeLike(f.sku) + '%'}`);
  if (f.name) c.push(sql`${products.name} ilike ${'%' + escapeLike(f.name) + '%'}`);
  if (f.category?.length) c.push(inArray(products.category, f.category));
  if (f.status?.length) c.push(inArray(products.status, f.status));
  if (f.priceMin !== undefined) c.push(sql`${products.price} >= ${f.priceMin}::numeric`);
  if (f.priceMax !== undefined) c.push(sql`${products.price} <= ${f.priceMax}::numeric`);
  if (f.stockMin !== undefined) c.push(sql`${products.stock} >= ${f.stockMin}`);
  if (f.stockMax !== undefined) c.push(sql`${products.stock} <= ${f.stockMax}`);
  return c.length ? and(...c) : undefined;
};
