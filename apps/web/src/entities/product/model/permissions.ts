import { canEditCategory, type Me, type ProductRow } from '@catalog/shared';

/** Mirrors the server rule so read-only cells look read-only. The server still decides. */
export const canEditRow = (
  me: Pick<Me, 'role' | 'categories'> | null | undefined,
  row: Pick<ProductRow, 'category'>,
): boolean => !!me && canEditCategory(me, row.category);

/** An editor may not move a product into a category they do not edit, nor clear its category. */
export const canSetCategory = (
  me: Pick<Me, 'role' | 'categories'>,
  category: string | null,
): boolean =>
  me.role === 'admin' ||
  (me.role === 'editor' && category !== null && me.categories.includes(category));
