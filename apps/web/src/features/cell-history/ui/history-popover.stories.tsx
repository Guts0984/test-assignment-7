import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import { HistoryPopover } from './history-popover';

const entries = [
  {
    id: '3',
    productId: '00000000-0000-4000-8000-000000000001',
    field: 'price',
    oldValue: '120.00',
    newValue: '132.00',
    version: 3,
    source: 'bulk',
    author: { id: '11111111-1111-4111-8111-111111111111', login: 'admin' },
    jobId: null,
    createdAt: '2025-03-04T10:15:00Z',
  },
  {
    id: '2',
    productId: '00000000-0000-4000-8000-000000000001',
    field: 'price',
    oldValue: '100.00',
    newValue: '120.00',
    version: 2,
    source: 'edit',
    author: { id: '33333333-3333-4333-8333-333333333333', login: 'bob' },
    jobId: null,
    createdAt: '2025-03-01T09:00:00Z',
  },
];

const meta = {
  title: 'Features/Cell history',
  component: HistoryPopover,
  args: {
    rect: { left: 200, top: 60, width: 120, height: 36 },
    open: true,
    onOpenChange: fn(),
    productId: '00000000-0000-4000-8000-000000000001',
    field: 'price',
    currentVersion: 3,
    canRestore: true,
    locale: 'en',
    onRestored: fn(),
  },
  parameters: {
    msw: {
      handlers: [http.get('*/api/products/:id/history', () => HttpResponse.json({ entries }))],
    },
  },
} satisfies Meta<typeof HistoryPopover>;
export default meta;
type S = StoryObj<typeof meta>;

export const WithEntries: S = {
  play: async () => {
    const pop = await within(document.body).findByRole('dialog', { name: 'History: Price' });
    const items = await within(pop).findAllByRole('listitem');
    await expect(items).toHaveLength(2);
    await expect(items[0]).toHaveTextContent('by admin');
    await expect(items[0]).toHaveTextContent('120.00'); // was
    await expect(items[0]).toHaveTextContent('132.00'); // now
  },
};
export const ReadOnlyViewer: S = {
  args: { canRestore: false },
  play: async () => {
    const pop = await within(document.body).findByRole('dialog', { name: 'History: Price' });
    await within(pop).findAllByRole('listitem');
    await expect(within(pop).queryByRole('button', { name: /Restore/ })).toBeNull();
  },
};
export const Empty: S = {
  parameters: {
    msw: {
      handlers: [http.get('*/api/products/:id/history', () => HttpResponse.json({ entries: [] }))],
    },
  },
  play: async () =>
    expect(await within(document.body).findByText('No changes yet.')).toBeInTheDocument(),
};
export const LoadError: S = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/products/:id/history', () =>
          HttpResponse.json({ error: { code: 'internal_error', message: 'x' } }, { status: 500 }),
        ),
      ],
    },
  },
  play: async () =>
    expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Could not load the history.',
    ),
};
