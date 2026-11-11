import { bulkJobSchema, type BulkJob, type CreateBulkJob } from '@catalog/shared';
import { call } from './http';
import type { Session } from './api';
import type { TestServer } from './server';

export const createJob = (s: { baseUrl: string }, ses: Session, body: unknown) =>
  call(s.baseUrl, 'POST', '/bulk-jobs', { cookie: ses.cookie, body });

export const startJob = async (
  s: { baseUrl: string },
  ses: Session,
  body: CreateBulkJob,
): Promise<BulkJob> => {
  const r = await createJob(s, ses, body);
  if (r.status !== 201) throw new Error(`create job failed ${r.status}: ${r.raw}`);
  return bulkJobSchema.parse(r.body);
};

export const getJob = async (
  s: { baseUrl: string },
  ses: Session,
  id: string,
): Promise<BulkJob> => {
  const r = await call(s.baseUrl, 'GET', `/bulk-jobs/${id}`, { cookie: ses.cookie });
  if (r.status !== 200) throw new Error(`get job ${r.status}: ${r.raw}`);
  return bulkJobSchema.parse(r.body);
};

export const waitJob = async (
  s: { baseUrl: string },
  ses: Session,
  id: string,
  pred: (j: BulkJob) => boolean,
  timeoutMs = 30_000,
): Promise<BulkJob> => {
  const t0 = Date.now();
  for (;;) {
    const j = await getJob(s, ses, id);
    if (pred(j)) return j;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(
        `timeout waiting for job ${id}; last: ${JSON.stringify({ ...j, report: undefined })}`,
      );
    await new Promise((r) => setTimeout(r, 40));
  }
};

export const terminal = (j: BulkJob) =>
  ['done', 'cancelled', 'failed', 'reverted'].includes(j.status);

export const post = (
  s: TestServer | { baseUrl: string },
  ses: Session,
  path: string,
  body?: unknown,
) => call(s.baseUrl, 'POST', path, { cookie: ses.cookie, body });
