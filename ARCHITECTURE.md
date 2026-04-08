# Architecture — Stock Analysis Telegram Bot

## Overview

A monorepo Telegram bot that delivers AI-powered technical analysis for US stocks and ETFs. A user sends a stock symbol; the system fetches market data, computes indicators, renders charts, and runs GPT-4o vision analysis — then streams the result back via Telegram. Follow-up questions preserve full conversation context.

---

## Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Language | TypeScript (ESM, `"type": "module"`) |
| Bot framework | grammY |
| API server | Fastify |
| Queue | BullMQ (Redis-backed) |
| Database | PostgreSQL via Prisma |
| LLM | OpenAI GPT-4o (analysis) / GPT-4o-mini (follow-ups) |
| Market data | Massive.com REST API |
| Charts | Chart.js + chartjs-node-canvas (server-side PNG) |
| Deployment | Railway (3 separate services) |

---

## Repository Structure

```
apps/
  bot/     — Telegram webhook server (grammY)
  api/     — Internal HTTP API (Fastify)
  worker/  — BullMQ job workers

packages/
  shared/       — Shared TypeScript types only (no runtime deps)
  db/           — Prisma client + schema
  llm/          — OpenAI wrapper (analysis + follow-up prompts)
  market-data/  — Massive.com candle fetcher
  ta-engine/    — TA computations (EMA, RSI, MACD, ATR, support/resistance)
  chart/        — Chart.js canvas renderer -> PNG Buffer
```

---

## Apps

### `apps/bot`

- Single-file Telegram bot (`src/index.ts`) using **grammY webhook mode**.
- Registers `/analyze`, `/clear`, `/help`, `/start` commands.
- All user input is forwarded to the API via `classifyAndForward()` in `src/handler.ts`.
- Makes authenticated HTTP POST calls to `apps/api` with `x-internal-secret` header.
- **Does not** talk to the database, queue, or LLM directly.
- Env vars: `TELEGRAM_BOT_TOKEN`, `API_URL`, `INTERNAL_API_SECRET`

### `apps/api`

- Fastify server listening on port `3001` (configurable via `API_PORT`).
- Protected by a header-based internal auth hook (`x-internal-secret`).
- Two route modules:
  - `routes/analysis.ts` — `POST /analysis/start`, `POST /analysis/follow-up`
  - `routes/sessions.ts` — session management endpoints
- On each request: validates input with **Zod**, upserts user in DB, creates/updates session, enqueues a BullMQ job.
- Uses `services/classifier.ts` (rule-based) to determine user intent type.
- Env vars: `DATABASE_URL`, `REDIS_URL`, `INTERNAL_API_SECRET`

### `apps/worker`

- Two BullMQ workers running concurrently:
  - **analysis** (concurrency 2) — full pipeline per job
  - **followup** (concurrency 5) — LLM Q&A per job
- Each worker has a dedicated handler in `src/handlers/`.
- Uses a lazily instantiated grammY `Bot` instance to send Telegram messages back to the user (`src/telegram.ts`).
- Env vars: `REDIS_URL`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `MASSIVE_API_KEY`

---

## Packages

### `@repo/shared`

Pure TypeScript types — **no runtime code**. Every cross-app type lives here:
- `Candle`, `Timeframe`
- `TASnapshot`, `TrendState`
- `LLMAnalysisResult`, `LLMMoreDataRequest`
- `AnalysisJobData`, `FollowUpJobData`
- `ClassifiedRequest`, `RequestType`
- `SessionStatus`

### `@repo/db`

Prisma client wrapper. Exports `prisma` singleton and all Prisma types.

**Schema overview:**
```
User               (telegramId PK alias, username)
  └── AnalysisSession  (activeSymbol, status)
        ├── AnalysisMessage  (role: user|assistant, contentJson)
        └── Analysis         (symbol, resultJson)
              ├── TASnapshot      (snapshotJson — daily + weekly)
              └── ChartArtifact   (imagePath, telegramFileId, timeframe, width)
```

### `@repo/llm`

OpenAI GPT-4o wrapper. Two exported functions:
- `runInitialAnalysis(input, loopCount)` — vision + JSON structured output, supports a retry loop if LLM requests more data.
- `runFollowUp(session, message, history)` — conversational follow-up using `gpt-4o-mini`.
- `formatSnapshotText(snapshot)` — formats `TASnapshot` as human-readable Markdown.

Models configurable via env: `OPENAI_MODEL` (default `gpt-4o`), `OPENAI_FOLLOWUP_MODEL` (default `gpt-4o-mini`).

### `@repo/market-data`

Fetches OHLCV candles from Massive.com REST API.
- `fetchCandles({ symbol, timeframe, range })` — returns `Candle[]`.
- Range format: `"9mo"`, `"18mo"`, `"3y"`, `"4y"`.
- Env var: `MASSIVE_API_KEY`

