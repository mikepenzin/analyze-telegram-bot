import type { Candle, TASnapshot, Timeframe, TrendState } from "@repo/shared";

// ─── EMA ─────────────────────────────────────────────────────────────────────

export function computeEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;

  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }

  return ema;
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

export function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ─────────────────────────────────────────────────────────────────────

export function computeMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { line: number | null; signal: number | null; histogram: number | null } {
  const fast = computeEMA(closes, fastPeriod);
  const slow = computeEMA(closes, slowPeriod);

  if (fast === null || slow === null) {
    return { line: null, signal: null, histogram: null };
  }

  const macdLine = fast - slow;

  // Compute MACD line series for signal EMA
  if (closes.length < slowPeriod + signalPeriod) {
    return { line: macdLine, signal: null, histogram: null };
  }

  const macdSeries: number[] = [];
  const k = 2 / (slowPeriod + 1);
  const kFast = 2 / (fastPeriod + 1);

  let emaFast = closes.slice(0, fastPeriod).reduce((a, b) => a + b, 0) / fastPeriod;
  let emaSlow = closes.slice(0, slowPeriod).reduce((a, b) => a + b, 0) / slowPeriod;

  for (let i = fastPeriod; i < slowPeriod; i++) {
    emaFast = closes[i] * kFast + emaFast * (1 - kFast);
  }

  for (let i = slowPeriod; i < closes.length; i++) {
    emaFast = closes[i] * kFast + emaFast * (1 - kFast);
    emaSlow = closes[i] * k + emaSlow * (1 - k);
    macdSeries.push(emaFast - emaSlow);
  }

  const signalEMA = computeEMA(macdSeries, signalPeriod);
  if (signalEMA === null) return { line: macdLine, signal: null, histogram: null };

  return {
    line: macdLine,
    signal: signalEMA,
    histogram: macdLine - signalEMA,
  };
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

export function computeATR(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  // Initial ATR = simple average of first `period` TRs
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

// ─── Volume SMA ───────────────────────────────────────────────────────────────

export function computeVolumeSMA(
  volumes: number[],
  period = 20
): number | null {
  if (volumes.length < period) return null;
  const slice = volumes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ─── Support / Resistance ─────────────────────────────────────────────────────

/**
 * Simple pivot-based support/resistance detection.
 * Finds local lows (support) and local highs (resistance) within a lookback window.
 */
export function computeSupportResistance(
  candles: Candle[],
  lookback = 20,
  levels = 3
): { support: number[]; resistance: number[] } {
  if (candles.length < lookback) {
    return { support: [], resistance: [] };
  }

  const recentCandles = candles.slice(-lookback);
  const lows = recentCandles.map((c) => c.low);
  const highs = recentCandles.map((c) => c.high);

  const pivotLows: number[] = [];
  const pivotHighs: number[] = [];

  for (let i = 1; i < recentCandles.length - 1; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
      pivotLows.push(lows[i]);
    }
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
      pivotHighs.push(highs[i]);
    }
  }

  // Deduplicate levels within 1% of each other
  const dedupe = (levels: number[]): number[] => {
    const sorted = [...levels].sort((a, b) => a - b);
    const result: number[] = [];
    for (const level of sorted) {
      if (!result.some((r) => Math.abs(r - level) / level < 0.01)) {
        result.push(level);
      }
    }
    return result;
  };

  return {
    support: dedupe(pivotLows).slice(0, levels),
    resistance: dedupe(pivotHighs).slice(-levels).reverse(),
  };
}

// ─── Trend Classification ─────────────────────────────────────────────────────

export function classifyTrend(
  close: number,
  ema9: number | null,
  ema21: number | null,
  ema50: number | null,
  ema150: number | null,
  rsi14: number | null
): TrendState {
  let bullishSignals = 0;
  let bearishSignals = 0;

  if (ema9 && ema21) {
    if (close > ema9 && ema9 > ema21) bullishSignals++;
    if (close < ema9 && ema9 < ema21) bearishSignals++;
  }

  if (ema21 && ema50) {
    if (ema21 > ema50) bullishSignals++;
    if (ema21 < ema50) bearishSignals++;
  }

  if (ema50 && ema150) {
    if (ema50 > ema150) bullishSignals++;
    if (ema50 < ema150) bearishSignals++;
  }

  if (rsi14 !== null) {
    if (rsi14 > 55) bullishSignals++;
    if (rsi14 < 45) bearishSignals++;
  }

  if (bullishSignals >= 3 && bearishSignals === 0) return "bullish";
  if (bearishSignals >= 3 && bullishSignals === 0) return "bearish";
  if (bullishSignals > bearishSignals) return "neutral";
  if (bearishSignals > bullishSignals) return "neutral";
  return "mixed";
}

// ─── Notes Generator ──────────────────────────────────────────────────────────

export function generateNotes(snapshot: Omit<TASnapshot, "notes">): string[] {
  const notes: string[] = [];

  if (snapshot.partialCandle) {
    notes.push("Last daily candle is partial (market open) — data is live.");
  }

  if (snapshot.rsi14 !== null) {
    if (snapshot.rsi14 > 70) notes.push(`RSI ${snapshot.rsi14.toFixed(1)} — overbought territory.`);
    else if (snapshot.rsi14 < 30) notes.push(`RSI ${snapshot.rsi14.toFixed(1)} — oversold territory.`);
  }

  if (snapshot.macd.histogram !== null && snapshot.macd.line !== null) {
    if (snapshot.macd.histogram > 0 && snapshot.macd.line > 0)
      notes.push("MACD bullish: histogram positive, line above zero.");
    else if (snapshot.macd.histogram < 0 && snapshot.macd.line < 0)
      notes.push("MACD bearish: histogram negative, line below zero.");
    else if (snapshot.macd.histogram > 0)
      notes.push("MACD: histogram turning positive (potential momentum shift).");
  }

  if (snapshot.ema9 && snapshot.ema21 && snapshot.lastClose) {
    if (snapshot.lastClose < snapshot.ema9 && snapshot.lastClose < snapshot.ema21) {
      notes.push("Price below EMA9 and EMA21 — short-term weakness.");
    } else if (snapshot.lastClose > snapshot.ema9 && snapshot.lastClose > snapshot.ema21) {
      notes.push("Price above EMA9 and EMA21 — short-term strength.");
    }
  }

  return notes;
}

// ─── Build TA Snapshot ────────────────────────────────────────────────────────

export function buildTASnapshot(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe
): TASnapshot {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const lastCandle = candles[candles.length - 1] ?? null;
  const lastClose = lastCandle?.close ?? null;
  const partialCandle = lastCandle?.isPartial ?? false;

  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema36 = computeEMA(closes, 36);
  const ema50 = computeEMA(closes, 50);
  const ema150 = computeEMA(closes, 150);
  const rsi14 = computeRSI(closes, 14);
  const macd = computeMACD(closes);
  const atr14 = computeATR(candles, 14);
  const avgVolume20 = computeVolumeSMA(volumes, 20);

  const trendState = lastClose
    ? classifyTrend(lastClose, ema9, ema21, ema50, ema150, rsi14)
    : "neutral";

  const { support: supportLevels, resistance: resistanceLevels } =
    computeSupportResistance(candles);

  const partial: Omit<TASnapshot, "notes"> = {
    symbol,
    timeframe,
    lastClose,
    partialCandle,
    ema9,
    ema21,
    ema36,
    ema50,
    ema150,
    rsi14,
    macd,
    atr14,
    avgVolume20,
    trendState,
    supportLevels,
    resistanceLevels,
  };

  return { ...partial, notes: generateNotes(partial) };
}
