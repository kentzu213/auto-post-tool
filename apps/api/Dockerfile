# syntax=docker/dockerfile:1

# Pinned Node 20 base image (immutable): version tag for readability + @sha256 digest for
# reproducibility (Req 1.3 - never floating :latest / :20). Digest resolved from Docker Hub
# library/node:20.18.1-alpine3.21 (multi-arch manifest list). Bump deliberately in CI, never float.
ARG NODE_IMAGE=node:20.18.1-alpine3.21@sha256:24fb6aa7020d9a20b00d6da6d1714187c45ed00d1eb4adb01395843c338b9372

# --- Stage 1: Build ---
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# Cài đặt pnpm toàn cục (pinned to repo packageManager for reproducible builds - Req 1.6)
RUN npm install -g pnpm@9.1.0

# Copy files cấu hình Monorepo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/eslint-config/package.json ./packages/eslint-config/

# Cài đặt dependencies cho monorepo
RUN pnpm install --frozen-lockfile

# Copy toàn bộ mã nguồn
COPY . .

# Generate Prisma Client cho NestJS
WORKDIR /app/apps/api
RUN pnpm exec prisma generate --schema=./prisma/schema.prisma

# Build dự án API qua Turborepo (build dependencies first via the `...` suffix,
# so workspace packages like @auto-post/shared-types are compiled before the API).
WORKDIR /app
RUN pnpm --filter @auto-post/api... build

# --- Stage 2: Runner ---
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

# Thiết lập môi trường Production
ENV NODE_ENV=production

# Build metadata injected by CI (non-secret build args, Req 1.7) -> read by the /version endpoint.
ARG COMMIT_SHA
ARG BUILD_ID
ENV APP_COMMIT_SHA=$COMMIT_SHA
ENV APP_BUILD_ID=$BUILD_ID

# curl is required by the container HEALTHCHECK below (Req 1.8)
RUN apk add --no-cache curl

# Copy built files và dependencies, owned by the unprivileged 'node' user so they are readable
# at runtime (Req 1.4).
# NOTE (tradeoff): we copy the full monorepo node_modules instead of `pnpm deploy --prod`.
# pnpm's symlinked workspace store makes a pruned --prod deploy brittle for this layout, so we
# keep the proven copy rather than risk a broken image. Dev deps are present but never executed
# at runtime; slimming the image via `pnpm deploy --prod` is a follow-up once verified on a real build.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=node:node /app/packages ./packages

# Run as the non-root 'node' user shipped by the official base image (uid 1000) (Req 1.4)
USER node

EXPOSE 3001

# Container healthcheck hits the liveness Health_Endpoint (Req 1.8).
# NOTE: /health/live is introduced in task 2.1; the HEALTHCHECK line is correct to add now.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3001/health/live || exit 1

# Entrypoint: `nest build` (sourceRoot: src) emits the compiled entry at
# dist/src/main.js, but some nest/tsc layouts emit dist/main.js. Pick whichever
# exists at runtime so the image is robust to either layout.
CMD ["sh", "-c", "if [ -f apps/api/dist/src/main.js ]; then exec node apps/api/dist/src/main.js; else exec node apps/api/dist/main.js; fi"]
