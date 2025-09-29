import { v4 as uuidv4 } from "uuid";
import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { ResponseItemEntity } from "@/types/domain";
import {
  contractorGsiPk,
  contractorGsiSk,
  projectPk,
  responseItemSk,
} from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const RESPONSE_ITEM_PREFIX = "RESPITEM#";

type ResponseItemRecord = ResponseItemEntity & {
  PK: string;
  SK: string;
  entityType: "ResponseItem";
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK: string;
  GSI1SK: string;
};

function isResponseItemRecord(record: any): record is ResponseItemRecord {
  return record?.entityType === "ResponseItem";
}

function mapToResponseItemEntity(record: ResponseItemRecord): ResponseItemEntity {
  return {
    responseItemId: record.responseItemId,
    projectId: record.projectId,
    contractorId: record.contractorId,
    sectionGuess: record.sectionGuess,
    itemCode: record.itemCode,
    description: record.description,
    unit: record.unit,
    qty: record.qty,
    rate: record.rate,
    amount: record.amount,
    amountLabel: record.amountLabel,
    meta: record.meta,
  };
}

async function queryResponseItemRecords(ownerSub: string, projectId: string): Promise<ResponseItemRecord[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": RESPONSE_ITEM_PREFIX,
      },
      ScanIndexForward: true,
    })
  );

  return (response.Items ?? [])
    .filter(isResponseItemRecord)
    .filter((item) => item.ownerSub === ownerSub);
}

export async function getProjectResponseItem(
  ownerSub: string,
  projectId: string,
  responseItemId: string
): Promise<ResponseItemEntity | null> {
  const response = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: responseItemSk(responseItemId),
      },
    })
  );

  if (!response.Item || !isResponseItemRecord(response.Item) || response.Item.ownerSub !== ownerSub) {
    return null;
  }

  return mapToResponseItemEntity(response.Item);
}

export async function listProjectResponseItems(ownerSub: string, projectId: string): Promise<ResponseItemEntity[]> {
  const records = await queryResponseItemRecords(ownerSub, projectId);
  return records.map(mapToResponseItemEntity);
}

export async function listResponseItemsByContractor(
  ownerSub: string,
  contractorId: string
): Promise<ResponseItemEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": contractorGsiPk(contractorId),
      },
      ScanIndexForward: true,
    })
  );

  return (response.Items ?? [])
    .filter(isResponseItemRecord)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToResponseItemEntity);
}

export interface UpsertResponseItemInput {
  responseItemId?: string;
  contractorId: string;
  projectId: string;
  sectionGuess?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  amountLabel?: string;
  meta?: Record<string, unknown>;
}

export async function upsertProjectResponseItem(
  ownerSub: string,
  input: UpsertResponseItemInput
): Promise<ResponseItemEntity> {
  const responseItemId = input.responseItemId ?? uuidv4();
  const now = new Date().toISOString();

  const record: ResponseItemRecord = {
    PK: projectPk(input.projectId),
    SK: responseItemSk(responseItemId),
    entityType: "ResponseItem",
    ownerSub,
    createdAt: now,
    updatedAt: now,
    responseItemId,
    projectId: input.projectId,
    contractorId: input.contractorId,
    sectionGuess: input.sectionGuess,
    itemCode: input.itemCode,
    description: input.description,
    unit: input.unit,
    qty: input.qty,
    rate: input.rate,
    amount: input.amount,
    amountLabel: input.amountLabel,
    meta: input.meta,
    GSI1PK: contractorGsiPk(input.contractorId),
    GSI1SK: contractorGsiSk(responseItemId),
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );

  return mapToResponseItemEntity(record);
}

export async function deleteResponseItemsForContractor(
  ownerSub: string,
  contractorId: string
): Promise<void> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": contractorGsiPk(contractorId),
      },
      ScanIndexForward: true,
    })
  );

  const records = (response.Items ?? [])
    .filter(isResponseItemRecord)
    .filter((item) => item.ownerSub === ownerSub);

  if (!records.length) {
    return;
  }

  const chunks: ResponseItemRecord[][] = [];
  for (let i = 0; i < records.length; i += 25) {
    chunks.push(records.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    await ddbDocClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((item) => ({
            DeleteRequest: {
              Key: {
                PK: item.PK,
                SK: item.SK,
              },
            },
          })),
        },
      })
    );
  }
}
