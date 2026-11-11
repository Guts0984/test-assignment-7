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
  BULK_CHUNK_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
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
