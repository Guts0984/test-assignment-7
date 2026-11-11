import { CATEGORIES, PRODUCT_STATUSES, type EditableField } from '@catalog/shared';

export type ColumnKind = 'text' | 'integer' | 'decimal' | 'date' | 'select' | 'tags';
export type FilterKind = 'text' | 'range' | 'select';

export type ColumnDef = {
  field: EditableField;
  kind: ColumnKind;
  width: number;
  minWidth: number;
  align: 'left' | 'right';
  nullable: boolean;
  /** Options for select columns (machine values; labels come from i18n). */
  options?: readonly string[];
  filter: FilterKind | null;
};

/** Left-to-right order of the grid. `sku` is first on purpose: it is the pinned column. */
export const COLUMNS: readonly ColumnDef[] = [
  {
    field: 'sku',
    kind: 'text',
    width: 130,
    minWidth: 90,
    align: 'left',
    nullable: false,
    filter: 'text',
  },
  {
    field: 'name',
    kind: 'text',
    width: 240,
    minWidth: 120,
    align: 'left',
    nullable: false,
    filter: 'text',
  },
  {
    field: 'category',
    kind: 'select',
    width: 160,
    minWidth: 110,
    align: 'left',
    nullable: true,
    options: CATEGORIES,
    filter: 'select',
  },
  {
    field: 'price',
    kind: 'decimal',
    width: 120,
    minWidth: 90,
    align: 'right',
    nullable: true,
    filter: 'range',
  },
  {
    field: 'oldPrice',
    kind: 'decimal',
    width: 120,
    minWidth: 90,
    align: 'right',
    nullable: true,
    filter: null,
  },
  {
    field: 'stock',
    kind: 'integer',
    width: 100,
    minWidth: 80,
    align: 'right',
    nullable: false,
    filter: 'range',
  },
  {
    field: 'status',
    kind: 'select',
    width: 120,
    minWidth: 100,
    align: 'left',
    nullable: false,
    options: PRODUCT_STATUSES,
    filter: 'select',
  },
  {
    field: 'tags',
    kind: 'tags',
    width: 200,
    minWidth: 100,
    align: 'left',
    nullable: false,
    filter: null,
  },
  {
    field: 'arrivalDate',
    kind: 'date',
    width: 130,
    minWidth: 100,
    align: 'left',
    nullable: true,
    filter: null,
  },
];

export const COLUMN_BY_FIELD = Object.fromEntries(
  COLUMNS.map((c, i) => [c.field, { ...c, index: i }]),
) as Record<EditableField, ColumnDef & { index: number }>;
