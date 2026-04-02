import type { ClassifiedRequest, RequestType } from "@repo/shared";

/**
 * Rule-based request classifier.
 * Determines the intent of a user message within an active session.
 */
export function classifyRequest(
  message: string,
  activeSymbol: string | null
): ClassifiedRequest {
  const lower = message.toLowerCase().trim();

  // Session control
  if (lower === "/clear" || lower === "/start" || lower === "/help") {
    return { type: "session_control", raw: message };
  }

  // New analysis via /analyze command
  const analyzeMatch = lower.match(/^\/analyze\s+([a-z0-9.^-]{1,10})$/i);
  if (analyzeMatch) {
    return {
      type: "new_analysis",
      symbol: analyzeMatch[1].toUpperCase(),
      raw: message,
    };
  }

  // Timeframe switch
  if (
    lower.includes("weekly") ||
    lower.includes("daily") ||
    lower.includes("show weekly") ||
    lower.includes("show daily")
  ) {
    const timeframe = lower.includes("weekly") ? "1wk" : "1d";
    return { type: "timeframe", timeframe, raw: message };
  }

  // Comparison (mentions another ticker)
  const comparisonMatch = lower.match(
    /compare\s+(?:to\s+|with\s+)?([a-z]{1,10})/i
  );
  if (comparisonMatch) {
    return {
      type: "comparison",
      symbol: comparisonMatch[1].toUpperCase(),
      raw: message,
    };
  }

  // New symbol mentioned directly (e.g. bare ticker like "MSFT")
  const bareTickerMatch = lower.match(/^([a-z]{1,5})$/i);
  if (bareTickerMatch && !activeSymbol) {
    return {
      type: "new_analysis",
      symbol: bareTickerMatch[1].toUpperCase(),
      raw: message,
    };
  }

  // Default: follow-up question in current session
  return { type: "follow_up", raw: message };
}
