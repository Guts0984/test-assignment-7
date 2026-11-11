export { COLUMNS, COLUMN_BY_FIELD, type ColumnDef, type ColumnKind } from './model/columns';
export { canEditRow, canSetCategory } from './model/permissions';
export {
  parseCellInput,
  displayText,
  editText,
  crossFieldErrors,
  type CellError,
  type Parsed,
} from './lib/cell-input';
export {
  EMPTY_QUERY,
  SORTABLE_FIELDS,
  hasActiveFilter,
  nextSort,
  parseQuery,
  queryEquals,
  serializeQuery,
  type SortDir,
  type TableQuery,
} from './lib/table-query';
export { computeOrder, makeCollator, compareField, type Labeler } from './lib/sort';
export {
  fetchHistory,
  fetchProducts,
  patchBatch,
  productKeys,
  restoreFromHistory,
} from './api/products-api';
