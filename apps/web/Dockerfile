# --- Stage 1: Build ---
FROM node:18-alpine AS builder

WORKDIR /app

# Cài đặt pnpm toàn cục
RUN npm install -g pnpm

# Copy files cấu hình Monorepo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/eslint-config/package.json ./packages/eslint-config/

# Cài đặt dependencies cho monorepo
RUN pnpm install --frozen-lockfile

# Copy toàn bộ mã nguồn
COPY . .

# Build dự án NextJS qua Turborepo
RUN pnpm --filter @auto-post/web build

# --- Stage 2: Runner ---
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built files và dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/packages ./packages

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "apps/web", "-p", "3000"]
