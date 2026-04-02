// ─── Candle ──────────────────────────────────────────────────────────────────

export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isPartial?: boolean;
};

// ─── Timeframe ───────────────────────────────────────────────────────────────

export type Timeframe = "1d" | "1wk";

// ─── TA Snapshot ─────────────────────────────────────────────────────────────

export type TrendState = "bullish" | "neutral" | "bearish" | "mixed";

export type TASnapshot = {
  symbol: string;
  timeframe: Timeframe;
  lastClose: number | null;
  partialCandle: boolean;

  ema9: number | null;
  ema21: number | null;
  ema36: number | null;
  ema50: number | null;
  ema150: number | null;

  rsi14: number | null;

  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };

  atr14: number | null;
  avgVolume20: number | null;

  trendState: TrendState;
  supportLevels: number[];
  resistanceLevels: number[];
  notes: string[];
};

// ─── Session ─────────────────────────────────────────────────────────────────

export type SessionStatus = "active" | "idle" | "closed";

export type AnalysisSession = {
  id: string;
  userId: string;
  status: SessionStatus;
  activeSymbol: string | null;
  lastAnalysisId: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── LLM Output ──────────────────────────────────────────────────────────────

export type LLMAnalysisResult = {
  summary: string;
  trend: string;
  confidence: number;
  supports: number[];
  resistances: number[];
  patterns: string[];
  commentary: string;
  needsMoreData: boolean;
};

export type LLMMoreDataRequest = {
  needsMoreData: true;
  timeframe: Timeframe;
  range: string;
};

// ─── Request Classification ───────────────────────────────────────────────────

export type RequestType =
  | "new_analysis"
  | "timeframe"
  | "follow_up"
  | "comparison"
  | "session_control";

export type ClassifiedRequest = {
  type: RequestType;
  symbol?: string;
  timeframe?: Timeframe;
  raw: string;
};

// ─── Analysis Job ─────────────────────────────────────────────────────────────

export type AnalysisJobData = {
  sessionId: string;
  userId: string;
  telegramChatId: number;
  symbol: string;
  dailyRange: string;
  weeklyRange: string;
  loopCount?: number;
};

export type FollowUpJobData = {
  sessionId: string;
  userId: string;
  telegramChatId: number;
  message: string;
  classifiedType: RequestType;
};

// ─── Chart Options ────────────────────────────────────────────────────────────

export type ChartWidth = 900 | 1600 | 2200;

export type ChartOptions = {
  width: ChartWidth;
  timeframe: Timeframe;
};
