import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, within } from 'storybook/test';
import { JobPanel } from './bulk-dialog';

const ID = '00000000-0000-4000-8000-900000000001';
const base = {
  id: ID,
  filter: { category: ['books'], status: ['active'] },
  operation: { type: 'adjust', field: 'price', mode: 'percent', amount: '10' },
  total: 94,
  processed: 94,
  applied: 90,
  skipped: 4,
  revertedCount: 0,
  author: { id: '11111111-1111-4111-8111-111111111111', login: 'admin' },
  createdAt: '2025-03-04T10:00:00Z',
  finishedAt: '2025-03-04T10:00:05Z',
  report: [
    {
      productId: '00000000-0000-4000-8000-000000000010',
      sku: 'SKU-00010',
      reason: 'invalid',
      message: 'oldPrice must be greater than price',
    },
    {
      productId: '00000000-0000-4000-8000-000000000090',
      sku: 'SKU-00090',
      reason: 'forbidden',
      message: 'Product is in a category you cannot edit',
    },
  ],
  revertReport: [],
};
const serve = (job: object) => ({
  msw: { handlers: [http.get('*/api/bulk-jobs/:id', () => HttpResponse.json(job))] },
});

const meta = {
  title: 'Features/Bulk job',
  component: JobPanel,
  args: { jobId: ID, onFinished: fn(), onNew: fn() },
} satisfies Meta<typeof JobPanel>;
export default meta;
type S = StoryObj<typeof meta>;

export const Running: S = {
  parameters: serve({
    ...base,
    status: 'running',
    processed: 40,
    applied: 38,
    skipped: 2,
    finishedAt: null,
    report: [],
  }),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '43');
    await expect(c.getByTestId('job-status')).toHaveTextContent('Running');
    await expect(c.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  },
};
export const DoneWithReport: S = {
  parameters: serve({ ...base, status: 'done' }),
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Done')).toBeInTheDocument();
    const report = c.getByRole('region', { name: 'Skipped products' });
    await expect(within(report).getByText('SKU-00010')).toBeInTheDocument();
    await expect(within(report).getByText('No permission')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Revert' })).toBeInTheDocument();
    await expect(args.onFinished).toHaveBeenCalled();
  },
};
export const Cancelled: S = {
  parameters: serve({ ...base, status: 'cancelled', processed: 50, applied: 48, skipped: 2 }),
  play: async ({ canvasElement }) =>
    expect(await within(canvasElement).findByText('Cancelled')).toBeInTheDocument(),
};
export const RevertedWithLeftovers: S = {
  parameters: serve({
    ...base,
    status: 'reverted',
    revertedCount: 89,
    revertReport: [
      {
        productId: '00000000-0000-4000-8000-000000000050',
        sku: 'SKU-00050',
        reason: 'changed_since',
        message: 'price was changed after the job',
      },
    ],
  }),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Reverted')).toBeInTheDocument();
    const rep = c.getByRole('region', { name: 'Not reverted' });
    await expect(within(rep).getByText('Changed after the job')).toBeInTheDocument();
  },
};
export const StartAnother: S = {
  parameters: serve({ ...base, status: 'done' }),
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'New bulk change' }),
    );
    await expect(args.onNew).toHaveBeenCalled();
  },
};
export const LoadError: S = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/bulk-jobs/:id', () =>
          HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) =>
    expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Could not load the job.',
    ),
};
