import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { EditableField, ProductFilter } from '@catalog/shared';
import type { TableQuery } from '@/entities/product';
import { ColumnFilter } from '@/features/table-query';
import { GridStoreProvider } from '../model/grid-context';
import { createGridStore } from '../model/grid-store';
import { GridHeader } from './header';

const meta = {
  title: 'Grid/Header',
  decorators: [
    (Story) => (
      <GridStoreProvider store={createGridStore()}>
        <div
          role="grid"
          aria-label="Header preview"
          aria-rowcount={1}
          aria-colcount={9}
          style={{ ['--w-total' as string]: '1500px', overflowX: 'auto' }}
        >
          <Story />
        </div>
      </GridStoreProvider>
    ),
  ],
  render: (a) => (
    <GridHeader
      sort={a.sort}
      onSort={a.onSort}
      renderFilter={(f) => (
        <ColumnFilter field={f} filter={a.filter} locale="en" onChange={a.onFilter} />
      )}
    />
  ),
  args: { sort: null, onSort: fn(), filter: {}, onFilter: fn() },
} satisfies Meta<{
  sort: TableQuery['sort'];
  onSort: (f: EditableField) => void;
  filter: ProductFilter;
  onFilter: (f: ProductFilter) => void;
}>;
export default meta;
type S = StoryObj<typeof meta>;

export const Plain: S = {};
export const SortedDescending: S = {
  args: { sort: { field: 'price', dir: 'desc' } },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('columnheader', { name: /Price/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    ),
};
export const FilterActive: S = {
  args: { filter: { name: 'lamp' } },
  play: async ({ canvasElement }) =>
    expect(
      within(canvasElement).getByRole('button', { name: /Filter by Name, filter active/ }),
    ).toBeInTheDocument(),
};
export const ClickToSort: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sort by Stock' }));
    await expect(args.onSort).toHaveBeenCalledWith('stock');
  },
};
export const OpenFilter: S = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Filter by Price/ }));
    await expect(await within(document.body).findByLabelText('From')).toBeInTheDocument();
  },
};
