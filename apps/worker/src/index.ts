import 'dotenv/config';
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { runAnalysisJob } from "./handlers/analysis.js";
import { runFollowUpJob } from "./handlers/followup.js";
import type { AnalysisJobData, FollowUpJobData } from "@repo/shared";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is not set");

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// ─── Analysis Worker ──────────────────────────────────────────────────────────

const analysisWorker = new Worker<AnalysisJobData>(
  "analysis",
  async (job) => {
    console.log(`[analysis] Processing job ${job.id} for ${job.data.symbol}`);
    await runAnalysisJob(job.data);
  },
  { connection, concurrency: 2 }
);

// ─── Follow-up Worker ─────────────────────────────────────────────────────────

const followUpWorker = new Worker<FollowUpJobData>(
  "followup",
  async (job) => {
    console.log(`[followup] Processing job ${job.id}`);
    await runFollowUpJob(job.data);
  },
  { connection, concurrency: 5 }
);

// ─── Error Handling ───────────────────────────────────────────────────────────

analysisWorker.on("failed", (job, err) => {
  console.error(`[analysis] Job ${job?.id} failed:`, err);
});

followUpWorker.on("failed", (job, err) => {
  console.error(`[followup] Job ${job?.id} failed:`, err);
});

analysisWorker.on("error", (err) => console.error("[analysis] Worker error:", err));
followUpWorker.on("error", (err) => console.error("[followup] Worker error:", err));

process.on("uncaughtException", (err) => console.error("[worker] Uncaught exception:", err));
process.on("unhandledRejection", (err) => console.error("[worker] Unhandled rejection:", err));

console.log("Worker started — listening for jobs...");
