import type { Context } from "grammy";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

type ForwardAction =
  | { type: "new_analysis"; symbol: string }
  | { type: "follow_up"; message: string };

async function callAPI(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": API_SECRET,
    },
    body: JSON.stringify(body),
  });
}

export async function classifyAndForward(
  ctx: Context,
  action: ForwardAction
): Promise<void> {
  const telegramId = String(ctx.from?.id);
  const username = ctx.from?.username;
  const telegramChatId = ctx.chat?.id;

  if (!telegramId || !telegramChatId) return;

  if (action.type === "new_analysis") {
    const res = await callAPI("/analysis/start", {
      telegramId,
      username,
      telegramChatId,
      symbol: action.symbol,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      await ctx.reply(`❌ ${(err as { error: string }).error ?? "Failed to start analysis."}`);
    }
    // The worker will send the actual response
    return;
  }

  if (action.type === "follow_up") {
    const res = await callAPI("/analysis/follow-up", {
      telegramId,
      username,
      telegramChatId,
      message: action.message,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      await ctx.reply(
        (data as { error: string }).error ?? "❌ Something went wrong."
      );
    }
    // The worker will send the actual response
  }
}
