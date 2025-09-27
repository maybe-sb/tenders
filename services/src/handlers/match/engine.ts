import type { SQSEvent } from "aws-lambda";

import { logger } from "@/lib/logger";
import { createMatchingEngine, type MatchCandidate } from "@/lib/matching/engine";
import { listProjectIttItems } from "@/lib/repository/itt-items";
import { listProjectResponseItems } from "@/lib/repository/response-items";
import { listProjectMatches, upsertProjectMatch } from "@/lib/repository/matches";
import { v4 as uuidv4 } from "uuid";

interface AutoMatchRequest {
  type: "AUTO_MATCH_REQUEST";
  projectId: string;
  ownerSub: string;
  requestedAt: string;
}

export async function handler(event: SQSEvent) {
  logger.info("Match engine invoked", { records: event.Records.length });

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as AutoMatchRequest;

      if (message.type !== "AUTO_MATCH_REQUEST") {
        logger.warn("Unknown message type", { messageType: message.type });
        continue;
      }

      await processAutoMatchRequest(message);
    } catch (error) {
      logger.error("Failed to process match request", {
        recordId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw to trigger SQS retry mechanism
      throw error;
    }
  }
}

async function processAutoMatchRequest(request: AutoMatchRequest) {
  const { projectId, ownerSub } = request;

  logger.info("Processing auto-match request", { projectId, ownerSub });

  try {
    // Load project data
    const [ittItems, responseItems, existingMatches] = await Promise.all([
      listProjectIttItems(ownerSub, projectId),
      listProjectResponseItems(ownerSub, projectId),
      listProjectMatches(ownerSub, projectId),
    ]);

    logger.info("Loaded project data", {
      projectId,
      ittItemsCount: ittItems.length,
      responseItemsCount: responseItems.length,
      existingMatchesCount: existingMatches.length,
    });

    if (ittItems.length === 0) {
      logger.warn("No ITT items found for matching", { projectId });
      return;
    }

    if (responseItems.length === 0) {
      logger.warn("No response items found for matching", { projectId });
      return;
    }

    // Filter out response items that are already matched
    const matchedResponseItemIds = new Set(
      existingMatches
        .filter(match => match.status === "accepted" || match.status === "manual")
        .map(match => match.responseItemId)
    );

    const unmatchedResponseItems = responseItems.filter(
      item => !matchedResponseItemIds.has(item.responseItemId)
    );

    logger.info("Filtered unmatched response items", {
      totalResponseItems: responseItems.length,
      alreadyMatched: matchedResponseItemIds.size,
      unmatchedCount: unmatchedResponseItems.length,
    });

    if (unmatchedResponseItems.length === 0) {
      logger.info("All response items are already matched", { projectId });
      return;
    }

    // Create matching engine and find matches
    const matchingEngine = createMatchingEngine({
      fuzzyThreshold: 0.75,
      lowConfidenceThreshold: 0.3, // TEMPORARILY LOWERED from 0.6 for debugging
      enableFuzzyMatching: true,
      maxSuggestions: 3,
    });

    logger.info("Starting matching process", {
      ittItemsCount: ittItems.length,
      unmatchedResponseItemsCount: unmatchedResponseItems.length,
      sampleIttItem: ittItems[0] ? {
        itemCode: ittItems[0].itemCode,
        description: ittItems[0].description
      } : null,
      sampleResponseItem: unmatchedResponseItems[0] ? {
        itemCode: unmatchedResponseItems[0].itemCode,
        description: unmatchedResponseItems[0].description
      } : null
    });

    const matchCandidates = matchingEngine.findMatches(ittItems, unmatchedResponseItems);

    logger.info("Matching completed", {
      candidatesFound: matchCandidates.length,
      candidates: matchCandidates.map(c => ({
        ittItemId: c.ittItemId,
        responseItemId: c.responseItemId,
        confidence: c.confidence,
        matchType: c.matchType,
        reason: c.reason
      }))
    });

    logger.info("Generated match candidates", {
      projectId,
      candidatesCount: matchCandidates.length,
      highConfidenceCount: matchCandidates.filter(c => c.confidence >= 0.75).length,
      mediumConfidenceCount: matchCandidates.filter(c => c.confidence >= 0.6 && c.confidence < 0.75).length,
    });

    // Filter out candidates that would conflict with existing matches
    const existingMatchKeys = new Set(
      existingMatches.map(match => `${match.responseItemId}:${match.ittItemId}`)
    );

    const newCandidates = matchCandidates.filter(
      candidate => !existingMatchKeys.has(`${candidate.responseItemId}:${candidate.ittItemId}`)
    );

    logger.info("Filtered duplicate candidates", {
      originalCount: matchCandidates.length,
      duplicatesRemoved: matchCandidates.length - newCandidates.length,
      newCandidatesCount: newCandidates.length,
    });

    // Create match entities in the database
    let createdMatches = 0;
    for (const candidate of newCandidates) {
      try {
        await upsertProjectMatch(ownerSub, {
          matchId: `${candidate.responseItemId}:${candidate.ittItemId}`,
          projectId,
          ittItemId: candidate.ittItemId,
          contractorId: candidate.contractorId,
          responseItemId: candidate.responseItemId,
          status: "suggested",
          confidence: candidate.confidence,
          comment: candidate.reason,
        });
        createdMatches++;
      } catch (error) {
        logger.error("Failed to create match", {
          projectId,
          candidate,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Auto-match process completed", {
      projectId,
      candidatesProcessed: newCandidates.length,
      matchesCreated: createdMatches,
      duration: Date.now() - new Date(request.requestedAt).getTime(),
    });

  } catch (error) {
    logger.error("Auto-match process failed", {
      projectId,
      ownerSub,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
