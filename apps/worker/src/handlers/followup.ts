import { prisma } from "@repo/db";
import { runFollowUp, formatSnapshotText } from "@repo/llm";
import type { FollowUpJobData, TASnapshot, LLMAnalysisResult } from "@repo/shared";
import { getTelegramBot } from "../telegram.js";

export async function runFollowUpJob(data: FollowUpJobData): Promise<void> {
  const { sessionId, telegramChatId, message } = data;

  const bot = getTelegramBot();

  // Load latest analysis + snapshot from session
  const session = await prisma.analysisSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 20 },
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          snapshots: { orderBy: { createdAt: "desc" }, take: 2 },
          charts: true,
        },
      },
    },
  });

  if (!session) {
    await bot.api.sendMessage(telegramChatId, "❌ Session not found.");
    return;
  }

  const latestAnalysis = session.analyses[0];
  if (!latestAnalysis) {
    await bot.api.sendMessage(
      telegramChatId,
      "No analysis found in this session. Use /analyze SYMBOL first."
    );
    return;
  }

  // Get daily snapshot (first one stored)
  const dailySnapshotRecord = latestAnalysis.snapshots[0];
  if (!dailySnapshotRecord) {
    await bot.api.sendMessage(telegramChatId, "❌ No snapshot data available.");
    return;
  }

  const taSnapshot = dailySnapshotRecord.snapshotJson as unknown as TASnapshot;

  // Handle timeframe requests - re-send snapshot for the requested timeframe
  if (data.classifiedType === "timeframe") {
    const weeklySnapshot = latestAnalysis.snapshots[1];
    if (weeklySnapshot) {
      const snapshot = weeklySnapshot.snapshotJson as unknown as TASnapshot;
      await bot.api.sendMessage(
        telegramChatId,
        formatSnapshotText(snapshot),
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  // Build conversation history for LLM
  // For assistant messages that contain a structured llmResult, format them as
  // rich text so the LLM retains full context (patterns, supports, confidence…)
  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Inject initial analysis result at the start of conversation so the model
  // remembers its own analysis even if it wasn't stored as a message
  const analysisResult = latestAnalysis.resultJson as unknown as LLMAnalysisResult | null;
  if (analysisResult && analysisResult.summary) {
    const patternLine = analysisResult.patterns?.length
      ? `Patterns identified: ${analysisResult.patterns.join(", ")}`
      : "No chart patterns identified.";
    conversationHistory.push({
      role: "assistant",
      content: [
        `[Initial analysis for ${taSnapshot.symbol}]`,
        `Summary: ${analysisResult.summary}`,
        `Trend: ${analysisResult.trend} (confidence ${((analysisResult.confidence ?? 0) * 100).toFixed(0)}%)`,
        `Supports: ${analysisResult.supports?.join(", ") ?? "none"}`,
        `Resistances: ${analysisResult.resistances?.join(", ") ?? "none"}`,
        patternLine,
        `Commentary: ${analysisResult.commentary}`,
      ].join("\n"),
    });
  }

  // Add stored conversation messages
  for (const m of session.messages) {
    if (m.role === "system") continue;
    const content = m.contentJson as {
      text?: string;
      llmResult?: LLMAnalysisResult;
    };

    // Skip the initial analysis message — already injected above
    if (content.llmResult) continue;

    const text = content.text ?? "";
    if (text.length > 0) {
      conversationHistory.push({
        role: m.role as "user" | "assistant",
        content: text,
      });
    }
  }

  // Add current user message
  conversationHistory.push({ role: "user", content: message });

  const typing = bot.api.sendChatAction(telegramChatId, "typing").catch(() => {});

  // Download chart images from Telegram so the follow-up model can see them
  let charts: { dailyBase64?: string; weeklyBase64?: string } | undefined;
  try {
    const chartArtifacts = latestAnalysis.charts ?? [];
    const dailyArtifact = chartArtifacts.find((c) => c.timeframe === "1d" && c.telegramFileId);
    const weeklyArtifact = chartArtifacts.find((c) => c.timeframe === "1wk" && c.telegramFileId);

    const downloadChart = async (fileId: string): Promise<string | undefined> => {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) return undefined;
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) return undefined;
      const buf = Buffer.from(await resp.arrayBuffer());
      return buf.toString("base64");
    };

    const [dailyBase64, weeklyBase64] = await Promise.all([
      dailyArtifact ? downloadChart(dailyArtifact.telegramFileId!) : Promise.resolve(undefined),
      weeklyArtifact ? downloadChart(weeklyArtifact.telegramFileId!) : Promise.resolve(undefined),
    ]);

    if (dailyBase64 || weeklyBase64) {
      charts = { dailyBase64, weeklyBase64 };
    }
  } catch {
    // Chart download failed — proceed without images
  }

  const response = await runFollowUp(conversationHistory, taSnapshot, charts);

  await typing;

  await bot.api.sendMessage(telegramChatId, response, {
    parse_mode: "Markdown",
  });

  // Store bot response
  await prisma.analysisMessage.create({
    data: {
      sessionId,
      role: "assistant",
      contentJson: { text: response },
    },
  });
}
