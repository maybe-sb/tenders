import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { InsightsEntity, InsightsStatus } from "@/types/domain";
import { projectPk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const INSIGHTS_PREFIX = "INSIGHTS#";

function insightsSk(createdAt: string, insightsId: string): string {
  return `${INSIGHTS_PREFIX}${createdAt}#${insightsId}`;
}

function insightsGsiPk(insightsId: string): string {
  return `INSIGHTS#${insightsId}`;
}

interface InsightsRecord extends InsightsEntity {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "Insights";
  ownerSub: string;
}

function mapToInsightsEntity(item: InsightsRecord): InsightsEntity {
  return {
    insightsId: item.insightsId,
    projectId: item.projectId,
    status: item.status,
    insights: item.insights,
    model: item.model,
    truncated: item.truncated,
    createdAt: item.createdAt,
    completedAt: item.completedAt,
    errorMessage: item.errorMessage,
    requestedBy: item.requestedBy,
  };
}

function isInsightsRecord(record: any): record is InsightsRecord {
  return record?.entityType === "Insights";
}

export async function createInsightsJob(
  ownerSub: string,
  projectId: string
): Promise<InsightsEntity> {
  const now = new Date().toISOString();
  const insightsId = uuidv4();

  const record: InsightsRecord = {
    PK: projectPk(projectId),
    SK: insightsSk(now, insightsId),
    GSI1PK: insightsGsiPk(insightsId),
    GSI1SK: projectPk(projectId),
    entityType: "Insights",
    ownerSub,
    insightsId,
    projectId,
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

  return mapToInsightsEntity(record);
}

export async function updateInsightsStatus(
  projectId: string,
  insightsId: string,
  status: InsightsStatus,
  options: {
    insights?: string;
    model?: string;
    truncated?: boolean;
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

  if (options.insights !== undefined) {
    updateExpressions.push("insights = :insights");
    expressionAttributeValues[":insights"] = options.insights;
  }

  if (options.model !== undefined) {
    updateExpressions.push("model = :model");
    expressionAttributeValues[":model"] = options.model;
  }

  if (options.truncated !== undefined) {
    updateExpressions.push("truncated = :truncated");
    expressionAttributeValues[":truncated"] = options.truncated;
  }

  if (options.completedAt) {
    updateExpressions.push("completedAt = :completedAt");
    expressionAttributeValues[":completedAt"] = options.completedAt;
  }

  if (options.errorMessage) {
    updateExpressions.push("errorMessage = :errorMessage");
    expressionAttributeValues[":errorMessage"] = options.errorMessage;
  }

  // First get the insights to find its SK
  const insightsList = await listProjectInsights(projectId);
  const insights = insightsList.find((i) => i.insightsId === insightsId);

  if (!insights) {
    throw new Error(`Insights ${insightsId} not found in project ${projectId}`);
  }

  await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: insightsSk(insights.createdAt, insightsId),
      },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

export async function getInsights(insightsId: string): Promise<InsightsEntity | null> {
  // Query using GSI1 to find insights by insightsId
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": insightsGsiPk(insightsId),
      },
      Limit: 1,
    })
  );

  if (!response.Items || response.Items.length === 0) {
    return null;
  }

  const item = response.Items[0];
  if (!isInsightsRecord(item)) {
    return null;
  }

  return mapToInsightsEntity(item);
}

export async function listProjectInsights(projectId: string): Promise<InsightsEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": INSIGHTS_PREFIX,
      },
      ScanIndexForward: false, // Most recent first
    })
  );

  if (!response.Items) {
    return [];
  }

  return response.Items.filter(isInsightsRecord).map(mapToInsightsEntity);
}

export async function getLatestReadyInsights(projectId: string): Promise<InsightsEntity | null> {
  const insightsList = await listProjectInsights(projectId);
  return insightsList.find((insights) => insights.status === "ready") || null;
}
