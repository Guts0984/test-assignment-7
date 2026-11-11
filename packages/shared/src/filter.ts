import type { ProductFilter } from './bulk';
import { compareDecimal } from './decimal';
import type { ProductState } from './product';

const contains = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

/**
 * The one definition of what a filter means. The API mirrors it in SQL; the grid uses this function.
 * Empty rows are excluded by any condition on that column (a NULL price is not "within" a range).
 */
export const matchesFilter = (p: ProductState, f: ProductFilter): boolean => {
  if (f.sku && !contains(p.sku, f.sku)) return false;
  if (f.name && !contains(p.name, f.name)) return false;
  if (f.category?.length && (p.category === null || !f.category.includes(p.category))) return false;
  if (f.status?.length && !f.status.includes(p.status)) return false;
  if (f.priceMin !== undefined && (p.price === null || compareDecimal(p.price, f.priceMin) < 0))
    return false;
  if (f.priceMax !== undefined && (p.price === null || compareDecimal(p.price, f.priceMax) > 0))
    return false;
  if (f.stockMin !== undefined && p.stock < f.stockMin) return false;
  if (f.stockMax !== undefined && p.stock > f.stockMax) return false;
  return true;
};
