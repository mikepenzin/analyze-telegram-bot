import { Queue } from "bullmq";
import { getRedis } from "./redis.js";
import type { AnalysisJobData, FollowUpJobData } from "@repo/shared";

export const ANALYSIS_QUEUE = "analysis";
export const FOLLOWUP_QUEUE = "followup";

let _analysisQueue: Queue<AnalysisJobData> | null = null;
let _followUpQueue: Queue<FollowUpJobData> | null = null;

export function getAnalysisQueue(): Queue<AnalysisJobData> {
  if (!_analysisQueue) {
    _analysisQueue = new Queue<AnalysisJobData>(ANALYSIS_QUEUE, {
      connection: getRedis(),
    });
  }
  return _analysisQueue;
}

export function getFollowUpQueue(): Queue<FollowUpJobData> {
  if (!_followUpQueue) {
    _followUpQueue = new Queue<FollowUpJobData>(FOLLOWUP_QUEUE, {
      connection: getRedis(),
    });
  }
  return _followUpQueue;
}
