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

# Copy files cấu hình Monorepo (.npmrc carries node-linker=hoisted so the install
# produces a flat root node_modules the runner image can use).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/eslint-config/package.json ./packages/eslint-config/

# Cài đặt dependencies cho monorepo
RUN pnpm install --frozen-lockfile

# Copy toàn bộ mã nguồn
COPY . .

# Next.js inlines NEXT_PUBLIC_* at BUILD time, so the browser-facing API base URL
# must be provided as a build arg for a hosted deploy (else it falls back to
# http://localhost:3001 and the shipped app cannot reach the API). Passed by CI /
# the VPS bootstrap as --build-arg NEXT_PUBLIC_API_URL=https://api.<host>.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Supabase Auth (izziapi.com sync) is also NEXT_PUBLIC_* → must be baked at build.
# When set, the login page authenticates against izziapi.com's Supabase and the
# API verifies the token via /auth/supabase-sync. When empty, the app falls back
# to local email/password auth. Public values (anon key is client-safe).
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Build dự án NextJS qua Turborepo (build dependencies first via the `...` suffix).
RUN pnpm --filter @auto-post/web... build

# --- Stage 2: Runner ---
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

ENV NODE_ENV=production

# Build metadata injected by CI (non-secret build args, Req 1.7).
ARG COMMIT_SHA
ARG BUILD_ID
ENV APP_COMMIT_SHA=$COMMIT_SHA
ENV APP_BUILD_ID=$BUILD_ID

# curl is required by the container HEALTHCHECK below (Req 1.8)
RUN apk add --no-cache curl

# Copy only the Next.js build output, public assets, deps and manifest, owned by 'node' (Req 1.4).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=node:node /app/packages ./packages

# Run as the non-root 'node' user shipped by the official base image (uid 1000) (Req 1.4)
USER node

EXPOSE 3000

# Container healthcheck hits the web server root (Next.js has no dedicated health route) (Req 1.8).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3000/ || exit 1

CMD ["node_modules/.bin/next", "start", "apps/web", "-p", "3000"]
