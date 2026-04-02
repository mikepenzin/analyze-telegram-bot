import { Bot } from "grammy";

let _bot: Bot | null = null;

export function getTelegramBot(): Bot {
  if (!_bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    _bot = new Bot(token);
  }
  return _bot;
}
