# --- Stage 1: Build ---
FROM node:18-alpine AS builder

WORKDIR /app

# Cài đặt pnpm toàn cục
RUN npm install -g pnpm

# Copy files cấu hình Monorepo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
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

# Build dự án API qua Turborepo
WORKDIR /app
RUN pnpm --filter @auto-post/api build

# --- Stage 2: Runner ---
FROM node:18-alpine AS runner

WORKDIR /app

# Thiết lập môi trường Production
ENV NODE_ENV=production

# Copy built files và dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/packages ./packages

EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
