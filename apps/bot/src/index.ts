import 'dotenv/config';
import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { createServer } from "http";
import { classifyAndForward } from "./handler.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

const bot = new Bot(token);

// ─── Register command list (shows in the "/" menu in Telegram) ────────────────

await bot.api.setMyCommands([
  { command: "analyze", description: "Analyze a stock — /analyze AAPL" },
  { command: "clear", description: "Clear current session" },
  { command: "help", description: "Show help" },
]);

// ─── Keyboards ────────────────────────────────────────────────────────────────

const MAIN_KEYBOARD = new InlineKeyboard()
  .text("📊 Analyze a Stock", "analyze_prompt")
  .text("❓ Help", "help_prompt");

const SYMBOL_PROMPT_TEXT =
  "Enter the stock symbol you want to analyze (e.g. *AAPL*, *MSFT*, *SPY*):";

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    `👋 *Welcome to the Stock Analysis Bot!*\n\n` +
      `Get AI-powered technical analysis with charts, indicators, and follow-up Q&A for any US stock or ETF.\n\n` +
      `Tap a button below or type */analyze SYMBOL* to get started.`,
    { parse_mode: "Markdown", reply_markup: MAIN_KEYBOARD }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `*How to use:*\n\n` +
      `1. Tap *📊 Analyze a Stock* or type /analyze AAPL\n` +
      `2. Ask follow-up questions in plain text:\n` +
      `   • "What are the key support levels?"\n` +
      `   • "Do you see a cup and handle?"\n` +
      `   • "Show weekly"\n` +
      `3. /clear — start a fresh session\n\n` +
      `_Supports US stocks and ETFs._`,
    { parse_mode: "Markdown", reply_markup: MAIN_KEYBOARD }
  );
});

bot.command("clear", async (ctx) => {
  await ctx.reply(
    "✅ Session cleared. Use /analyze SYMBOL or tap the button below to start a new analysis.",
    { reply_markup: MAIN_KEYBOARD }
  );
});

bot.command("analyze", async (ctx) => {
  const args = ctx.match?.trim().toUpperCase();

  if (!args) {
    await ctx.reply(SYMBOL_PROMPT_TEXT, {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true, input_field_placeholder: "AAPL" },
    });
    return;
  }

  if (!/^[A-Z0-9.^-]{1,10}$/.test(args)) {
    await ctx.reply("❌ Invalid symbol format. Use ticker symbols like AAPL, MSFT, SPY.");
    return;
  }

  await classifyAndForward(ctx, { type: "new_analysis", symbol: args });
});

// ─── Inline keyboard callbacks ────────────────────────────────────────────────

bot.callbackQuery("analyze_prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(SYMBOL_PROMPT_TEXT, {
    parse_mode: "Markdown",
    reply_markup: { force_reply: true, input_field_placeholder: "AAPL" },
  });
});

bot.callbackQuery("help_prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `*How to use:*\n\n` +
      `1. Tap *📊 Analyze a Stock* or type /analyze AAPL\n` +
      `2. Ask follow-up questions in plain text:\n` +
      `   • "What are the key support levels?"\n` +
      `   • "Do you see a cup and handle?"\n` +
      `   • "Show weekly"\n` +
      `3. /clear — start a fresh session\n\n` +
      `_Supports US stocks and ETFs._`,
    { parse_mode: "Markdown" }
  );
});

// ─── Free-text messages (follow-ups + ForceReply symbol entry) ────────────────

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  // Ignore unhandled commands
  if (text.startsWith("/")) return;

  // Detect replies to our ForceReply symbol prompt and treat as new analysis
  const replyTo = ctx.message.reply_to_message?.text;
  if (replyTo?.includes("Enter the stock symbol")) {
    const symbol = text.toUpperCase();
    if (!/^[A-Z0-9.^-]{1,10}$/.test(symbol)) {
      await ctx.reply(
        "❌ Invalid symbol format. Use ticker symbols like AAPL, MSFT, SPY.",
        { reply_markup: MAIN_KEYBOARD }
      );
      return;
    }
    await classifyAndForward(ctx, { type: "new_analysis", symbol });
    return;
  }

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
    allowed_updates: ["message", "callback_query"],
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is now polling for updates`);
    },
  }).catch((err) => {
    console.error("[bot] Failed to start polling:", err);
  });
}
