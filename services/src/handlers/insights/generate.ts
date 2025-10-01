import type { SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { loadAssessment } from "@/lib/services/assessment";
import { generateAssessmentInsights } from "@/lib/services/assessment-insights";
import { updateInsightsStatus } from "@/lib/repository/insights";

interface InsightsJob {
  ownerSub: string;
  projectId: string;
  insightsId: string;
  requestedAt?: string;
}

const InsightsJobSchema = z.object({
  ownerSub: z.string().min(1),
  projectId: z.string().min(1),
  insightsId: z.string().min(1),
  requestedAt: z.string().optional(),
});

export async function handler(event: SQSEvent) {
  logger.info("generate-insights invoked", { records: event.Records.length });
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error("Failed to process insights job", {
        message: error instanceof Error ? error.message : String(error),
        record: record.messageId,
      });
      throw error;
    }
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  const payload = parseJobPayload(record.body);

  try {
    // Update status to "generating"
    await updateInsightsStatus(payload.projectId, payload.insightsId, "generating");

    const assessment = await loadAssessment(payload.ownerSub, payload.projectId);
    if (!assessment) {
      logger.warn("Project not found for insights job", {
        projectId: payload.projectId,
        ownerSub: payload.ownerSub,
      });
      await updateInsightsStatus(payload.projectId, payload.insightsId, "failed", {
        errorMessage: "Project not found",
      });
      return;
    }

    const result = await generateAssessmentInsights(payload.projectId, assessment);

    // Update status to "ready" with insights data
    const completedAt = new Date().toISOString();
    await updateInsightsStatus(payload.projectId, payload.insightsId, "ready", {
      insights: result.insights,
      model: result.model,
      truncated: result.truncated,
      completedAt,
    });

    logger.info("Insights generated successfully", {
      projectId: payload.projectId,
      insightsId: payload.insightsId,
      model: result.model,
      truncated: result.truncated,
    });
  } catch (error) {
    logger.error("Failed to generate insights", {
      projectId: payload.projectId,
      insightsId: payload.insightsId,
      error: error instanceof Error ? error.message : String(error),
    });

    await updateInsightsStatus(payload.projectId, payload.insightsId, "failed", {
      errorMessage: error instanceof Error ? error.message : "Unknown error occurred",
    });

    throw error;
  }
}

function parseJobPayload(body: string): InsightsJob {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  return InsightsJobSchema.parse(data) as InsightsJob;
}
