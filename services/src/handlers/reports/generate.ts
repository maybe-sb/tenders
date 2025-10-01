import type { SQSEvent, SQSRecord } from "aws-lambda";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";
import { s3Client } from "@/lib/s3";
import { loadAssessment } from "@/lib/services/assessment";
import { renderAssessmentSummaryHtml } from "@/lib/reports/render";
import { updateReportStatus } from "@/lib/repository/reports";
import { generateAssessmentInsights } from "@/lib/services/assessment-insights";

interface ReportJob {
  type: "ASSESSMENT_SUMMARY";
  ownerSub: string;
  projectId: string;
  reportId: string;
  reportKey: string;
  requestedAt?: string;
}

const ReportJobSchema = z.object({
  type: z.literal("ASSESSMENT_SUMMARY"),
  ownerSub: z.string().min(1),
  projectId: z.string().min(1),
  reportId: z.string().min(1),
  reportKey: z.string().min(1),
  requestedAt: z.string().optional(),
});

export async function handler(event: SQSEvent) {
  logger.info("generate-report invoked", { records: event.Records.length });
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error("Failed to process report job", {
        message: error instanceof Error ? error.message : String(error),
        record: record.messageId,
      });
      throw error;
    }
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  const payload = parseJobPayload(record.body);
  const env = getEnv();

  if (!env.ARTIFACTS_BUCKET) {
    throw new Error("ARTIFACTS_BUCKET is not configured");
  }

  if (payload.type !== "ASSESSMENT_SUMMARY") {
    logger.warn("Unsupported report job type", { type: payload.type });
    return;
  }

  try {
    // Update status to "generating"
    await updateReportStatus(payload.projectId, payload.reportId, "generating");

    const assessment = await loadAssessment(payload.ownerSub, payload.projectId);
    if (!assessment) {
      logger.warn("Project not found for report job", {
        projectId: payload.projectId,
        ownerSub: payload.ownerSub,
      });
      await updateReportStatus(payload.projectId, payload.reportId, "failed", {
        errorMessage: "Project not found",
      });
      return;
    }

    let insightsText: string | null = null;
    try {
      const { insights } = await generateAssessmentInsights(payload.projectId, assessment);
      insightsText = insights;
    } catch (insightsError) {
      logger.warn("Failed to generate insights for report", {
        projectId: payload.projectId,
        reportId: payload.reportId,
        error: insightsError instanceof Error ? insightsError.message : String(insightsError),
      });
    }

    const html = renderAssessmentSummaryHtml(assessment, {
      insights: insightsText,
    });
    const pdfBuffer = await generatePdf(html);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.ARTIFACTS_BUCKET,
        Key: payload.reportKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    // Update status to "ready"
    const completedAt = new Date().toISOString();
    await updateReportStatus(payload.projectId, payload.reportId, "ready", { completedAt });

    logger.info("Report written to S3", {
      projectId: payload.projectId,
      reportId: payload.reportId,
      key: payload.reportKey,
    });
  } catch (error) {
    logger.error("Failed to generate report", {
      projectId: payload.projectId,
      reportId: payload.reportId,
      error: error instanceof Error ? error.message : String(error),
    });

    await updateReportStatus(payload.projectId, payload.reportId, "failed", {
      errorMessage: error instanceof Error ? error.message : "Unknown error occurred",
    });

    throw error;
  }
}

function parseJobPayload(body: string): ReportJob {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  return ReportJobSchema.parse(data) as ReportJob;
}

async function generatePdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "16mm", right: "16mm" },
      displayHeaderFooter: false,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
