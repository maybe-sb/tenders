import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { DocumentEntity, DocumentParseStatus, DocumentStats } from "@/types/domain";
import { documentSk, projectPk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const DOCUMENT_PREFIX = "DOC#";

interface DocumentItem extends DocumentEntity {
  PK: string;
  SK: string;
  entityType: "Document";
  ownerSub: string;
}

export interface CreateDocumentInput {
  type: DocumentEntity["type"];
  source: DocumentEntity["source"];
  s3KeyRaw: string;
  fileName: string;
  contractorId?: string;
  contractorName?: string;
}

export interface UpdateDocumentMetadataInput {
  parseStatus?: DocumentParseStatus;
  s3KeyExtracted?: string;
  stats?: DocumentStats;
}

function mapToDocumentEntity(item: DocumentItem): DocumentEntity {
  return {
    docId: item.docId,
    projectId: item.projectId,
    type: item.type,
    contractorId: item.contractorId,
    contractorName: item.contractorName,
    source: item.source,
    fileName: item.fileName,
    s3KeyRaw: item.s3KeyRaw,
    s3KeyExtracted: item.s3KeyExtracted,
    parseStatus: item.parseStatus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stats: item.stats,
  };
}

function isDocumentItem(record: any): record is DocumentItem {
  return record?.entityType === "Document";
}

export async function createDocument(
  ownerSub: string,
  projectId: string,
  input: CreateDocumentInput
): Promise<DocumentEntity> {
  const now = new Date().toISOString();
  const docId = uuidv4();

  const item: DocumentItem = {
    PK: projectPk(projectId),
    SK: documentSk(now, docId),
    entityType: "Document",
    ownerSub,
    docId,
    projectId,
    type: input.type,
    contractorId: input.contractorId,
    contractorName: input.contractorName,
    source: input.source,
    fileName: input.fileName,
    s3KeyRaw: input.s3KeyRaw,
    parseStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };

  if (input.type === "response" && input.contractorId) {
    item.contractorId = input.contractorId;
    item.contractorName = input.contractorName;
  }

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return mapToDocumentEntity(item);
}

export async function listProjectDocuments(
  ownerSub: string,
  projectId: string
): Promise<DocumentEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: {
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": DOCUMENT_PREFIX,
      },
      ScanIndexForward: false,
    })
  );

  return (response.Items ?? [])
    .filter(isDocumentItem)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToDocumentEntity);
}

async function getDocumentItem(
  ownerSub: string,
  projectId: string,
  docId: string
): Promise<DocumentItem | null> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": DOCUMENT_PREFIX,
      },
      ScanIndexForward: false,
    })
  );

  const match = (response.Items ?? []).find(
    (item): item is DocumentItem => isDocumentItem(item) && item.docId === docId && item.ownerSub === ownerSub
  );

  return match ?? null;
}

export async function updateDocumentMetadata(
  ownerSub: string,
  projectId: string,
  docId: string,
  updates: UpdateDocumentMetadataInput
): Promise<DocumentEntity | null> {
  const existing = await getDocumentItem(ownerSub, projectId, docId);
  if (!existing) {
    return null;
  }

  const expressionParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = { "#updatedAt": "updatedAt" };
  const expressionAttributeValues: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };

  if (updates.parseStatus) {
    expressionParts.push("#parseStatus = :parseStatus");
    expressionAttributeNames["#parseStatus"] = "parseStatus";
    expressionAttributeValues[":parseStatus"] = updates.parseStatus;
  }

  if (updates.s3KeyExtracted) {
    expressionParts.push("#s3KeyExtracted = :s3KeyExtracted");
    expressionAttributeNames["#s3KeyExtracted"] = "s3KeyExtracted";
    expressionAttributeValues[":s3KeyExtracted"] = updates.s3KeyExtracted;
  }

  if (updates.stats) {
    expressionParts.push("#stats = :stats");
    expressionAttributeNames["#stats"] = "stats";
    expressionAttributeValues[":stats"] = updates.stats;
  }

  if (expressionParts.length === 0) {
    return mapToDocumentEntity(existing);
  }

  const result = await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: existing.PK,
        SK: existing.SK,
      },
      UpdateExpression: "SET " + expressionParts.join(", ") + ", #updatedAt = :updatedAt",
      ConditionExpression: "ownerSub = :ownerSub",
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
      },
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ":ownerSub": ownerSub,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return mapToDocumentEntity(result.Attributes as DocumentItem);
}
