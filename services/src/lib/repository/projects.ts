import { v4 as uuidv4 } from "uuid";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddbDocClient } from "@/lib/dynamo";
import { getEnv } from "@/lib/env";
import {
  ProjectDetail,
  ProjectEntity,
  ProjectStats,
  TenderProject,
} from "@/types/domain";
import { projectPk, PROJECT_META_SK, ownerGsiPk, ownerGsiSk } from "@/lib/repository/keys";

const { TABLE_NAME } = getEnv();

interface ProjectItem extends ProjectEntity {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "Project";
  stats: ProjectStats;
  deleted?: boolean;
}

const GSI1_NAME = "GSI1";

const defaultStats: ProjectStats = {
  contractors: 0,
  sections: 0,
  ittItems: 0,
  matchedItems: 0,
  unmatchedItems: 0,
};

function mapToTenderProject(item: ProjectItem): TenderProject {
  return {
    projectId: item.projectId,
    name: item.name,
    status: item.status,
    currency: item.currency,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stats: item.stats ?? defaultStats,
  };
}

export async function createProjectItem(ownerSub: string, input: { name: string; currency?: string }): Promise<TenderProject> {
  const now = new Date().toISOString();
  const projectId = uuidv4();

  const item: ProjectItem = {
    PK: projectPk(projectId),
    SK: PROJECT_META_SK,
    GSI1PK: ownerGsiPk(ownerSub),
    GSI1SK: ownerGsiSk(now, projectId),
    entityType: "Project",
    projectId,
    name: input.name,
    currency: (input.currency ?? "AUD").toUpperCase(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    ownerSub,
    stats: { ...defaultStats },
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  return mapToTenderProject(item);
}

export async function listProjectsForOwner(ownerSub: string): Promise<TenderProject[]> {
  const response = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "#gsi1pk = :owner",
      ExpressionAttributeNames: {
        "#gsi1pk": "GSI1PK",
      },
      ExpressionAttributeValues: {
        ":owner": ownerGsiPk(ownerSub),
      },
      ScanIndexForward: false,
    })
  );

  const items = (response.Items ?? []) as ProjectItem[];
  return items.filter((item) => !item.deleted).map(mapToTenderProject);
}

export async function getProjectItem(ownerSub: string, projectId: string): Promise<ProjectItem | null> {
  const response = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: PROJECT_META_SK,
      },
    })
  );

  if (!response.Item) {
    return null;
  }

  const item = response.Item as ProjectItem;
  if (item.ownerSub !== ownerSub || item.deleted) {
    return null;
  }

  return item;
}

export async function updateProjectItem(
  ownerSub: string,
  projectId: string,
  updates: Partial<Pick<ProjectEntity, "name" | "status">>
): Promise<TenderProject> {
  if (Object.keys(updates).length === 0) {
    const current = await getProjectItem(ownerSub, projectId);
    if (!current) {
      throw new Error("PROJECT_NOT_FOUND");
    }
    return mapToTenderProject(current);
  }

  const allowedFields: Array<keyof ProjectEntity> = ["name", "status"];
  const expressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };

  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      const placeholder = `#${field}`;
      const valuePlaceholder = `:${field}`;
      expressionAttributeNames[placeholder] = field;
      expressionAttributeValues[valuePlaceholder] = updates[field];
      expressions.push(`${placeholder} = ${valuePlaceholder}`);
    }
  });

  expressions.push("#updatedAt = :updatedAt");
  expressionAttributeNames["#updatedAt"] = "updatedAt";

  const updatedAt = expressionAttributeValues[":updatedAt"] as string;

  const result = await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: PROJECT_META_SK,
      },
      UpdateExpression: `SET ${expressions.join(", ")}, GSI1SK = :gsi1sk` ,
      ConditionExpression: "ownerSub = :owner AND attribute_not_exists(deleted)",
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ":owner": ownerSub,
        ":gsi1sk": ownerGsiSk(updatedAt, projectId),
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return mapToTenderProject(result.Attributes as ProjectItem);
}

export async function softDeleteProject(ownerSub: string, projectId: string): Promise<void> {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: projectPk(projectId),
        SK: PROJECT_META_SK,
      },
      UpdateExpression:
        "SET #status = :deleted, #updatedAt = :updatedAt, deleted = :deletedFlag REMOVE GSI1PK, GSI1SK", 
      ConditionExpression: "ownerSub = :owner AND attribute_not_exists(deleted)",
      ExpressionAttributeNames: {
        "#status": "status",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":deleted": "deleted",
        ":deletedFlag": true,
        ":updatedAt": new Date().toISOString(),
        ":owner": ownerSub,
      },
    })
  );
}

export function mapToProjectDetail(
  item: ProjectItem,
  extras: Partial<Pick<ProjectDetail, "documents" | "sections" | "contractors" | "pendingJobs">> = {}
): ProjectDetail {
  const base = mapToTenderProject(item);
  return {
    ...base,
    documents: extras.documents ?? [],
    sections: extras.sections ?? [],
    contractors: extras.contractors ?? [],
    pendingJobs: extras.pendingJobs ?? [],
  };
}
