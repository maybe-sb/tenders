import { v4 as uuidv4 } from "uuid";
import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { ITTItemEntity } from "@/types/domain";
import { ittItemSk, projectPk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const ITT_ITEM_PREFIX = "ITTITEM#";

type IttItemRecord = ITTItemEntity & {
  PK: string;
  SK: string;
  entityType: "ITTItem";
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
};

function isIttItemRecord(record: any): record is IttItemRecord {
  return record?.entityType === "ITTItem";
}

function mapToIttItemEntity(item: IttItemRecord): ITTItemEntity {
  return {
    ittItemId: item.ittItemId,
    projectId: item.projectId,
    sectionId: item.sectionId,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    qty: item.qty,
    rate: item.rate,
    amount: item.amount,
    meta: item.meta,
  };
}

async function queryIttItemRecords(ownerSub: string, projectId: string): Promise<IttItemRecord[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": ITT_ITEM_PREFIX,
      },
      ScanIndexForward: true,
    })
  );

  return (response.Items ?? [])
    .filter(isIttItemRecord)
    .filter((item) => item.ownerSub === ownerSub);
}

export async function getProjectIttItem(
  ownerSub: string,
  projectId: string,
  ittItemId: string
): Promise<ITTItemEntity | null> {
  const response = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: ittItemSk(ittItemId),
      },
    })
  );

  if (!response.Item || !isIttItemRecord(response.Item) || response.Item.ownerSub !== ownerSub) {
    return null;
  }

  return mapToIttItemEntity(response.Item);
}

export async function listProjectIttItems(ownerSub: string, projectId: string): Promise<ITTItemEntity[]> {
  const records = await queryIttItemRecords(ownerSub, projectId);
  return records.map(mapToIttItemEntity);
}

export interface UpsertIttItemInput {
  ittItemId?: string;
  sectionId: string;
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  meta?: Record<string, unknown>;
}

export async function upsertProjectIttItem(
  ownerSub: string,
  projectId: string,
  input: UpsertIttItemInput
): Promise<ITTItemEntity> {
  const ittItemId = input.ittItemId ?? uuidv4();
  const now = new Date().toISOString();

  const record: IttItemRecord = {
    PK: projectPk(projectId),
    SK: ittItemSk(ittItemId),
    entityType: "ITTItem",
    ownerSub,
    createdAt: now,
    updatedAt: now,
    ittItemId,
    projectId,
    sectionId: input.sectionId,
    itemCode: input.itemCode,
    description: input.description,
    unit: input.unit,
    qty: input.qty,
    rate: input.rate,
    amount: input.amount,
    meta: input.meta,
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );

  return mapToIttItemEntity(record);
}

export async function deleteProjectIttItems(ownerSub: string, projectId: string): Promise<void> {
  const records = await queryIttItemRecords(ownerSub, projectId);
  if (records.length === 0) {
    return;
  }

  const chunks: IttItemRecord[][] = [];
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
