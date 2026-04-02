import { prisma, Prisma } from "@repo/db";
import { fetchCandles } from "@repo/market-data";
import { buildTASnapshot } from "@repo/ta-engine";
import { renderChart } from "@repo/chart";
import {
  runInitialAnalysis,
  formatSnapshotText,
  type AnalysisInput,
} from "@repo/llm";
import type { AnalysisJobData, LLMAnalysisResult, LLMMoreDataRequest } from "@repo/shared";
import { getTelegramBot } from "../telegram.js";
import { InputFile } from "grammy";

const MAX_LOOPS = 2;

export async function runAnalysisJob(data: AnalysisJobData): Promise<void> {
  const {
    sessionId,
    telegramChatId,
    symbol,
    dailyRange,
    weeklyRange,
    loopCount = 0,
  } = data;

  const bot = getTelegramBot();

  // Step 1: Status message
  const statusMsg = await bot.api.sendMessage(
    telegramChatId,
    `🔍 Analyzing *${symbol}*... fetching data`,
    { parse_mode: "Markdown" }
  );

  try {
    // Step 2: Fetch candles
    console.log(`[analysis] fetching candles for ${symbol}...`);
    const [dailyCandles, weeklyCandles] = await Promise.all([
      fetchCandles({ symbol, timeframe: "1d", range: dailyRange }),
      fetchCandles({ symbol, timeframe: "1wk", range: weeklyRange }),
    ]);
    console.log(`[analysis] daily: ${dailyCandles.length} candles, weekly: ${weeklyCandles.length} candles`);

    if (dailyCandles.length === 0) {
      await bot.api.editMessageText(
        telegramChatId,
        statusMsg.message_id,
        `❌ Symbol *${symbol}* not found or no data available.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await bot.api.editMessageText(
      telegramChatId,
      statusMsg.message_id,
      `📐 *${symbol}* — computing indicators...`,
      { parse_mode: "Markdown" }
    );

    // Step 3: Compute TA
    console.log(`[analysis] computing TA...`);
    const [dailySnapshot, weeklySnapshot] = [
      buildTASnapshot(dailyCandles, symbol, "1d"),
      buildTASnapshot(weeklyCandles, symbol, "1wk"),
    ];
    console.log(`[analysis] TA done`);

    // Step 4: Render charts (Telegram 900px + LLM 1600px)
    console.log(`[analysis] rendering charts...`);
    const [dailyChart900, weeklyChart900, dailyChart1600, weeklyChart1600] =
      await Promise.all([
        renderChart(dailyCandles, dailySnapshot, { width: 900, timeframe: "1d" }),
        renderChart(weeklyCandles, weeklySnapshot, { width: 900, timeframe: "1wk" }),
        renderChart(dailyCandles, dailySnapshot, { width: 1600, timeframe: "1d" }),
        renderChart(weeklyCandles, weeklySnapshot, { width: 1600, timeframe: "1wk" }),
      ]);
    console.log(`[analysis] charts rendered`);

    await bot.api.editMessageText(
      telegramChatId,
      statusMsg.message_id,
      `🤖 *${symbol}* — running AI analysis...`,
      { parse_mode: "Markdown" }
    );

    // Step 5: Run LLM
    const input: AnalysisInput = {
      dailySnapshot,
      weeklySnapshot,
      dailyChartBase64: dailyChart1600.toString("base64"),
      weeklyChartBase64: weeklyChart1600.toString("base64"),
    };

    console.log(`[analysis] calling LLM...`);
    const llmResult = await runInitialAnalysis(input, loopCount);
    console.log(`[analysis] LLM done, needsMoreData:`, llmResult.needsMoreData);

    // Handle "needs more data" loop
    if (llmResult.needsMoreData === true) {
      const moreData = llmResult as LLMMoreDataRequest;
      if (loopCount < MAX_LOOPS) {
        const newDailyRange =
          moreData.timeframe === "1d" ? moreData.range : dailyRange;
        const newWeeklyRange =
          moreData.timeframe === "1wk" ? moreData.range : weeklyRange;

        return runAnalysisJob({
          ...data,
          dailyRange: newDailyRange,
          weeklyRange: newWeeklyRange,
          loopCount: loopCount + 1,
        });
      }
    }

    // Step 6: Store analysis in DB
    const analysis = await prisma.analysis.create({
      data: {
        sessionId,
        symbol,
        resultJson:
          llmResult.needsMoreData === true ? Prisma.JsonNull : (llmResult as object),
      },
    });

    await Promise.all([
      prisma.tASnapshot.create({
        data: {
          analysisId: analysis.id,
          snapshotJson: dailySnapshot as unknown as object,
        },
      }),
      prisma.tASnapshot.create({
        data: {
          analysisId: analysis.id,
          snapshotJson: weeklySnapshot as unknown as object,
        },
      }),
    ]);

    // Update session with latest analysis ID
    await prisma.analysisSession.update({
      where: { id: sessionId },
      data: { lastAnalysisId: analysis.id, status: "active" },
    });

    // Step 7: Send to Telegram in correct order
    // Delete status message first
    await bot.api.deleteMessage(telegramChatId, statusMsg.message_id).catch(() => {});

    // 7a: Daily chart
    const dailyChartMsg = await bot.api.sendPhoto(
      telegramChatId,
      new InputFile(dailyChart900, "daily.png"),
      {
        caption: `📈 *${symbol}* — Daily`,
        parse_mode: "Markdown",
      }
    );

    // 7b: Weekly chart
    const weeklyChartMsg = await bot.api.sendPhoto(
      telegramChatId,
      new InputFile(weeklyChart900, "weekly.png"),
      {
        caption: `📊 *${symbol}* — Weekly`,
        parse_mode: "Markdown",
      }
    );

    // Store chart artifacts with Telegram file IDs
    const dailyFileId =
      dailyChartMsg.photo?.[dailyChartMsg.photo.length - 1]?.file_id;
    const weeklyFileId =
      weeklyChartMsg.photo?.[weeklyChartMsg.photo.length - 1]?.file_id;

    await Promise.all([
      prisma.chartArtifact.create({
        data: {
          analysisId: analysis.id,
          imagePath: `telegram:${dailyFileId}`,
          telegramFileId: dailyFileId,
          timeframe: "1d",
          width: 900,
        },
      }),
      prisma.chartArtifact.create({
        data: {
          analysisId: analysis.id,
          imagePath: `telegram:${weeklyFileId}`,
          telegramFileId: weeklyFileId,
          timeframe: "1wk",
          width: 900,
        },
      }),
    ]);

    // 7c: TA Snapshot text
    await bot.api.sendMessage(
      telegramChatId,
      formatSnapshotText(dailySnapshot),
      { parse_mode: "Markdown" }
    );

    // 7d: LLM Commentary
    if (llmResult.needsMoreData !== true) {
      const result = llmResult as LLMAnalysisResult;
      const patternLine =
        result.patterns?.length
          ? `\n*Patterns:* ${result.patterns.join(", ")}\n`
          : "";
      const commentary = [
        `💬 *Analysis*`,
        ``,
        result.summary,
        ``,
        result.commentary,
        patternLine,
        `*Confidence:* ${(result.confidence * 100).toFixed(0)}%`,
      ].join("\n");

      await bot.api.sendMessage(telegramChatId, commentary, {
        parse_mode: "Markdown",
      });

      // Store bot response
      await prisma.analysisMessage.create({
        data: {
          sessionId,
          role: "assistant",
          contentJson: { llmResult: result },
        },
      });
    }

    // 7e: Suggestions
    await bot.api.sendMessage(
      telegramChatId,
      `💡 *Follow-up suggestions:*\n• What are the key support levels?\n• Show weekly\n• Is the trend strong?`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[analysis handler] error:", err);
    await bot.api
      .editMessageText(
        telegramChatId,
        statusMsg.message_id,
        `❌ Analysis failed. Please try again.`
      )
      .catch(() => {});
    throw err;
  }
}
