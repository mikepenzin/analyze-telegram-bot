# Analyzer Telegram Bot

A monorepo Telegram bot that performs technical analysis on stocks and supports follow-up questions.

It is built with pnpm workspaces + Turborepo and split into three runtime services:

- `api`: internal Fastify API that creates sessions and enqueues jobs
- `worker`: BullMQ workers that fetch market data, compute indicators, render charts, call the LLM, and send Telegram responses
- `bot`: grammY Telegram bot that receives user messages and forwards requests to the API

## Features

- `/analyze SYMBOL` entry command (example: `/analyze AAPL`)
- Daily + weekly market data via Massive.com
- Technical indicators (EMA, RSI, MACD, ATR, support/resistance)
- Chart rendering server-side (candles + EMA overlays + volume)
- LLM summary + follow-up Q&A
- Session-based follow-up context
- Queue-based async processing with BullMQ

## Tech Stack

- Node.js + TypeScript (ESM)
- pnpm workspaces + Turborepo
- Fastify (API)
- grammY (Telegram)
- BullMQ + Redis (queue)
- Prisma + PostgreSQL (Neon-compatible)
- OpenAI Chat Completions API
- Chart.js + canvas

## Monorepo Layout

```text
apps/
  api/
  bot/
  worker/
packages/
  chart/
  db/
  llm/
  market-data/
  shared/
  ta-engine/
```

## Prerequisites

- Node.js 20+ (Node 25 also works in this repo)
- pnpm 10+
- PostgreSQL database URL (`DATABASE_URL`)
- Redis URL (`REDIS_URL`)
- Telegram bot token (`TELEGRAM_BOT_TOKEN`)
- Massive.com API key (`MASSIVE_API_KEY`)
- OpenAI API key (`OPENAI_API_KEY`)

## Environment Variables

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

Important variables:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `TELEGRAM_BOT_TOKEN`: bot token from BotFather
- `TELEGRAM_WEBHOOK_URL`: leave empty for local long-polling; set in production webhook mode
- `MASSIVE_API_KEY`: Massive.com market data key
- `OPENAI_API_KEY`: OpenAI key
- `OPENAI_MODEL`: initial analysis model (default `gpt-4o`)
- `OPENAI_FOLLOWUP_MODEL`: follow-up model (default `gpt-4o-mini`)
- `INTERNAL_API_SECRET`: shared secret used by bot to call API
- `API_URL`: URL bot uses to call API (local default `http://localhost:3001`)
- `API_PORT`, `API_HOST`: API listen config

## Install

```bash
pnpm install
```

## Database Setup

Generate Prisma client and run migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

## Build

```bash
pnpm build
```

## Run Locally (Recommended)

Run services in three separate terminals.

Terminal 1:

```bash
pnpm --filter @repo/api dev
```

Terminal 2:

```bash
pnpm --filter @repo/worker dev
```

Terminal 3:

```bash
pnpm --filter @repo/bot dev
```

Local behavior:

- Bot runs in long-polling mode when `TELEGRAM_WEBHOOK_URL` is empty
- API listens on `API_PORT` (default 3001)
- Worker listens to `analysis` and `followup` queues

## Usage

In Telegram chat with your bot:

1. Send `/analyze AAPL`
2. Wait for charts, snapshot, and analysis text
3. Ask follow-ups in plain text, for example:
   - `What are key support levels?`
   - `Show weekly`
   - `Do you see a cup and handle?`

## API Endpoints (Internal)

- `GET /health`
- `POST /analysis/start`
- `POST /analysis/follow-up`
- Session routes under `/sessions`

API requests are protected by `x-internal-secret` when `INTERNAL_API_SECRET` is set.

## Deployment

This repo is designed to run as three separate deployable services.

### Option A: Railway (recommended)

Deploy three Railway services from this monorepo:

1. `api` service
2. `worker` service
3. `bot` service

Each service should use its corresponding Dockerfile:

- `apps/api/Dockerfile`
- `apps/worker/Dockerfile`
- `apps/bot/Dockerfile`

Set root directory to repository root so Docker build can access shared packages.

#### Service env vars

API service:

- `DATABASE_URL`
- `REDIS_URL`
- `INTERNAL_API_SECRET`
- `API_PORT=3001`
- `API_HOST=0.0.0.0`
- `NODE_ENV=production`

Worker service:

- `DATABASE_URL`
- `REDIS_URL`
- `TELEGRAM_BOT_TOKEN`
- `MASSIVE_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_FOLLOWUP_MODEL`
- `NODE_ENV=production`

Bot service:

- `TELEGRAM_BOT_TOKEN`
- `INTERNAL_API_SECRET`
- `API_URL` (internal URL of API service)
- `TELEGRAM_WEBHOOK_URL` (public URL of bot service, without `/webhook` suffix)
- `BOT_PORT=3002`
- `NODE_ENV=production`

#### Webhook notes

In production webhook mode, bot sets webhook to:

- `${TELEGRAM_WEBHOOK_URL}/webhook`

Make sure `TELEGRAM_WEBHOOK_URL` points to the bot service public URL.

### Option B: Any container platform

Use the same three Dockerfiles and provide the same environment variables.

## Health Checks

- API: `GET /health`
- Worker: process health from platform logs and restart policy
- Bot: process health from platform logs and webhook status

## Troubleshooting

### Bot receives nothing locally

- Ensure `TELEGRAM_WEBHOOK_URL` is empty in local `.env`
- Restart bot and confirm polling log appears
- Check webhook status using Telegram API (`getWebhookInfo`)

### `EADDRINUSE` on API port 3001

- Another process is already bound to port 3001
- Stop the old process or change `API_PORT`

### Worker processes jobs but no Telegram reply

- Confirm worker has `TELEGRAM_BOT_TOKEN`
- Check worker logs for send errors
- Verify bot token belongs to the bot you are messaging

### Chart rendering issues on Linux containers

- Worker Dockerfile includes required native libs for `canvas`
- If running outside Docker, install system libs for cairo/pango/jpeg/gif/rsvg

### Follow-up quality issues

- Make sure at least one `/analyze SYMBOL` completed in the current session
- Verify `OPENAI_API_KEY` and model env vars

## Useful Commands

```bash
pnpm build
pnpm dev
pnpm type-check
pnpm db:generate
pnpm db:migrate
```

## Notes

- This repository currently has no root lint script implementation in all packages.
- API is internal-facing; do not expose it publicly without proper auth hardening.
