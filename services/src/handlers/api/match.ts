import { z } from "zod";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";
import { getJsonBody, getOwnerSub, ApiEvent, getPathParam, getQueryParam } from "@/lib/api-utils";
import { getProjectItem } from "@/lib/repository/projects";
import { listProjectMatches as fetchProjectMatches, upsertProjectMatch, updateProjectMatch, getProjectMatch } from "@/lib/repository/matches";
import { listProjectIttItems, getProjectIttItem } from "@/lib/repository/itt-items";
import { listProjectResponseItems, getProjectResponseItem } from "@/lib/repository/response-items";
import { listProjectContractors } from "@/lib/repository/contractors";
import { getEnv } from "@/lib/env";
import { sendQueueMessage } from "@/lib/queues";
import type { MatchEntity, ITTItemEntity, ResponseItemEntity, ContractorEntity } from "@/types/domain";
import type { MatchResponse } from "@/types/api";

const STATUS_VALUES: MatchEntity["status"][] = ["suggested", "accepted", "rejected", "manual"];

const UPDATE_MATCH_STATUS_SCHEMA = z.object({
  matchId: z.string().min(1),
  status: z.enum(STATUS_VALUES),
  confidence: z.number().min(0).max(1).optional(),
  comment: z.string().trim().max(2000).optional().nullable(),
});

const CREATE_MANUAL_MATCH_SCHEMA = z.object({
  ittItemId: z.string().min(1),
  responseItemId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  comment: z.string().trim().max(2000).optional().nullable(),
});

export async function listMatches(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const statusParam = getQueryParam(event, "status")?.toLowerCase();
  const statusFilter = STATUS_VALUES.includes(statusParam as MatchEntity["status"]) ? (statusParam as MatchEntity["status"]) : statusParam === "all" ? "all" : undefined;

  const matches = await fetchProjectMatches(ownerSub, projectId, { status: statusFilter });
  const [ittItems, responseItems, contractors] = await Promise.all([
    listProjectIttItems(ownerSub, projectId),
    listProjectResponseItems(ownerSub, projectId),
    listProjectContractors(ownerSub, projectId),
  ]);

  const ittMap = new Map(ittItems.map((item) => [item.ittItemId, item]));
  const responseMap = new Map(responseItems.map((item) => [item.responseItemId, item]));
  const contractorMap = new Map(contractors.map((contractor) => [contractor.contractorId, contractor]));

  const payload = matches.map((match) => toMatchResponse(match, {
    ittMap,
    responseMap,
    contractorMap,
  }));

  return jsonResponse(200, payload);
}

export async function triggerAutoMatch(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const { MATCH_QUEUE_URL } = getEnv();
  await sendQueueMessage(MATCH_QUEUE_URL, {
    type: "AUTO_MATCH_REQUEST",
    projectId,
    ownerSub,
    requestedAt: new Date().toISOString(),
  });

  return jsonResponse(202, { enqueued: true });
}

export async function updateMatchStatus(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = UPDATE_MATCH_STATUS_SCHEMA.parse(getJsonBody(event));
  const match = await updateProjectMatch(ownerSub, projectId, payload.matchId, {
    status: payload.status,
    confidence: payload.confidence,
    comment: payload.comment,
  });

  if (!match) {
    return jsonResponse(404, { message: "Match not found" });
  }

  const [ittItem, responseItem, contractors] = await Promise.all([
    getProjectIttItem(ownerSub, projectId, match.ittItemId),
    getProjectResponseItem(ownerSub, projectId, match.responseItemId),
    listProjectContractors(ownerSub, projectId),
  ]);

  const contractorMap = new Map(contractors.map((contractor) => [contractor.contractorId, contractor]));

  return jsonResponse(200, toMatchResponse(match, {
    ittMap: new Map(ittItem ? [[ittItem.ittItemId, ittItem]] : []),
    responseMap: new Map(responseItem ? [[responseItem.responseItemId, responseItem]] : []),
    contractorMap,
  }));
}

export async function createManualMatch(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = CREATE_MANUAL_MATCH_SCHEMA.parse(getJsonBody(event));

  const [ittItem, responseItem] = await Promise.all([
    getProjectIttItem(ownerSub, projectId, payload.ittItemId),
    getProjectResponseItem(ownerSub, projectId, payload.responseItemId),
  ]);

  if (!ittItem || !responseItem) {
    return jsonResponse(400, { message: "ITT or response item not found" });
  }

  const contractors = await listProjectContractors(ownerSub, projectId);
  const contractorMap = new Map(contractors.map((contractor) => [contractor.contractorId, contractor]));

  const existing = await getProjectMatch(ownerSub, projectId, `${payload.responseItemId}:${payload.ittItemId}`);
  if (existing) {
    return jsonResponse(200, toMatchResponse(existing, {
      ittMap: new Map([[ittItem.ittItemId, ittItem]]),
      responseMap: new Map([[responseItem.responseItemId, responseItem]]),
      contractorMap,
    }));
  }

  const matches = await fetchProjectMatches(ownerSub, projectId, { status: "all" });
  const conflicting = matches.find((match) => match.responseItemId === payload.responseItemId && match.status !== "rejected");
  if (conflicting) {
    return jsonResponse(409, { message: "Response item already matched" });
  }

  const matchId = `${payload.responseItemId}:${payload.ittItemId}`;
  const newMatch = await upsertProjectMatch(ownerSub, {
    matchId,
    projectId,
    ittItemId: payload.ittItemId,
    contractorId: responseItem.contractorId,
    responseItemId: payload.responseItemId,
    status: "manual",
    confidence: payload.confidence ?? 1,
    comment: payload.comment ?? undefined,
  });

  return jsonResponse(201, toMatchResponse(newMatch, {
    ittMap: new Map([[ittItem.ittItemId, ittItem]]),
    responseMap: new Map([[responseItem.responseItemId, responseItem]]),
    contractorMap,
  }));
}


interface MatchResponseContext {
  ittMap: Map<string, ITTItemEntity>;
  responseMap: Map<string, ResponseItemEntity>;
  contractorMap: Map<string, ContractorEntity>;
}

function toMatchResponse(match: MatchEntity, context: MatchResponseContext): MatchResponse {
  const itt = context.ittMap.get(match.ittItemId);
  const response = context.responseMap.get(match.responseItemId);
  const contractor = context.contractorMap.get(match.contractorId);

  return {
    matchId: match.matchId,
    ittItemId: match.ittItemId,
    ittDescription: itt?.description ?? null,
    contractorId: match.contractorId,
    contractorName: contractor?.name,
    responseItemId: match.responseItemId,
    responseDescription: response?.description,
    responseItemCode: response?.itemCode,
    responseAmount: resolveAmount(response),
    status: match.status,
    confidence: match.confidence,
    comment: match.comment ?? null,
  };
}

function resolveAmount(response?: ResponseItemEntity): number | undefined {
  if (!response) {
    return undefined;
  }
  if (typeof response.amount === "number" && !Number.isNaN(response.amount)) {
    return response.amount;
  }
  if (typeof response.qty === "number" && typeof response.rate === "number") {
    const derived = response.qty * response.rate;
    return Number.isFinite(derived) ? derived : undefined;
  }
  return undefined;
}
