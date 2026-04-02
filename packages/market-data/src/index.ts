import {
  restClient,
  GetStocksAggregatesTimespanEnum,
  GetStocksAggregatesSortEnum,
} from "@massive.com/client-js";
import type { Candle, Timeframe } from "@repo/shared";

const apiKey = process.env.MASSIVE_API_KEY;
if (!apiKey) throw new Error("MASSIVE_API_KEY is not set");

const rest = restClient(apiKey, "https://api.massive.com");

// ─── Types ────────────────────────────────────────────────────────────────────

export type FetchCandlesOptions = {
  symbol: string;
  timeframe: Timeframe;
  range: string; // e.g. "9mo", "3y", "18mo"
};

export type MarketQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  shortName: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rangeToStartDate(range: string): Date {
  const now = new Date();
  const match = range.match(/^(\d+)(mo|y|d)$/);
  if (!match) throw new Error(`Invalid range format: ${range}`);

  const [, amountStr, unit] = match;
  const amount = parseInt(amountStr, 10);

  if (unit === "d") {
    now.setDate(now.getDate() - amount);
  } else if (unit === "mo") {
    now.setMonth(now.getMonth() - amount);
  } else if (unit === "y") {
    now.setFullYear(now.getFullYear() - amount);
  }

  return now;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function timespanForTimeframe(timeframe: Timeframe): { multiplier: number; timespan: GetStocksAggregatesTimespanEnum } {
  return timeframe === "1wk"
    ? { multiplier: 1, timespan: GetStocksAggregatesTimespanEnum.Week }
    : { multiplier: 1, timespan: GetStocksAggregatesTimespanEnum.Day };
}

function isLastCandlePartial(candles: Candle[], timeframe: Timeframe): boolean {
  if (timeframe !== "1d" || candles.length === 0) return false;
  const lastTimestamp = new Date(candles[candles.length - 1].timestamp);
  const today = new Date();
  return (
    lastTimestamp.getUTCFullYear() === today.getUTCFullYear() &&
    lastTimestamp.getUTCMonth() === today.getUTCMonth() &&
    lastTimestamp.getUTCDate() === today.getUTCDate()
  );
}

// ─── Fetch Candles ────────────────────────────────────────────────────────────

export async function fetchCandles(
  options: FetchCandlesOptions
): Promise<Candle[]> {
  const { symbol, timeframe, range } = options;
  const { multiplier, timespan } = timespanForTimeframe(timeframe);

  const from = toDateString(rangeToStartDate(range));
  const to = toDateString(new Date());

  const resp = await rest.getStocksAggregates({
    stocksTicker: symbol.toUpperCase(),
    multiplier,
    timespan,
    from,
    to,
    adjusted: true,
    sort: GetStocksAggregatesSortEnum.Asc,
    limit: 50000,
  });

  const results: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> =
    (resp as any).results ?? (resp as any).data?.results ?? [];

  if (!results.length) return [];

  const candles: Candle[] = results
    .filter((q) => q.o != null && q.h != null && q.l != null && q.c != null && q.v != null)
    .map((q) => ({
      timestamp: new Date(q.t).toISOString(),
      open: q.o,
      high: q.h,
      low: q.l,
      close: q.c,
      volume: q.v,
    }));

  if (isLastCandlePartial(candles, timeframe) && candles.length > 0) {
    candles[candles.length - 1].isPartial = true;
  }

  return candles;
}

// ─── Fetch Quote ──────────────────────────────────────────────────────────────

export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const ticker = symbol.toUpperCase();

  const [snapResp, detailsResp] = await Promise.all([
    rest.getStocksSnapshotTicker({ stocksTicker: ticker }),
    rest.getTicker({ ticker }),
  ]);

  const snap = (snapResp as any).ticker ?? (snapResp as any).data?.ticker;
  const details = (detailsResp as any).results ?? (detailsResp as any).data?.results;

  return {
    symbol: ticker,
    price: snap?.day?.c ?? snap?.prevDay?.c ?? null,
    change: snap?.todaysChange ?? null,
    changePercent: snap?.todaysChangePerc ?? null,
    marketCap: details?.market_cap ?? null,
    volume: snap?.day?.v ?? null,
    shortName: details?.name ?? null,
  };
}

// ─── Validate Symbol ──────────────────────────────────────────────────────────

export async function validateSymbol(symbol: string): Promise<boolean> {
  try {
    const resp = await rest.getStocksSnapshotTicker({ stocksTicker: symbol.toUpperCase() });
    const snap = (resp as any).ticker ?? (resp as any).data?.ticker;
    return snap?.day?.c != null || snap?.prevDay?.c != null;
  } catch {
    return false;
  }
}
