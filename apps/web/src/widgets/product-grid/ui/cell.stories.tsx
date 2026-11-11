import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { cellKey } from '@/entities/product';
import { GridStoreProvider } from '../model/grid-context';
import { createGridStore, type GridState } from '../model/grid-store';
import { Cell } from './cell';

type Args = {
  field: 'name' | 'price' | 'stock' | 'status' | 'tags';
  value: unknown;
  readOnly: boolean;
  colIndex: number;
  state: Partial<GridState>;
};

/** One cell in a minimal grid frame, with the given store state (selection, editing, error, saving, conflict). */
const withGrid: Decorator<Args> = (Story, ctx) => {
  const store = createGridStore(ctx.args.state);
  return (
    <GridStoreProvider store={store}>
      <div
        role="grid"
        aria-label="Cell preview"
        aria-rowcount={1}
        aria-colcount={9}
        style={{
          ['--w-0' as string]: '120px',
          ['--w-1' as string]: '220px',
          ['--w-3' as string]: '120px',
          ['--w-5' as string]: '100px',
          ['--w-6' as string]: '120px',
          ['--w-7' as string]: '200px',
        }}
      >
        <div role="row" aria-rowindex={1} style={{ display: 'flex', height: 36 }}>
          <Story />
        </div>
      </div>
    </GridStoreProvider>
  );
};

const KEY = (field: string) => cellKey('row-1', field as never);
const noop = () => undefined;
const selected = {
  active: { row: 0, col: 1 },
  anchor: { row: 0, col: 1 },
  focus: { row: 0, col: 1 },
};

const meta = {
  title: 'Grid/Cell',
  decorators: [withGrid],
  render: (a) => (
    <Cell
      gridId="story"
      rowIndex={0}
      colIndex={a.colIndex}
      rowId="row-1"
      field={a.field}
      value={a.value}
      readOnly={a.readOnly}
      locale="en"
      onCommitEdit={noop}
      onCancelEdit={noop}
    />
  ),
  args: { field: 'name', value: 'Compact Lamp', readOnly: false, colIndex: 1, state: {} },
} satisfies Meta<Args>;
export default meta;
type S = StoryObj<typeof meta>;

export const Default: S = {};
export const Selected: S = {
  args: { state: { selection: selected } },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('gridcell')).toHaveAttribute('aria-selected', 'true'),
};
export const ReadOnly: S = {
  args: { readOnly: true },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('gridcell')).toHaveAttribute('aria-readonly', 'true'),
};
export const Editing: S = {
  args: {
    state: {
      selection: selected,
      editing: { pos: { row: 0, col: 1 }, draft: 'Compact Lamp 2', origin: 'open' },
    },
  },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Compact Lamp 2',
    ),
};
export const WithError: S = {
  args: {
    field: 'stock',
    colIndex: 5,
    value: 5,
    state: {
      selection: {
        active: { row: 0, col: 5 },
        anchor: { row: 0, col: 5 },
        focus: { row: 0, col: 5 },
      },
      errors: { [KEY('stock')]: { code: 'notInteger', field: 'stock' } },
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('gridcell')).toHaveAttribute('aria-invalid', 'true');
    await expect(c.getByRole('tooltip')).toHaveTextContent('Enter a whole number.');
  },
};
export const InConflict: S = {
  args: {
    state: {
      conflicts: {
        [KEY('name')]: { mine: 'Mine', theirs: 'Theirs', theirsVersion: 2, author: 'bob' },
      },
    },
  },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('gridcell').getAttribute('aria-label')).toMatch(
      /conflict/,
    ),
};
export const Saving: S = {
  args: { state: { saving: { [KEY('name')]: true } } },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('gridcell')).toHaveAttribute('aria-busy', 'true'),
};
export const Number: S = {
  args: { field: 'price', colIndex: 3, value: '1234.50' },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('gridcell')).toHaveTextContent('1,234.50'),
};
export const Tags: S = { args: { field: 'tags', colIndex: 7, value: ['new', 'sale'] } };
