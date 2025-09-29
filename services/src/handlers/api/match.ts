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

const BULK_ACCEPT_SCHEMA = z.object({
  matchIds: z.array(z.string().min(1)).min(1).max(500), // Limit to 500 matches per request
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
  const statusFilter = STATUS_VALUES.includes(statusParam as MatchEntity["status"]) ? (statusParam as MatchEntity["status"]) :
    statusParam === "all" ? "all" :
    statusParam === "reviewable" ? "reviewable" : undefined;

  const contractorParam = getQueryParam(event, "contractor");
  const contractorFilter = contractorParam && contractorParam !== "all" ? contractorParam : undefined;

  let matches = await fetchProjectMatches(ownerSub, projectId, { status: statusFilter === "reviewable" ? "all" : statusFilter });

  // Filter out accepted and manual matches for "reviewable" status
  if (statusFilter === "reviewable") {
    matches = matches.filter(match => match.status !== "accepted" && match.status !== "manual");
  }

  const [ittItems, responseItems, contractors] = await Promise.all([
    listProjectIttItems(ownerSub, projectId),
    listProjectResponseItems(ownerSub, projectId),
    listProjectContractors(ownerSub, projectId),
  ]);

  const ittMap = new Map(ittItems.map((item) => [item.ittItemId, item]));
  const responseMap = new Map(responseItems.map((item) => [item.responseItemId, item]));
  const contractorMap = new Map(contractors.map((contractor) => [contractor.contractorId, contractor]));

  // Apply contractor filtering if specified
  const filteredMatches = contractorFilter
    ? matches.filter(match => match.contractorId === contractorFilter)
    : matches;

  const resolvedResponseItems = new Set(
    filteredMatches
      .filter(match => match.status === "accepted" || match.status === "manual")
      .map(match => match.responseItemId)
  );

  const visibleMatches = filteredMatches.filter(match => {
    if (match.status !== "suggested") {
      return true;
    }
    return !resolvedResponseItems.has(match.responseItemId);
  });

  const payload = visibleMatches.map((match) => toMatchResponse(match, {
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

  const body = getJsonBody<{ contractorId?: string }>(event);
  const contractorId = typeof body.contractorId === "string" && body.contractorId.trim().length > 0
    ? body.contractorId.trim()
    : undefined;

  if (contractorId) {
    const contractors = await listProjectContractors(ownerSub, projectId);
    const hasContractor = contractors.some((contractor) => contractor.contractorId === contractorId);
    if (!hasContractor) {
      return jsonResponse(400, { message: "Contractor not found" });
    }
  }

  const { MATCH_QUEUE_URL } = getEnv();
  if (!MATCH_QUEUE_URL) {
    throw new Error("MATCH_QUEUE_URL environment variable is required for auto-matching");
  }

  await sendQueueMessage(MATCH_QUEUE_URL, {
    type: "AUTO_MATCH_REQUEST",
    projectId,
    ownerSub,
    contractorId,
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

  // Get the existing match to check for conflicts when accepting
  const existingMatch = await getProjectMatch(ownerSub, projectId, payload.matchId);
  if (!existingMatch) {
    return jsonResponse(404, { message: "Match not found" });
  }

  // Validate conflict resolution when accepting a match
  if (payload.status === "accepted") {
    const allMatches = await fetchProjectMatches(ownerSub, projectId, { status: "all" });

    // Check if this response item is already matched to a different ITT item
    // Rule: One response item cannot match multiple ITT items (contractor can't fulfill multiple requirements with same item)
    const conflicting = allMatches.find((match) =>
      match.responseItemId === existingMatch.responseItemId &&
      match.ittItemId !== existingMatch.ittItemId &&
      match.status === "accepted" &&
      match.matchId !== payload.matchId
    );

    if (conflicting) {
      return jsonResponse(409, {
        message: "Response item is already matched to a different ITT item",
        details: {
          conflictingMatchId: conflicting.matchId,
          conflictingIttItemId: conflicting.ittItemId
        }
      });
    }
  }

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
  // Check if this response item is already matched to a different ITT item
  // Rule: One response item cannot match multiple ITT items
  const conflicting = matches.find((match) =>
    match.responseItemId === payload.responseItemId &&
    match.ittItemId !== payload.ittItemId &&
    match.status === "accepted"
  );
  if (conflicting) {
    return jsonResponse(409, {
      message: "Response item is already matched to a different ITT item",
      details: {
        conflictingMatchId: conflicting.matchId,
        conflictingIttItemId: conflicting.ittItemId,
        responseItemId: payload.responseItemId
      }
    });
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

export async function bulkAcceptMatches(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = BULK_ACCEPT_SCHEMA.parse(getJsonBody(event));

  // Get all existing matches to validate conflicts before bulk accepting
  const allMatches = await fetchProjectMatches(ownerSub, projectId, { status: "all" });
  const matchesToAccept = allMatches.filter(match => payload.matchIds.includes(match.matchId));

  // Validate for conflicts before accepting any matches
  const conflicts: Array<{ matchId: string; error: string; conflictDetails: any }> = [];

  for (const match of matchesToAccept) {
    // Check if this response item is already matched to a different ITT item
    // Rule: One response item cannot match multiple ITT items
    const conflicting = allMatches.find((existingMatch) =>
      existingMatch.responseItemId === match.responseItemId &&
      existingMatch.ittItemId !== match.ittItemId &&
      existingMatch.status === "accepted" &&
      existingMatch.matchId !== match.matchId
    );

    if (conflicting) {
      conflicts.push({
        matchId: match.matchId,
        error: "Response item is already matched to a different ITT item",
        conflictDetails: {
          conflictingMatchId: conflicting.matchId,
          conflictingIttItemId: conflicting.ittItemId,
          responseItemId: match.responseItemId
        }
      });
    }
  }

  // If there are conflicts, return them without processing any matches
  if (conflicts.length > 0) {
    return jsonResponse(409, {
      message: "Bulk accept failed due to conflicts",
      conflicts,
      conflictCount: conflicts.length,
      totalRequested: payload.matchIds.length
    });
  }

  // Process matches in parallel (only if no conflicts)
  const results = await Promise.allSettled(
    payload.matchIds.map(async (matchId) => {
      const updated = await updateProjectMatch(ownerSub, projectId, matchId, {
        status: "accepted",
        comment: payload.comment,
      });
      if (!updated) {
        throw new Error(`Match ${matchId} not found`);
      }
      return { matchId, success: true };
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  const failedDetails = results
    .map((r, index) => ({ result: r, matchId: payload.matchIds[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, matchId }) => ({
      matchId,
      error: result.status === "rejected" ? result.reason?.message || "Unknown error" : "Unknown error",
    }));

  return jsonResponse(200, {
    succeeded,
    failed,
    total: payload.matchIds.length,
    failures: failedDetails,
  });
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
    responseQty: response?.qty,
    responseRate: response?.rate,
    responseUnit: response?.unit,
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
    return Math.round(response.amount * 100) / 100;
  }
  if (typeof response.qty === "number" && typeof response.rate === "number") {
    const derived = response.qty * response.rate;
    return Number.isFinite(derived) ? Math.round(derived * 100) / 100 : undefined;
  }
  return undefined;
}
