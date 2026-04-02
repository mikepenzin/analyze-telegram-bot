FROM node:20-slim AS base
RUN npm install -g pnpm
WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/bot/package.json ./apps/bot/
RUN pnpm install --frozen-lockfile

# ─── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/bot/ ./apps/bot/
RUN pnpm --filter @repo/shared build
RUN pnpm --filter @repo/bot build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
RUN npm install -g pnpm
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist
COPY --from=builder /app/apps/bot/node_modules ./apps/bot/node_modules
EXPOSE 3002
CMD ["node", "apps/bot/dist/index.js"]
