import { randomUUID } from 'node:crypto';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { claimJob, failJob, releaseJob, runChunk } from './process';

/** Connection-level trouble (PostgreSQL restarting, pool timeouts): retry later, never fail the job for it. */
const isInfraError = (e: unknown): boolean => {
  let cur: unknown = e;
  for (let d = 0; d < 3 && typeof cur === 'object' && cur !== null; d++) {
    const o = cur as { code?: string; message?: string; cause?: unknown };
    if (o.code && (/^(08|57|53)/.test(o.code) || /^E(CONN|PIPE|TIMEDOUT|NOTFOUND)/.test(o.code)))
      return true;
    if (
      o.message &&
      /Connection terminated|timeout exceeded when trying to connect|ECONN/i.test(o.message)
    )
      return true;
    cur = o.cause;
  }
  return false;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Worker = { stop: () => Promise<void> };

/**
 * Background job runner (plain functions, no framework). `concurrency` slots poll PostgreSQL;
 * `FOR UPDATE SKIP LOCKED` guarantees two slots (or two api processes) never run the same job.
 * stop() waits for the chunk in flight, releases the lease and returns - jobs resume elsewhere.
 */
export const startWorker = (
  db: Db,
  cfg: Pick<
    Config,
    | 'BULK_CHUNK_SIZE'
    | 'BULK_CHUNK_DELAY_MS'
    | 'BULK_POLL_MS'
    | 'BULK_WORKER_CONCURRENCY'
    | 'JOB_LEASE_SECONDS'
  >,
  log: { warn: (m: string) => void } = { warn: () => undefined },
): Worker => {
  let stopping = false;

  const slot = async (): Promise<void> => {
    const workerId = `${process.pid}-${randomUUID()}`;
    let backoff = cfg.BULK_POLL_MS;
    while (!stopping) {
      let job: { id: string } | null;
      try {
        job = await claimJob(db, workerId, cfg.JOB_LEASE_SECONDS);
        backoff = cfg.BULK_POLL_MS;
      } catch (e) {
        // PostgreSQL restarting etc.: back off and keep the loop alive.
        log.warn(`job claim failed: ${String(e)}`);
        backoff = Math.min(backoff * 2, 5_000);
        await sleep(backoff);
        continue;
      }
      if (!job) {
        await sleep(cfg.BULK_POLL_MS);
        continue;
      }
      let failures = 0;
      while (!stopping) {
        try {
          const r = await runChunk(db, job.id, workerId, {
            chunkSize: cfg.BULK_CHUNK_SIZE,
            leaseSeconds: cfg.JOB_LEASE_SECONDS,
          });
          failures = 0;
          if (r !== 'more') break;
          if (cfg.BULK_CHUNK_DELAY_MS > 0) await sleep(cfg.BULK_CHUNK_DELAY_MS);
        } catch (e) {
          // The chunk transaction rolled back as a whole; retrying is safe. Give up on this claim after a few tries
          // (another claim, e.g. after the DB is back, continues from the same place).
          log.warn(`chunk failed (job ${job.id}): ${String(e)}`);
          if (!isInfraError(e) && ++failures >= 5) {
            await failJob(db, job.id, workerId).catch(() => undefined);
            break;
          }
          if (isInfraError(e)) failures = 0;
          await sleep(Math.min(250 * 2 ** failures, 5_000));
        }
      }
      await releaseJob(db, job.id, workerId).catch(() => undefined);
    }
  };

  const slots = Array.from({ length: cfg.BULK_WORKER_CONCURRENCY }, () => slot());
  return {
    stop: async () => {
      stopping = true;
      await Promise.all(slots);
    },
  };
};
