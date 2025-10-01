import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { ReportEntity, ReportStatus, ReportType } from "@/types/domain";
import { projectPk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const REPORT_PREFIX = "REPORT#";

function reportSk(createdAt: string, reportId: string): string {
  return `${REPORT_PREFIX}${createdAt}#${reportId}`;
}

function reportGsiPk(reportId: string): string {
  return `REPORT#${reportId}`;
}

interface ReportRecord extends ReportEntity {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "Report";
  ownerSub: string;
}

function mapToReportEntity(item: ReportRecord): ReportEntity {
  return {
    reportId: item.reportId,
    projectId: item.projectId,
    reportKey: item.reportKey,
    type: item.type,
    status: item.status,
    createdAt: item.createdAt,
    completedAt: item.completedAt,
    errorMessage: item.errorMessage,
    requestedBy: item.requestedBy,
  };
}

function isReportRecord(record: any): record is ReportRecord {
  return record?.entityType === "Report";
}

export async function createReport(
  ownerSub: string,
  projectId: string,
  reportKey: string,
  type: ReportType = "ASSESSMENT_SUMMARY"
): Promise<ReportEntity> {
  const now = new Date().toISOString();
  const reportId = uuidv4();

  const record: ReportRecord = {
    PK: projectPk(projectId),
    SK: reportSk(now, reportId),
    GSI1PK: reportGsiPk(reportId),
    GSI1SK: projectPk(projectId),
    entityType: "Report",
    ownerSub,
    reportId,
    projectId,
    reportKey,
    type,
    status: "pending",
    createdAt: now,
    requestedBy: ownerSub,
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );

  return mapToReportEntity(record);
}

export async function updateReportStatus(
  projectId: string,
  reportId: string,
  status: ReportStatus,
  options: {
    errorMessage?: string;
    completedAt?: string;
  } = {}
): Promise<void> {
  const updateExpressions: string[] = ["#status = :status", "updatedAt = :now"];
  const expressionAttributeNames: Record<string, string> = { "#status": "status" };
  const expressionAttributeValues: Record<string, any> = {
    ":status": status,
    ":now": new Date().toISOString(),
  };

  if (options.completedAt) {
    updateExpressions.push("completedAt = :completedAt");
    expressionAttributeValues[":completedAt"] = options.completedAt;
  }

  if (options.errorMessage) {
    updateExpressions.push("errorMessage = :errorMessage");
    expressionAttributeValues[":errorMessage"] = options.errorMessage;
  }

  // First get the report to find its SK
  const reports = await listProjectReports(projectId);
  const report = reports.find((r) => r.reportId === reportId);

  if (!report) {
    throw new Error(`Report ${reportId} not found in project ${projectId}`);
  }

  await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: reportSk(report.createdAt, reportId),
      },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

export async function getReport(reportId: string): Promise<ReportEntity | null> {
  // Query using GSI1 to find report by reportId
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": reportGsiPk(reportId),
      },
      Limit: 1,
    })
  );

  if (!response.Items || response.Items.length === 0) {
    return null;
  }

  const item = response.Items[0];
  if (!isReportRecord(item)) {
    return null;
  }

  return mapToReportEntity(item);
}

export async function listProjectReports(projectId: string): Promise<ReportEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": REPORT_PREFIX,
      },
      ScanIndexForward: false, // Most recent first
    })
  );

  if (!response.Items) {
    return [];
  }

  return response.Items.filter(isReportRecord).map(mapToReportEntity);
}

export async function getLatestReadyReport(projectId: string): Promise<ReportEntity | null> {
  const reports = await listProjectReports(projectId);
  return reports.find((report) => report.status === "ready") || null;
}
