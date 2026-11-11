import {
  batchResponseSchema,
  historyResponseSchema,
  productRowSchema,
  type BatchRequestInput,
  type BatchResponse,
  type ChangeResult,
  type HistoryEntry,
  type ProductRow,
  IDEMPOTENCY_HEADER,
} from '@catalog/shared';
import { z } from 'zod';
import { request } from '@/shared/api/http';

export const productKeys = {
  all: ['products'] as const,
  history: (id: string, field?: string) => ['products', 'history', id, field ?? 'all'] as const,
};

const listSchema = z.object({ products: z.array(productRowSchema) });

export const fetchProducts = async (): Promise<ProductRow[]> =>
  (await request('/products', { schema: listSchema })).products;

export const patchBatch = (
  body: BatchRequestInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<BatchResponse> =>
  request('/products/batch', {
    method: 'PATCH',
    body,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
    schema: batchResponseSchema,
    signal,
  });

export const fetchHistory = async (id: string, field?: string): Promise<HistoryEntry[]> =>
  (
    await request(`/products/${id}/history${field ? `?field=${field}&limit=50` : '?limit=50'}`, {
      schema: historyResponseSchema,
    })
  ).entries;

const restoreResponse = z.object({ result: z.object({ status: z.string() }).passthrough() });
export const restoreFromHistory = async (
  changeId: string,
  baseVersion: number,
): Promise<ChangeResult> =>
  (
    await request(`/history/${changeId}/restore`, {
      method: 'POST',
      body: { baseVersion },
      schema: restoreResponse,
    })
  ).result as ChangeResult;
