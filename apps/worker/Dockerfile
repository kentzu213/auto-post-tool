# --- Stage 1: Build ---
FROM node:18-alpine AS builder

WORKDIR /app

# Cài đặt pnpm toàn cục
RUN npm install -g pnpm

# Copy files cấu hình Monorepo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
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

# Build dự án Worker qua Turborepo
WORKDIR /app
RUN pnpm --filter @auto-post/worker build

# --- Stage 2: Runner ---
FROM node:18-alpine AS runner

WORKDIR /app

# CÀI ĐẶT FFMPEG THỰC TẾ CHO CONTAINER RUNNER
RUN apk add --no-image-history --no-cache ffmpeg

ENV NODE_ENV=production

# Copy built files và dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/prisma ./apps/worker/prisma
COPY --from=builder /app/packages ./packages

CMD ["node", "apps/worker/dist/index.js"]
