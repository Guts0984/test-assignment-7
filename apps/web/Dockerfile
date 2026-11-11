# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @catalog/web...

FROM deps AS build
# The /api -> NestJS rewrite is fixed at build time.
ARG API_INTERNAL_URL=http://api:4000
# Login-page demo hint (same values that seed the users). SHOW_DEMO_LOGINS=false hides it.
ARG SHOW_DEMO_LOGINS=true
ARG SEED_ADMIN_PASSWORD=
ARG SEED_EDITOR1_PASSWORD=
ARG SEED_EDITOR2_PASSWORD=
ARG SEED_VIEWER_PASSWORD=
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1 SHOW_DEMO_LOGINS=$SHOW_DEMO_LOGINS \
    SEED_ADMIN_PASSWORD=$SEED_ADMIN_PASSWORD SEED_EDITOR1_PASSWORD=$SEED_EDITOR1_PASSWORD \
    SEED_EDITOR2_PASSWORD=$SEED_EDITOR2_PASSWORD SEED_VIEWER_PASSWORD=$SEED_VIEWER_PASSWORD
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @catalog/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# Next "standalone" output: only the files the server needs, traced from the monorepo root.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
