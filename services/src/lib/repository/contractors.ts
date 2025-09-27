import { v4 as uuidv4 } from "uuid";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import { ContractorEntity } from "@/types/domain";
import { contractorSk, projectPk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();
const CONTRACTOR_PREFIX = "CONTRACTOR#";

export async function getContractor(
  ownerSub: string,
  projectId: string,
  contractorId: string
): Promise<ContractorEntity | null> {
  const response = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: contractorSk(contractorId),
      },
    })
  );

  if (!response.Item || !isContractorItem(response.Item)) {
    return null;
  }

  if (response.Item.ownerSub !== ownerSub) {
    return null;
  }

  return mapToContractorEntity(response.Item);
}

interface ContractorItem extends ContractorEntity {
  PK: string;
  SK: string;
  entityType: "Contractor";
  ownerSub: string;
}

function mapToContractorEntity(item: ContractorItem): ContractorEntity {
  return {
    contractorId: item.contractorId,
    projectId: item.projectId,
    name: item.name,
    contact: item.contact,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isContractorItem(record: any): record is ContractorItem {
  return record?.entityType === "Contractor";
}

export async function listProjectContractors(ownerSub: string, projectId: string): Promise<ContractorEntity[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#sk": "SK" },
      ExpressionAttributeValues: {
        ":pk": projectPk(projectId),
        ":prefix": CONTRACTOR_PREFIX,
      },
      ScanIndexForward: true,
    })
  );

  return (response.Items ?? [])
    .filter(isContractorItem)
    .filter((item) => item.ownerSub === ownerSub)
    .map(mapToContractorEntity);
}

export interface EnsureContractorInput {
  contractorId?: string;
  name: string;
}

export async function ensureContractor(
  ownerSub: string,
  projectId: string,
  input: EnsureContractorInput
): Promise<ContractorEntity> {
  if (input.contractorId) {
    const existing = await getContractor(ownerSub, projectId, input.contractorId);
    if (existing) {
      return existing;
    }
  }

  const contractorId = input.contractorId ?? uuidv4();
  const now = new Date().toISOString();

  const item: ContractorItem = {
    PK: projectPk(projectId),
    SK: contractorSk(contractorId),
    entityType: "Contractor",
    ownerSub,
    contractorId,
    projectId,
    name: input.name,
    createdAt: now,
    updatedAt: now,
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return mapToContractorEntity(item);
}