### `@repo/ta-engine`

Pure computation, no IO. Takes `Candle[]`, returns `TASnapshot`.
- Computes: EMA(9/21/36/50/150), RSI(14), MACD(12/26/9), ATR(14), avg volume(20).
- Derives: `trendState`, `supportLevels[]`, `resistanceLevels[]`, `notes[]`.

### `@repo/chart`

Server-side chart rendering using Chart.js + node-canvas.
- `renderChart(candles, snapshot, options)` → `Promise<Buffer>` (PNG).
- Renders candlestick (custom plugin), volume bars, and EMA overlays.
- Two sizes per analysis: 900px (Telegram display), 1600px (LLM input).

---

## Data Flow

### New Analysis (`/analyze AAPL`)

```
User → Telegram
  → apps/bot  (grammY webhook)
    → POST /analysis/start  (+ x-internal-secret)
      → apps/api
        ├── Upsert User in DB
        ├── Create AnalysisSession
        ├── Create AnalysisMessage (user)
        └── Enqueue BullMQ "analysis" job
          → apps/worker  (analysis handler)
            1. Send "Analyzing..." status message to Telegram
            2. fetchCandles (daily + weekly)  ← @repo/market-data
            3. buildTASnapshot (daily + weekly) ← @repo/ta-engine
            4. renderChart x4 (900px + 1600px, daily + weekly) ← @repo/chart
            5. runInitialAnalysis(input) ← @repo/llm (GPT-4o vision)
               └─ If needsMoreData=true: re-enqueue with wider range (max 2 loops)
            6. Save Analysis + TASnapshot + ChartArtifact to DB
            7. Edit status message → send chart photos + analysis text to Telegram
```

### Follow-up Question (plain text message)

```
User → Telegram
  → apps/bot
    → POST /analysis/follow-up
      → apps/api
        ├── Load active session
        ├── Classify request type (rule-based)
        └── Enqueue BullMQ "followup" job
          → apps/worker  (followup handler)
            1. Load session + latest analysis + snapshots from DB
            2. Rebuild conversation history (last 20 messages)
            3. runFollowUp(snapshot, message, history) ← @repo/llm (GPT-4o-mini)
            4. Save assistant message to DB
            5. Send reply to Telegram
```

---

## Request Classification

`apps/api/src/services/classifier.ts` uses rule-based logic (no LLM) to classify user messages:

| Type | Trigger |
|---|---|
| `new_analysis` | `/analyze SYMBOL` command |
| `follow_up` | Any plain text in active session |
| `timeframe` | Messages containing "weekly"/"daily"/"show weekly" etc. |
| `session_control` | `/clear`, `/start`, `/help` |

---

## Authentication Between Services

- `apps/bot` → `apps/api`: HTTP header `x-internal-secret: <INTERNAL_API_SECRET>`
- API validates this on every request via Fastify `onRequest` hook.
- `apps/worker` → Telegram: uses `TELEGRAM_BOT_TOKEN` directly (grammY Bot API calls).

---

## Database Conventions

- All model names in PascalCase (Prisma standard).
- All table/column names in `snake_case` (via `@map`).
- IDs: `cuid()`.
- JSON columns used for flexible payloads (`resultJson`, `snapshotJson`, `contentJson`).
- Relations: always include both FK string field and relation object.

---

## Deployment (Railway)

Three independent Railway services, each built from its own Dockerfile at the monorepo root:

| Service | Dockerfile | Port | Key Env Vars |
|---|---|---|---|
| `bot` | `apps/bot/Dockerfile` | 3002 | `TELEGRAM_BOT_TOKEN`, `API_URL`, `INTERNAL_API_SECRET` |
| `api` | `apps/api/Dockerfile` | 3001 | `DATABASE_URL`, `REDIS_URL`, `INTERNAL_API_SECRET` |
| `worker` | `apps/worker/Dockerfile` | — | `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `MASSIVE_API_KEY` |

Shared infrastructure: Railway Postgres + Railway Redis.

---

## Environment Variables Reference

| Variable | Used by | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | bot, worker | grammY bot authentication |
| `TELEGRAM_WEBHOOK_URL` | bot | Webhook endpoint URL |
| `API_URL` | bot | Internal URL of api service |
| `INTERNAL_API_SECRET` | bot, api | Service-to-service auth |
| `DATABASE_URL` | api, worker | PostgreSQL connection |
| `REDIS_URL` | api, worker | Redis/BullMQ connection |
| `OPENAI_API_KEY` | worker | OpenAI API |
| `OPENAI_MODEL` | worker | Analysis model (default: `gpt-4o`) |
| `OPENAI_FOLLOWUP_MODEL` | worker | Follow-up model (default: `gpt-4o-mini`) |
| `MASSIVE_API_KEY` | worker | Market data API |
| `API_PORT` | api | HTTP port (default: `3001`) |
