import type { ApiEvent } from "@/lib/api-utils";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { jsonResponse } from "@/lib/response";
import { getOwnerSub, getPathParam } from "@/lib/api-utils";
import { getProjectItem } from "@/lib/repository/projects";
import { sendQueueMessage } from "@/lib/queues";
import { getEnv } from "@/lib/env";
import { loadAssessment } from "@/lib/services/assessment";
import { logger } from "@/lib/logger";
import { generateAssessmentInsights } from "@/lib/services/assessment-insights";
import { randomUUID } from "node:crypto";
import { s3Client } from "@/lib/s3";
import { createReport, getReport as getReportRecord, listProjectReports } from "@/lib/repository/reports";

export async function getAssessment(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const assessment = await loadAssessment(ownerSub, projectId);
  if (!assessment) {
    return jsonResponse(404, { message: "Project not found" });
  }

  return jsonResponse(200, assessment);
}

export async function generateReport(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const env = getEnv();
  if (!env.REPORT_QUEUE_URL) {
    logger.error("Report queue URL is not configured");
    return jsonResponse(500, { message: "Report generation queue is not configured" });
  }

  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const reportKey = buildReportKey(projectId);

  // Create report record in database
  const report = await createReport(ownerSub, projectId, reportKey, "ASSESSMENT_SUMMARY");

  await sendQueueMessage(env.REPORT_QUEUE_URL, {
    type: "ASSESSMENT_SUMMARY",
    ownerSub,
    projectId,
    reportId: report.reportId,
    reportKey,
    requestedAt: new Date().toISOString(),
  });

  logger.info("Enqueued report generation", { projectId, reportId: report.reportId, reportKey });

  return jsonResponse(202, {
    reportId: report.reportId,
    status: report.status,
    createdAt: report.createdAt,
  });
}

function buildReportKey(projectId: string): string {
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const unique = randomUUID();
  return `projects/${projectId}/reports/${now}-${unique}/assessment-summary.pdf`;
}

export async function getReport(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const env = getEnv();
  if (!env.ARTIFACTS_BUCKET) {
    logger.error("Artifacts bucket not configured");
    return jsonResponse(500, { message: "Report storage is not configured" });
  }

  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");
  const reportIdParam = getPathParam(params, "reportId");
  const reportId = decodeURIComponent(reportIdParam);

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  // Get report record from database
  const report = await getReportRecord(reportId);
  if (!report || report.projectId !== projectId) {
    return jsonResponse(404, { message: "Report not found" });
  }

  // Check report status
  if (report.status === "failed") {
    return jsonResponse(500, {
      message: report.errorMessage || "Report generation failed",
      status: "failed",
    });
  }

  if (report.status === "pending" || report.status === "generating") {
    return jsonResponse(202, {
      message: "Report is still being generated",
      status: report.status,
      reportId: report.reportId,
      createdAt: report.createdAt,
    });
  }

  // Status is "ready" - generate signed URL
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: env.ARTIFACTS_BUCKET,
        Key: report.reportKey,
      })
    );
  } catch (error) {
    const code = (error as any)?.$metadata?.httpStatusCode;
    if (code === 404 || (error as any)?.name === "NotFound" || (error as any)?.Code === "NotFound") {
      return jsonResponse(404, { message: "Report file not found in storage" });
    }

    logger.error("Failed to check report existence", {
      message: error instanceof Error ? error.message : String(error),
      projectId,
      reportKey: report.reportKey,
    });
    return jsonResponse(500, { message: "Failed to load report" });
  }

  const signedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: env.ARTIFACTS_BUCKET,
      Key: report.reportKey,
    }),
    { expiresIn: 60 * 15 }
  );

  return jsonResponse(200, {
    url: signedUrl,
    status: report.status,
    reportId: report.reportId,
    createdAt: report.createdAt,
    completedAt: report.completedAt,
  });
}

export async function listReports(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const reports = await listProjectReports(projectId);

  return jsonResponse(200, { reports });
}

export async function generateInsights(
  event: ApiEvent,
  params: Record<string, string>
): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const assessment = await loadAssessment(ownerSub, projectId);
  if (!assessment) {
    return jsonResponse(404, { message: "Project not found" });
  }

  try {
    const result = await generateAssessmentInsights(projectId, assessment);
    return jsonResponse(200, {
      insights: result.insights,
      generatedAt: new Date().toISOString(),
      model: result.model,
      truncated: result.truncated,
    });
  } catch (error) {
    logger.error("Failed to generate assessment insights", {
      projectId,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { message: "Failed to generate insights" });
  }
}
