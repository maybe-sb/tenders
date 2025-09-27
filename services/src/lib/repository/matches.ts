import { v4 as uuidv4 } from "uuid";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { MatchEntity } from "@/types/domain";
import {
  matchSk,
  matchStatusGsiPk,
  matchStatusGsiSk,
  projectPk,
  responseItemSk,
} from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const MATCH_PREFIX = "MATCH#";

type MatchRecord = MatchEntity & {
  PK: string;
  SK: string;
  entityType: "Match";
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
};

function isMatchRecord(record: any): record is MatchRecord {
  return record?.entityType === "Match";
}

function mapToMatchEntity(record: MatchRecord): MatchEntity {
  return {
    matchId: record.matchId,
    projectId: record.projectId,
    ittItemId: record.ittItemId,
    contractorId: record.contractorId,
    responseItemId: record.responseItemId,
    status: record.status,
    confidence: record.confidence,
    comment: record.comment,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildMatchRecord(
  ownerSub: string,
  input: MatchEntity & { createdAt?: string; updatedAt?: string }
): MatchRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    ...input,
    ownerSub,
    createdAt,
    updatedAt,
    PK: projectPk(input.projectId),
    SK: matchSk(input.matchId),
    entityType: "Match",
    GSI1PK: responseItemSk(input.responseItemId),
    GSI1SK: matchSk(input.matchId),
    GSI2PK: matchStatusGsiPk(input.projectId, input.status),
    GSI2SK: matchStatusGsiSk(updatedAt, input.matchId),
  };
}

async function getMatchRecord(
  ownerSub: string,
  projectId: string,
  matchId: string
): Promise<MatchRecord | null> {
  const response = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: matchSk(matchId),
      },
    })
  );

  if (!response.Item || !isMatchRecord(response.Item) || response.Item.ownerSub !== ownerSub) {
    return null;
  }

  return response.Item as MatchRecord;
}

export async function getProjectMatch(
  ownerSub: string,
  projectId: string,
  matchId: string
): Promise<MatchEntity | null> {
  const record = await getMatchRecord(ownerSub, projectId, matchId);
  return record ? mapToMatchEntity(record) : null;
}

export async function listProjectMatches(
  ownerSub: string,
  projectId: string,
  options?: { status?: MatchEntity["status"] | "all" }
): Promise<MatchEntity[]> {
  if (options?.status && options.status !== "all") {
    const response = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :gsi2pk",
        ExpressionAttributeValues: {
          ":gsi2pk": matchStatusGsiPk(projectId, options.status),
        },
        ScanIndexForward: false,
      })
    );

    return (response.Items ?? [])
      .filter(isMatchRecord)
      .filter((item) => item.ownerSub === ownerSub)
      .map(mapToMatchEntity);
  }

  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": MATCH_PREFIX,
      },
      ScanIndexForward: false,
    })
  );

  return (response.Items ?? [])
    .filter(isMatchRecord)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToMatchEntity);
}

export interface UpsertMatchInput {
  matchId?: string;
  projectId: string;
  ittItemId: string;
  contractorId: string;
  responseItemId: string;
  status: MatchEntity["status"];
  confidence: number;
  comment?: string;
}

export async function upsertProjectMatch(
  ownerSub: string,
  input: UpsertMatchInput
): Promise<MatchEntity> {
  const matchId = input.matchId ?? uuidv4();
  const record = buildMatchRecord(ownerSub, {
    matchId,
    projectId: input.projectId,
    ittItemId: input.ittItemId,
    contractorId: input.contractorId,
    responseItemId: input.responseItemId,
    status: input.status,
    confidence: input.confidence,
    comment: input.comment,
  });

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );

  return mapToMatchEntity(record);
}

export interface UpdateMatchInput {
  status?: MatchEntity["status"];
  confidence?: number;
  comment?: string | null;
}

export async function updateProjectMatch(
  ownerSub: string,
  projectId: string,
  matchId: string,
  updates: UpdateMatchInput
): Promise<MatchEntity | null> {
  const existing = await getMatchRecord(ownerSub, projectId, matchId);
  if (!existing) {
    return null;
  }

  const updatedRecord = buildMatchRecord(ownerSub, {
    matchId: existing.matchId,
    projectId: existing.projectId,
    ittItemId: existing.ittItemId,
    contractorId: existing.contractorId,
    responseItemId: existing.responseItemId,
    status: updates.status ?? existing.status,
    confidence: updates.confidence ?? existing.confidence,
    comment: updates.comment === undefined ? existing.comment : updates.comment ?? undefined,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedRecord,
    })
  );

  return mapToMatchEntity(updatedRecord);
}

export async function deleteProjectMatch(
  ownerSub: string,
  projectId: string,
  matchId: string
): Promise<boolean> {
  const existing = await getMatchRecord(ownerSub, projectId, matchId);
  if (!existing) {
    return false;
  }

  await ddbDocClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: existing.PK,
        SK: existing.SK,
      },
    })
  );

  return true;
}
