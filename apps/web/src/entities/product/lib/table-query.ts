import {
  CATEGORIES,
  PRODUCT_STATUSES,
  isDecimalString,
  type ProductFilter,
  type EditableField,
} from '@catalog/shared';

export type SortDir = 'asc' | 'desc';
export const SORTABLE_FIELDS: readonly EditableField[] = [
  'sku',
  'name',
  'category',
  'price',
  'oldPrice',
  'stock',
  'status',
  'tags',
  'arrivalDate',
];

/** Everything the toolbar/headers can change; lives in the URL so reload and Back restore it. */
export type TableQuery = {
  sort: { field: EditableField; dir: SortDir } | null;
  filter: ProductFilter;
};

export const EMPTY_QUERY: TableQuery = { sort: null, filter: {} };

const list = (v: string | null): string[] =>
  v
    ? v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
const intOrUndef = (v: string | null): number | undefined => {
  if (v === null || !/^\d{1,10}$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : undefined;
};
const decOrUndef = (v: string | null): string | undefined =>
  v !== null && isDecimalString(v) ? v : undefined;

/** Lenient on purpose: a hand-edited or stale URL must never break the page; bad parts are dropped. */
export const parseQuery = (params: URLSearchParams): TableQuery => {
  const sortField = params.get('sort') as EditableField | null;
  const dir = params.get('dir');
  const sort =
    sortField && SORTABLE_FIELDS.includes(sortField)
      ? { field: sortField, dir: (dir === 'desc' ? 'desc' : 'asc') as SortDir }
      : null;

  const filter: ProductFilter = {};
  const sku = params.get('sku')?.slice(0, 100);
  const name = params.get('name')?.slice(0, 200);
  if (sku) filter.sku = sku;
  if (name) filter.name = name;
  const category = list(params.get('category')).filter((c): c is (typeof CATEGORIES)[number] =>
    (CATEGORIES as readonly string[]).includes(c),
  );
  if (category.length) filter.category = category;
  const status = list(params.get('status')).filter((s): s is (typeof PRODUCT_STATUSES)[number] =>
    (PRODUCT_STATUSES as readonly string[]).includes(s),
  );
  if (status.length) filter.status = status;
  const priceMin = decOrUndef(params.get('priceMin'));
  const priceMax = decOrUndef(params.get('priceMax'));
  const stockMin = intOrUndef(params.get('stockMin'));
  const stockMax = intOrUndef(params.get('stockMax'));
  if (priceMin !== undefined) filter.priceMin = priceMin;
  if (priceMax !== undefined) filter.priceMax = priceMax;
  if (stockMin !== undefined) filter.stockMin = stockMin;
  if (stockMax !== undefined) filter.stockMax = stockMax;
  return { sort, filter };
};

/** Canonical form (stable key order, defaults omitted) so equal states give equal URLs. */
export const serializeQuery = (q: TableQuery): URLSearchParams => {
  const p = new URLSearchParams();
  if (q.sort) {
    p.set('sort', q.sort.field);
    if (q.sort.dir === 'desc') p.set('dir', 'desc');
  }
  const f = q.filter;
  if (f.sku) p.set('sku', f.sku);
  if (f.name) p.set('name', f.name);
  if (f.category?.length) p.set('category', f.category.join(','));
  if (f.status?.length) p.set('status', f.status.join(','));
  if (f.priceMin !== undefined) p.set('priceMin', f.priceMin);
  if (f.priceMax !== undefined) p.set('priceMax', f.priceMax);
  if (f.stockMin !== undefined) p.set('stockMin', String(f.stockMin));
  if (f.stockMax !== undefined) p.set('stockMax', String(f.stockMax));
  return p;
};

export const queryEquals = (a: TableQuery, b: TableQuery): boolean =>
  serializeQuery(a).toString() === serializeQuery(b).toString();

export const hasActiveFilter = (f: ProductFilter): boolean => Object.keys(f).length > 0;

/** Click on a header: none -> asc -> desc -> none. */
export const nextSort = (cur: TableQuery['sort'], field: EditableField): TableQuery['sort'] => {
  if (!cur || cur.field !== field) return { field, dir: 'asc' };
  return cur.dir === 'asc' ? { field, dir: 'desc' } : null;
};
