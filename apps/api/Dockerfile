# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# 1. all dependencies (cached while manifests do not change)
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @catalog/api...

# 2. build the bundle (the shared package ships TypeScript and is bundled in)
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @catalog/api build

# 3. production-only dependencies
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @catalog/api...

# 4. runtime: small, unprivileged. The repo layout is kept because pnpm's node_modules are symlinks.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production MIGRATIONS_DIR=/repo/apps/api/drizzle
WORKDIR /repo/apps/api
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY apps/api/package.json ./
USER node
EXPOSE 4000
# Migrations + seed run first (guarded by an advisory lock, so once even if several replicas start),
# then the server replaces the shell (exec) so SIGTERM reaches Node directly.
CMD ["sh", "-c", "node dist/bootstrap.js && exec node dist/main.js"]
