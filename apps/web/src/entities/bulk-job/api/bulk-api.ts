import {
  bulkJobSchema,
  previewResponseSchema,
  type BulkJob,
  type CreateBulkJob,
  type ProductFilter,
} from '@catalog/shared';
import { request } from '@/shared/api/http';

export const bulkKeys = {
  preview: (filter: ProductFilter) => ['bulk', 'preview', JSON.stringify(filter)] as const,
  job: (id: string) => ['bulk', 'job', id] as const,
};

export const previewBulk = (filter: ProductFilter) =>
  request('/bulk-jobs/preview', {
    method: 'POST',
    body: { filter },
    schema: previewResponseSchema,
  });

export const createBulkJob = (body: CreateBulkJob): Promise<BulkJob> =>
  request('/bulk-jobs', { method: 'POST', body, schema: bulkJobSchema });

export const getBulkJob = (id: string): Promise<BulkJob> =>
  request(`/bulk-jobs/${id}`, { schema: bulkJobSchema });

export const cancelBulkJob = (id: string): Promise<BulkJob> =>
  request(`/bulk-jobs/${id}/cancel`, { method: 'POST', schema: bulkJobSchema });

export const revertBulkJob = (id: string): Promise<BulkJob> =>
  request(`/bulk-jobs/${id}/revert`, { method: 'POST', schema: bulkJobSchema });

export const ACTIVE_STATUSES = ['queued', 'running', 'cancelling', 'reverting'] as const;
export const isActiveJob = (j: Pick<BulkJob, 'status'>): boolean =>
  (ACTIVE_STATUSES as readonly string[]).includes(j.status);
