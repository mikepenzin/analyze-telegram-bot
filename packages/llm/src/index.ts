import OpenAI from "openai";
import type {
  TASnapshot,
  LLMAnalysisResult,
  LLMMoreDataRequest,
  Timeframe,
} from "@repo/shared";

// ─── Client ───────────────────────────────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

const ANALYSIS_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
const FOLLOWUP_MODEL = process.env.OPENAI_FOLLOWUP_MODEL ?? "gpt-4o-mini";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional stock technical analysis assistant.

RULES (strictly enforced):
1. The structured TA data (JSON) is the source of truth. Never contradict it.
2. Carefully examine chart images to identify visual chart patterns (Cup and Handle, Head and Shoulders, Bull Flag, Double Bottom, channels, wedges, triangles, etc.). Include any patterns you identify in the "patterns" array.
3. If you are unsure about something, say "unclear from available data" — do NOT hallucinate.
4. Do NOT provide financial advice or buy/sell recommendations.
5. Be concise and factual. Use plain language a trader will understand.
6. If a partial candle is flagged, mention that the last candle is live and incomplete.

OUTPUT FORMAT (for initial analysis): Respond with a JSON object matching this schema exactly:
{
  "summary": "1–2 sentence overview",
  "trend": "bullish | bearish | neutral | mixed",
  "confidence": 0.0–1.0,
  "supports": [price levels as numbers],
  "resistances": [price levels as numbers],
  "patterns": ["list of chart patterns identified visually, e.g. Cup and Handle, Head and Shoulders, Bull Flag, Double Bottom — empty array if none"],
  "commentary": "3–5 sentences of technical commentary including any notable chart patterns",
  "needsMoreData": false
}

If you genuinely need more historical data to give a useful analysis, respond with:
{
  "needsMoreData": true,
  "timeframe": "1d" | "1wk",
  "range": "18mo" | "4y" (use minimal range needed)
}`;

const FOLLOWUP_SYSTEM_PROMPT = `You are a professional stock technical analysis assistant helping a trader understand a stock.

RULES (strictly enforced):
1. The structured TA data (JSON) is the source of truth. Never contradict it.
2. Do NOT provide financial advice or buy/sell recommendations.
3. Be concise and factual. Use plain language a trader will understand.
4. If a partial candle is flagged, mention that the last candle is live and incomplete.
5. Do NOT respond with JSON. Respond in plain conversational text only.
6. Keep answers focused and under 200 words unless more detail is clearly needed.
7. You have access to the daily and weekly chart images. Use them to identify visual chart patterns (Cup and Handle, Head and Shoulders, Bull Flag, channels, wedges, etc.) when the user asks about patterns or formations.
8. Reference the initial analysis context provided in the conversation to maintain consistency.`;

// ─── Initial Analysis ─────────────────────────────────────────────────────────

export type AnalysisInput = {
  dailySnapshot: TASnapshot;
  weeklySnapshot: TASnapshot;
  dailyChartBase64: string;
  weeklyChartBase64: string;
};

export async function runInitialAnalysis(
  input: AnalysisInput,
  loopCount = 0
): Promise<LLMAnalysisResult | LLMMoreDataRequest> {
  const { dailySnapshot, weeklySnapshot, dailyChartBase64, weeklyChartBase64 } =
    input;

  const client = getClient();

  const dataContext = `
## Technical Analysis Data

### Daily Snapshot (${dailySnapshot.symbol})
${JSON.stringify(dailySnapshot, null, 2)}

### Weekly Snapshot (${weeklySnapshot.symbol})
${JSON.stringify(weeklySnapshot, null, 2)}

Loop count: ${loopCount} (max 2 re-fetches allowed)
`;

  const response = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: dataContext },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${dailyChartBase64}`,
              detail: "high",
            },
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${weeklyChartBase64}`,
              detail: "high",
            },
          },
          {
            type: "text",
            text: "Analyze the above technical data and charts. Carefully examine both chart images for visual patterns (Cup and Handle, Head and Shoulders, Bull Flag, Double Bottom, ascending/descending triangles, channels, wedges, etc.). Return JSON only.",
          },
        ],
      },
    ],
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message.content ?? "{}";
  const parsed = JSON.parse(content) as LLMAnalysisResult | LLMMoreDataRequest;
  return parsed;
}

// ─── Follow-up ────────────────────────────────────────────────────────────────

export type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function runFollowUp(
  messages: ConversationMessage[],
  taSnapshot: TASnapshot,
  charts?: { dailyBase64?: string; weeklyBase64?: string }
): Promise<string> {
  const client = getClient();

  const snapshotContext = `Current TA snapshot for ${taSnapshot.symbol}:\n${JSON.stringify(taSnapshot, null, 2)}`;

  // Build the last user message content — attach charts if available so the
  // model can answer visual questions (patterns, formations, etc.)
  const lastUserMessage = messages[messages.length - 1];
  const priorMessages = messages.slice(0, -1);

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } };

  let lastMessageContent: string | ContentPart[] = lastUserMessage?.content ?? "";

  if (charts && (charts.dailyBase64 || charts.weeklyBase64)) {
    const parts: ContentPart[] = [
      { type: "text", text: lastUserMessage?.content ?? "" },
    ];
    if (charts.dailyBase64) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${charts.dailyBase64}`, detail: "high" },
      });
    }
    if (charts.weeklyBase64) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${charts.weeklyBase64}`, detail: "high" },
      });
    }
    lastMessageContent = parts;
  }

  const response = await client.chat.completions.create({
    model: FOLLOWUP_MODEL,
    messages: [
      { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
      { role: "system", content: snapshotContext },
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      ...(lastUserMessage ? [{ role: lastUserMessage.role, content: lastMessageContent as string }] : []),
    ],
    max_tokens: 500,
  });

  return response.choices[0]?.message.content ?? "Unable to generate response.";
}

// ─── Format Snapshot for Telegram ─────────────────────────────────────────────

export function formatSnapshotText(snapshot: TASnapshot): string {
  const tf = snapshot.timeframe === "1d" ? "Daily" : "Weekly";
  const partial = snapshot.partialCandle ? " *(live)*" : "";

  const lines = [
    `📊 *${snapshot.symbol} — ${tf} Snapshot*${partial}`,
    ``,
    `*Price:* ${snapshot.lastClose?.toFixed(2) ?? "N/A"}`,
    `*Trend:* ${snapshot.trendState.toUpperCase()}`,
    ``,
    `*EMAs:*`,
    `  EMA9: ${snapshot.ema9?.toFixed(2) ?? "N/A"}`,
    `  EMA21: ${snapshot.ema21?.toFixed(2) ?? "N/A"}`,
    `  EMA50: ${snapshot.ema50?.toFixed(2) ?? "N/A"}`,
    `  EMA150: ${snapshot.ema150?.toFixed(2) ?? "N/A"}`,
    ``,
    `*RSI(14):* ${snapshot.rsi14?.toFixed(1) ?? "N/A"}`,
    `*ATR(14):* ${snapshot.atr14?.toFixed(2) ?? "N/A"}`,
    ``,
    snapshot.supportLevels.length > 0
      ? `*Support:* ${snapshot.supportLevels.map((l) => l.toFixed(2)).join(", ")}`
      : null,
    snapshot.resistanceLevels.length > 0
      ? `*Resistance:* ${snapshot.resistanceLevels.map((l) => l.toFixed(2)).join(", ")}`
      : null,
  ].filter(Boolean);

  if (snapshot.notes.length > 0) {
    lines.push("", "*Notes:*");
    snapshot.notes.forEach((n) => lines.push(`  • ${n}`));
  }

  return lines.join("\n");
}
