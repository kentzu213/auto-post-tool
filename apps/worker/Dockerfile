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
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/eslint-config/package.json ./packages/eslint-config/

# Cài đặt dependencies cho monorepo
RUN pnpm install --frozen-lockfile

# Copy toàn bộ mã nguồn
COPY . .

# Generate Prisma Client cho Worker
WORKDIR /app/apps/worker
RUN pnpm exec prisma generate --schema=./prisma/schema.prisma

# Build dự án Worker qua Turborepo (build dependencies first via the `...` suffix).
WORKDIR /app
RUN pnpm --filter @auto-post/worker... build

# --- Stage 2: Runner ---
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

# CÀI ĐẶT FFMPEG THỰC TẾ CHO CONTAINER RUNNER
# (fixed invalid `--no-image-history` flag -> plain `apk add --no-cache ffmpeg`)
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production

# Build metadata injected by CI (non-secret build args, Req 1.7).
ARG COMMIT_SHA
ARG BUILD_ID
ENV APP_COMMIT_SHA=$COMMIT_SHA
ENV APP_BUILD_ID=$BUILD_ID

# Copy built files và dependencies, owned by the unprivileged 'node' user (Req 1.4).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=node:node /app/apps/worker/prisma ./apps/worker/prisma
COPY --from=builder --chown=node:node /app/packages ./packages

# Run as the non-root 'node' user shipped by the official base image (uid 1000) (Req 1.4).
# ffmpeg scratch under /tmp is world-writable by default, so 'node' can write there.
USER node

# No HEALTHCHECK: the worker is a BullMQ queue consumer with no inbound port (nothing to curl).
CMD ["node", "apps/worker/dist/index.js"]
