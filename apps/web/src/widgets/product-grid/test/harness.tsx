import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeSource, Me, ProductRow } from '@catalog/shared';
import type { CellEdit } from '@/features/edit-cell';
import type { TableQuery } from '@/entities/product';
import { ProductGrid, type GridCommand, type GridStore } from '..';
import type { AppLocale } from '@/shared/lib/locale';

export const ADMIN: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  login: 'admin',
  role: 'admin',
  categories: [],
};
export const VIEWER: Me = {
  id: '44444444-4444-4444-8444-444444444444',
  login: 'viewer',
  role: 'viewer',
  categories: [],
};
export const EDITOR: Me = {
  id: '22222222-2222-4222-8222-222222222222',
  login: 'editor1',
  role: 'editor',
  categories: ['electronics', 'computers', 'phones', 'home-appliances', 'furniture'],
};

export type Harness = {
  commits: { edits: CellEdit[]; source: ChangeSource }[];
  commands: string[];
  setRows: (rows: ProductRow[]) => void;
  /** Called by the grid wrapper so tests can push new rows in from outside (e.g. a server refetch). */
  attach: (fn: (rows: ProductRow[]) => void) => void;
};

/** Grid wired like the page does it: an edit updates the row (optimistically) and is recorded. */
export const TestGrid = ({
  initial,
  me = ADMIN,
  locale = 'en',
  store,
  sort = null,
  onSort = () => {},
  probe,
  height = 540,
}: {
  initial: ProductRow[];
  me?: Me;
  locale?: AppLocale;
  store?: GridStore;
  sort?: TableQuery['sort'];
  onSort?: (f: never) => void;
  probe: Harness;
  height?: number;
}) => {
  const [rows, setRows] = useState(initial);
  useEffect(() => probe.attach(setRows), [probe]);
  const order = useMemo(() => rows.map((r) => r.id), [rows]);
  const commit = useCallback(
    (edits: CellEdit[], source: ChangeSource) => {
      probe.commits.push({ edits, source });
      setRows((cur) => {
        const byId = new Map(edits.map((e) => [e.id, [] as CellEdit[]]));
        for (const e of edits) byId.get(e.id)!.push(e);
        return cur.map((r) =>
          byId.has(r.id)
            ? ({
                ...r,
                ...Object.fromEntries(byId.get(r.id)!.map((e) => [e.field, e.value])),
              } as ProductRow)
            : r,
        );
      });
    },
    [probe],
  );
  return (
    <div style={{ height }}>
      <ProductGrid
        rows={rows}
        order={order}
        me={me}
        locale={locale}
        sort={sort}
        onSort={onSort as never}
        commit={commit}
        onCommand={(c: GridCommand) => probe.commands.push(c.type)}
        store={store}
        initialViewportHeight={height}
      />
    </div>
  );
};

export const newProbe = (): Harness => {
  const probe: Harness = {
    commits: [],
    commands: [],
    setRows: () => {},
    attach: (fn) => {
      probe.setRows = fn;
    },
  };
  return probe;
};
