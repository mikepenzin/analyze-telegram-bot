import 'dotenv/config';
import { Bot, webhookCallback } from "grammy";
import { createServer } from "http";
import { classifyAndForward } from "./handler.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

const bot = new Bot(token);

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    `👋 Welcome to the Stock Analysis Bot!\n\n` +
      `*Commands:*\n` +
      `/analyze SYMBOL — start analysis (e.g. /analyze AAPL)\n` +
      `/clear — clear current session\n` +
      `/help — show this message\n\n` +
      `After analyzing a stock, you can ask follow-up questions in plain text.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `*How to use:*\n\n` +
      `1. /analyze AAPL — get full technical analysis\n` +
      `2. Ask follow-ups: "what are support levels?"\n` +
      `3. "show weekly" — switch timeframe\n` +
      `4. /clear — start fresh\n\n` +
      `_Supports US stocks and ETFs._`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clear", async (ctx) => {
  // Notify API to mark session as closed — for now just confirm to user
  await ctx.reply(
    "✅ Session cleared. Use /analyze SYMBOL to start a new analysis."
  );
});

bot.command("analyze", async (ctx) => {
  const args = ctx.match?.trim().toUpperCase();

  if (!args) {
    await ctx.reply(
      "Please provide a symbol. Example: /analyze AAPL",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Basic symbol validation — 1-10 uppercase alphanumeric chars
  if (!/^[A-Z0-9.^-]{1,10}$/.test(args)) {
    await ctx.reply("❌ Invalid symbol format. Use ticker symbols like AAPL, MSFT, SPY.");
    return;
  }

  await classifyAndForward(ctx, { type: "new_analysis", symbol: args });
});

// ─── Free-text messages (follow-ups) ─────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  // Ignore if it's an unhandled command
  if (text.startsWith("/")) return;

  await classifyAndForward(ctx, { type: "follow_up", message: text });
});

// ─── Global error handler ─────────────────────────────────────────────────────

bot.catch((err) => {
  console.error("[bot] Error:", err);
});

// ─── Start: webhook or long-polling ──────────────────────────────────────────

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

if (webhookUrl) {
  // Production: webhook mode
  const port = parseInt(process.env.BOT_PORT ?? "3002", 10);
  const handleUpdate = webhookCallback(bot, "http");

  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      await handleUpdate(req, res);
    } else {
      res.writeHead(200);
      res.end("ok");
    }
  });

  server.listen(port, async () => {
    await bot.api.setWebhook(`${webhookUrl}/webhook`);
    console.log(`Bot webhook listening on port ${port}`);
  });
} else {
  // Development: long-polling
  console.log("Starting bot in long-polling mode...");
  bot.start({
    allowed_updates: ["message"],
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is now polling for updates`);
    },
  }).catch((err) => {
    console.error("[bot] Failed to start polling:", err);
  });
}
