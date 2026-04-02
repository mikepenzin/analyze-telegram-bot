FROM node:20-slim AS base
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm
WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/market-data/package.json ./packages/market-data/
COPY packages/ta-engine/package.json ./packages/ta-engine/
COPY packages/chart/package.json ./packages/chart/
COPY packages/llm/package.json ./packages/llm/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile

# ─── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/
RUN pnpm --filter @repo/shared build
RUN pnpm --filter @repo/db run generate
RUN pnpm --filter @repo/db build
RUN pnpm --filter @repo/market-data build
RUN pnpm --filter @repo/ta-engine build
RUN pnpm --filter @repo/chart build
RUN pnpm --filter @repo/llm build
RUN pnpm --filter @repo/worker build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
CMD ["node", "apps/worker/dist/index.js"]
