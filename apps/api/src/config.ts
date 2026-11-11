import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .default(24 * 7),
  LOGIN_IP_LIMIT: z.coerce.number().int().min(1).default(30),
  LOGIN_PAIR_LIMIT: z.coerce.number().int().min(1).default(5),
  LOGIN_ACCOUNT_LIMIT: z.coerce.number().int().min(1).default(100),
  LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(1).default(900),
  /** How long in-flight requests may keep running after SIGTERM before connections are cut. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(100).default(20_000),
  BULK_CHUNK_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  /** Artificial pause between chunks; 0 in production, used by tests to catch a job mid-flight. */
  BULK_CHUNK_DELAY_MS: z.coerce.number().int().min(0).default(0),
  BULK_POLL_MS: z.coerce.number().int().min(10).default(250),
  BULK_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** A job whose worker vanished (kill -9) becomes claimable again after this many seconds. */
  JOB_LEASE_SECONDS: z.coerce.number().int().min(1).default(30),
  BULK_MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).default(10),
  BULK_WORKER_ENABLED: bool.default(true),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_EDITOR1_PASSWORD: z.string().min(8).optional(),
  SEED_EDITOR2_PASSWORD: z.string().min(8).optional(),
  SEED_VIEWER_PASSWORD: z.string().min(8).optional(),
});

export type Config = z.infer<typeof envSchema>;

/** Fails fast with a readable message on a bad environment. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const r = envSchema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  return r.data;
};
