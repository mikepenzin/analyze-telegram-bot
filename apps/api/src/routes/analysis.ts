import { prisma } from "@repo/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getAnalysisQueue, getFollowUpQueue } from "../queues.js";
import { classifyRequest } from "../services/classifier.js";
import { getOrCreateUser } from "../services/users.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const StartAnalysisBody = z.object({
  telegramId: z.string(),
  username: z.string().optional(),
  telegramChatId: z.number(),
  symbol: z.string().min(1).max(10).toUpperCase(),
});

const FollowUpBody = z.object({
  telegramId: z.string(),
  telegramChatId: z.number(),
  message: z.string().min(1).max(1000),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export const analysisRoutes: FastifyPluginAsync = async (app) => {
  // POST /analysis/start — create session + enqueue analysis job
  app.post("/start", async (request, reply) => {
    const result = StartAnalysisBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { telegramId, username, telegramChatId, symbol } = result.data;

    const user = await getOrCreateUser(telegramId, username);

    // Create a fresh session for every /analyze command
    const session = await prisma.analysisSession.create({
      data: {
        userId: user.id,
        activeSymbol: symbol,
        status: "active",
      },
    });

    // Store the user message
    await prisma.analysisMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        contentJson: { text: `/analyze ${symbol}` },
      },
    });

    const queue = getAnalysisQueue();
    const job = await queue.add("analyze", {
      sessionId: session.id,
      userId: user.id,
      telegramChatId,
      symbol,
      dailyRange: "9mo",
      weeklyRange: "3y",
      loopCount: 0,
    });

    return reply.status(202).send({ sessionId: session.id, jobId: job.id });
  });

  // POST /analysis/follow-up — classify + enqueue follow-up
  app.post("/follow-up", async (request, reply) => {
    const result = FollowUpBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { telegramId, telegramChatId, message } = result.data;

    const user = await getOrCreateUser(telegramId);

    // Get the most recent active/idle session for this user
    const session = await prisma.analysisSession.findFirst({
      where: {
        userId: user.id,
        status: { in: ["active", "idle"] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!session) {
      return reply
        .status(404)
        .send({ error: "No active session. Use /analyze SYMBOL to start." });
    }

    const classified = classifyRequest(message, session.activeSymbol);

    // Store user message
    await prisma.analysisMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        contentJson: { text: message },
      },
    });

    const queue = getFollowUpQueue();
    const job = await queue.add("followup", {
      sessionId: session.id,
      userId: user.id,
      telegramChatId,
      message,
      classifiedType: classified.type,
    });

    return reply.status(202).send({ sessionId: session.id, jobId: job.id });
  });
};
