# GitHub Copilot Instructions

## Project Overview

This is a **TypeScript pnpm monorepo** (Turborepo) for a Telegram stock analysis bot.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design.

---

## Code Style & Conventions

### TypeScript
- All source files use **ESM** (`"type": "module"` in all `package.json`s). Imports must use `.js` extensions even for `.ts` source files (Node16 resolution):
  ```ts
  import { foo } from "./bar.js"; // correct — NOT "./bar" or "./bar.ts"
  ```
- Strict TypeScript. No `any` unless casting JSON from the database (use `as unknown as MyType`).
- Use `type` imports where possible: `import type { Foo } from "@repo/shared"`.
- No barrel re-exports inside packages — import directly from the package root `@repo/xxx`.

### Naming
- **Files**: `camelCase.ts` for modules, `kebab-case` for config files.
- **Variables/functions**: `camelCase`.
- **Types/interfaces**: `PascalCase`.
- **Constants**: `SCREAMING_SNAKE_CASE` for module-level singletons (e.g. `ANALYSIS_QUEUE`).

### Code Organization
- Section dividers use this pattern (copy exactly, including the width):
  ```ts
  // ─── Section Name ─────────────────────────────────────────────────────────────
  ```
- Group related logic in clearly named sections within a file rather than splitting into many tiny files.
- Lazy singletons for clients (Redis, OpenAI, queues): initialize on first use, memoize in a module-level `let _client` variable with a getter function.

---

## Monorepo Package Boundaries

| Package | What it should contain | What it must NOT contain |
|---|---|---|
| `@repo/shared` | TypeScript types only | Any runtime code, imports |
| `@repo/db` | Prisma client + schema migrations | Business logic |
| `@repo/llm` | OpenAI prompts, formatters | DB access, Telegram calls |
| `@repo/market-data` | Massive.com API calls | TA computation, DB access |
| `@repo/ta-engine` | Pure TA math | Any IO (no fetch, no DB) |
| `@repo/chart` | Chart.js canvas rendering | Any IO except canvas internals |

Apps (`bot`, `api`, `worker`) may import any packages. Packages must **not** import other packages except `@repo/shared`.

---

## Adding New Features

### Adding a new bot command
1. Register the command in `apps/bot/src/index.ts` via `bot.api.setMyCommands(...)`.
2. Add the handler with `bot.command("name", ...)`.
3. If it requires async work: call `classifyAndForward(ctx, action)` — add a new `ForwardAction` type if needed.
4. Add the corresponding API endpoint in `apps/api/src/routes/`.
5. Add the BullMQ job type to `@repo/shared` and a handler in `apps/worker/src/handlers/`.

### Adding a new API route
1. Create a Zod schema for the request body at the top of the route file.
2. Always use `.safeParse()` and return `400` on validation failure.
3. Register the plugin in `apps/api/src/index.ts` with a prefix.

### Adding a new job type
1. Define `XxxJobData` in `packages/shared/src/index.ts`.
2. Create `apps/worker/src/handlers/xxx.ts` with `export async function runXxxJob(data: XxxJobData)`.
3. Create a `Queue` helper in `apps/api/src/queues.ts` following the existing lazy singleton pattern.
4. Register a new `Worker` in `apps/worker/src/index.ts`.

### Adding a new TA indicator
- Add the pure computation function to `packages/ta-engine/src/index.ts`.
- Add the result field to `TASnapshot` in `packages/shared/src/index.ts`.
- Update `buildTASnapshot()` in `ta-engine` to populate it.
- Update the LLM system prompt in `packages/llm/src/index.ts` if the indicator should influence analysis.

### Adding a new database model
1. Edit `packages/db/prisma/schema.prisma`.
2. Run `pnpm db:migrate` to create a migration.
3. Run `pnpm db:generate` to regenerate the Prisma client.
4. Use `snake_case` table/column names with `@map` annotations.

---

## Security Rules

- **Never** expose `INTERNAL_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, or `DATABASE_URL` in logs or error messages.
- **Always** validate and sanitize incoming data with Zod at API boundaries.
- Stock symbol validation regex: `/^[A-Z0-9.^-]{1,10}$/` — enforce before any DB or API call.
- The API is internal-only; CORS is disabled (`origin: false`). Do not change this.
- Use `x-internal-secret` header for all bot → api communication; never use query params or body for the secret.

---

## Patterns to Follow

### Error handling in workers
```ts
// Always catch, edit the status message with a user-friendly error, then return
try {
  // ... work
} catch (err) {
  console.error("[handler] Error:", err);
  await bot.api.editMessageText(telegramChatId, statusMsg.message_id, "❌ Something went wrong.");
}
```

### Sending Telegram messages (from worker)
```ts
import { getTelegramBot } from "../telegram.js";
const bot = getTelegramBot();
await bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
```

### Zod validation in API routes
```ts
const result = MySchema.safeParse(request.body);
if (!result.success) {
  return reply.status(400).send({ error: result.error.flatten() });
}
const { field1, field2 } = result.data;
```

### Database JSON fields
```ts
// Reading – always cast through unknown
const snapshot = record.snapshotJson as unknown as TASnapshot;
// Writing – pass the object directly (Prisma accepts it)
await prisma.tASnapshot.create({ data: { snapshotJson: mySnapshot } });
```

---

## Build & Dev Commands

```bash
pnpm dev          # start all apps in dev mode (turbo watch)
pnpm build        # build all packages and apps
pnpm type-check   # run tsc --noEmit across the monorepo
pnpm lint         # lint all packages

pnpm db:generate  # regenerate Prisma client after schema changes
pnpm db:migrate   # apply pending migrations (runs prisma migrate dev)

# Filter to a single package
pnpm --filter @repo/llm build
pnpm --filter analyzer-telegram-bot-api dev
```

---

## Do Not

- Do not add `console.log` to production code; use `console.error` for errors and labelled `console.log` with `[service]` prefix for operational logging.
- Do not add business logic to `apps/bot` — it should only route/forward to the API.
- Do not call the Telegram Bot API directly from `apps/api` — only `apps/bot` and `apps/worker` use grammY.
- Do not import `@repo/db` from `apps/bot` — the bot has no DB access.
- Do not add new environment variables without documenting them in `ARCHITECTURE.md`.
- Do not use `require()` — this is a pure ESM codebase.
- Do not use `any` — use `unknown` and type-narrow or cast through `unknown`.
