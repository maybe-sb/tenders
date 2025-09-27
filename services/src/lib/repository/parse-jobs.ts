import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { ParseJobEntity, ParseJobStatus } from "@/types/domain";
import { jobSk, projectPk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const JOB_PREFIX = "JOB#";

interface ParseJobItem extends ParseJobEntity {
  PK: string;
  SK: string;
  entityType: "ParseJob";
  ownerSub: string;
}

function mapToParseJobEntity(item: ParseJobItem): ParseJobEntity {
  return {
    jobId: item.jobId,
    projectId: item.projectId,
    documentId: item.documentId,
    status: item.status,
    message: item.message,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isParseJobItem(record: any): record is ParseJobItem {
  return record?.entityType === "ParseJob";
}

export async function createParseJob(
  ownerSub: string,
  projectId: string,
  documentId: string
): Promise<ParseJobEntity> {
  const now = new Date().toISOString();
  const jobId = uuidv4();

  const item: ParseJobItem = {
    PK: projectPk(projectId),
    SK: jobSk(now, jobId),
    entityType: "ParseJob",
    ownerSub,
    jobId,
    projectId,
    documentId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return mapToParseJobEntity(item);
}

export async function listParseJobs(ownerSub: string, projectId: string): Promise<ParseJobEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": JOB_PREFIX,
      },
      ScanIndexForward: false,
    })
  );

  return (response.Items ?? [])
    .filter(isParseJobItem)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToParseJobEntity);
}

export interface UpdateParseJobInput {
  status?: ParseJobStatus;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}

export async function updateParseJob(
  ownerSub: string,
  projectId: string,
  jobId: string,
  updates: UpdateParseJobInput
): Promise<ParseJobEntity | null> {
  const items = await listParseJobs(ownerSub, projectId);
  const existing = items.find((job) => job.jobId === jobId);
  if (!existing) {
    return null;
  }

  const expressionParts: string[] = [];
  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };

  if (updates.status) {
    expressionParts.push("#status = :status");
    names["#status"] = "status";
    values[":status"] = updates.status;
  }

  if (updates.message !== undefined) {
    expressionParts.push("#message = :message");
    names["#message"] = "message";
    values[":message"] = updates.message;
  }

  if (updates.startedAt) {
    expressionParts.push("#startedAt = :startedAt");
    names["#startedAt"] = "startedAt";
    values[":startedAt"] = updates.startedAt;
  }

  if (updates.finishedAt) {
    expressionParts.push("#finishedAt = :finishedAt");
    names["#finishedAt"] = "finishedAt";
    values[":finishedAt"] = updates.finishedAt;
  }

  if (!expressionParts.length) {
    return existing;
  }

  const sk = jobSk(existing.createdAt, existing.jobId);

  const result = await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: sk,
      },
      UpdateExpression: "SET " + expressionParts.join(", ") + ", #updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND ownerSub = :ownerSub",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: {
        ...values,
        ":ownerSub": ownerSub,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return mapToParseJobEntity(result.Attributes as ParseJobItem);
}
