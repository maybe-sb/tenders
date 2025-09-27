import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { SectionEntity } from "@/types/domain";
import { projectPk, sectionSk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const SECTION_PREFIX = "SECTION#";

type SectionItem = SectionEntity & {
  PK: string;
  SK: string;
  entityType: "Section";
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
};

function isSectionItem(record: any): record is SectionItem {
  return record?.entityType === "Section";
}

function mapToSectionEntity(item: SectionItem): SectionEntity {
  return {
    sectionId: item.sectionId,
    projectId: item.projectId,
    code: item.code,
    name: item.name,
    order: item.order,
  };
}

export async function listProjectSections(ownerSub: string, projectId: string): Promise<SectionEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": SECTION_PREFIX,
      },
      ScanIndexForward: true,
    })
  );

  return (response.Items ?? [])
    .filter(isSectionItem)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToSectionEntity)
    .sort((a, b) => a.order - b.order);
}

export interface UpsertSectionInput {
  sectionId?: string;
  code: string;
  name: string;
  order: number;
}

export async function upsertProjectSection(
  ownerSub: string,
  projectId: string,
  input: UpsertSectionInput
): Promise<SectionEntity> {
  const sectionId = input.sectionId ?? uuidv4();
  const now = new Date().toISOString();

  const item: SectionItem = {
    PK: projectPk(projectId),
    SK: sectionSk(sectionId),
    entityType: "Section",
    ownerSub,
    createdAt: now,
    updatedAt: now,
    sectionId,
    projectId,
    code: input.code,
    name: input.name,
    order: input.order,
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return mapToSectionEntity(item);
}
