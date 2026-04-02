FROM node:20-slim AS base
RUN npm install -g pnpm
WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# ─── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/db/ ./packages/db/
COPY apps/api/ ./apps/api/
RUN pnpm --filter @repo/shared build
RUN pnpm --filter @repo/db run generate
RUN pnpm --filter @repo/db build
RUN pnpm --filter @repo/api build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
RUN npm install -g pnpm
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
