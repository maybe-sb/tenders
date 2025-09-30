import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { ExceptionEntity } from "@/types/domain";
import {
  exceptionSk,
  projectExceptionGsiPk,
  projectExceptionGsiSk,
  projectPk,
  responseItemSk,
} from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const EXCEPTION_PREFIX = "EXCEPTION#";

type ExceptionRecord = ExceptionEntity & {
  PK: string;
  SK: string;
  entityType: "Exception";
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
};

function isExceptionRecord(record: any): record is ExceptionRecord {
  return record?.entityType === "Exception";
}

function mapToExceptionEntity(record: ExceptionRecord): ExceptionEntity {
  return {
    exceptionId: record.exceptionId,
    projectId: record.projectId,
    responseItemId: record.responseItemId,
    contractorId: record.contractorId,
    sectionId: record.sectionId,
    note: record.note,
    amount: record.amount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listProjectExceptions(ownerSub: string, projectId: string): Promise<ExceptionEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": EXCEPTION_PREFIX,
      },
      ScanIndexForward: false,
    })
  );

  return (response.Items ?? [])
    .filter(isExceptionRecord)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToExceptionEntity);
}

export interface UpsertExceptionInput {
  exceptionId?: string;
  projectId: string;
  responseItemId: string;
  contractorId: string;
  sectionId?: string;
  note?: string;
  amount?: number;
}

export async function upsertProjectException(
  ownerSub: string,
  input: UpsertExceptionInput
): Promise<ExceptionEntity> {
  const exceptionId = input.exceptionId ?? uuidv4();
  const now = new Date().toISOString();

  const record: ExceptionRecord = {
    exceptionId,
    projectId: input.projectId,
    responseItemId: input.responseItemId,
    contractorId: input.contractorId,
    sectionId: input.sectionId,
    note: input.note,
    amount: input.amount,
    createdAt: now,
    updatedAt: now,
    PK: projectPk(input.projectId),
    SK: exceptionSk(exceptionId),
    entityType: "Exception",
    ownerSub,
    GSI1PK: responseItemSk(input.responseItemId),
    GSI1SK: exceptionSk(exceptionId),
    GSI2PK: projectExceptionGsiPk(input.projectId),
    GSI2SK: projectExceptionGsiSk(now, exceptionId),
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );

  return mapToExceptionEntity(record);
}

export async function findProjectExceptionByResponseItem(
  ownerSub: string,
  responseItemId: string
): Promise<ExceptionEntity | null> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": responseItemSk(responseItemId),
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );

  const item = (response.Items ?? [])
    .filter(isExceptionRecord)
    .find((record) => record.ownerSub === ownerSub);

  return item ? mapToExceptionEntity(item) : null;
}
