import type { EditableField, ProductRow } from '@catalog/shared';

export type RowPatch = { id: string; field: EditableField; value?: unknown; version?: number };

/**
 * Returns a new rows array in which ONLY the touched rows are new objects. Every other row keeps its
 * identity, which is what lets memoised rows/cells skip re-rendering. Nothing is mutated.
 */
export const patchRows = (
  rows: readonly ProductRow[],
  patches: readonly RowPatch[],
): ProductRow[] => {
  if (patches.length === 0) return rows as ProductRow[];
  const byId = new Map<string, RowPatch[]>();
  for (const p of patches) {
    const list = byId.get(p.id);
    if (list) list.push(p);
    else byId.set(p.id, [p]);
  }
  let changed = false;
  const next = rows.map((r) => {
    const ps = byId.get(r.id);
    if (!ps) return r;
    let row: ProductRow = r;
    for (const p of ps) {
      const valueChanged = 'value' in p && JSON.stringify(row[p.field]) !== JSON.stringify(p.value);
      const versionChanged = p.version !== undefined && row.versions[p.field] !== p.version;
      if (!valueChanged && !versionChanged) continue;
      row = {
        ...row,
        ...(valueChanged ? { [p.field]: p.value } : {}),
        versions: versionChanged ? { ...row.versions, [p.field]: p.version! } : row.versions,
      } as ProductRow;
    }
    if (row !== r) changed = true;
    return row;
  });
  return changed ? next : (rows as ProductRow[]);
};
