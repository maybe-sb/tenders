/**
 * Matching engine for tender items
 * Implements exact and fuzzy matching as per instructions.txt
 */

import { logger } from "@/lib/logger";
import {
  normalizeText,
  normalizeItemCode,
  calculateJaccardSimilarity,
  calculateLevenshteinSimilarity,
  areUnitsEquivalent,
  type NormalizedText
} from "./normalizer";
import type { ITTItemEntity, ResponseItemEntity } from "@/types/domain";

export interface MatchCandidate {
  ittItemId: string;
  responseItemId: string;
  contractorId: string;
  confidence: number;
  matchType: "exact_code" | "exact_description" | "fuzzy_description" | "fuzzy_code";
  reason: string;
}

export interface MatchingOptions {
  fuzzyThreshold: number; // Minimum confidence to suggest (default 0.75)
  lowConfidenceThreshold: number; // Mark as low confidence below this (default 0.6)
  enableFuzzyMatching: boolean; // Enable fuzzy matching stage (default true)
  maxSuggestions: number; // Maximum suggestions per response item (default 3)
}

const DEFAULT_OPTIONS: MatchingOptions = {
  fuzzyThreshold: 0.75,
  lowConfidenceThreshold: 0.6,
  enableFuzzyMatching: true,
  maxSuggestions: 3,
};

/**
 * Main matching engine that finds potential matches between ITT items and response items
 */
export class MatchingEngine {
  private options: MatchingOptions;

  constructor(options: Partial<MatchingOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Find all potential matches for response items against ITT items
   */
  public findMatches(
    ittItems: ITTItemEntity[],
    responseItems: ResponseItemEntity[]
  ): MatchCandidate[] {
    logger.info("Starting matching process", {
      ittItemsCount: ittItems.length,
      responseItemsCount: responseItems.length,
      options: this.options
    });

    const matches: MatchCandidate[] = [];

    // Preprocess ITT items for faster matching
    const normalizedIttItems = this.preprocessIttItems(ittItems);

    for (const responseItem of responseItems) {
      const responseMatches = this.findMatchesForResponseItem(
        responseItem,
        normalizedIttItems
      );

      // Sort by confidence and take top matches
      responseMatches
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.options.maxSuggestions)
        .forEach(match => {
          if (match.confidence >= this.options.lowConfidenceThreshold) {
            matches.push(match);
          }
        });
    }

    logger.info("Matching process completed", {
      totalMatches: matches.length,
      highConfidenceMatches: matches.filter(m => m.confidence >= this.options.fuzzyThreshold).length,
      lowConfidenceMatches: matches.filter(m =>
        m.confidence >= this.options.lowConfidenceThreshold &&
        m.confidence < this.options.fuzzyThreshold
      ).length
    });

    return matches;
  }

  /**
   * Find potential matches for a single response item
   */
  private findMatchesForResponseItem(
    responseItem: ResponseItemEntity,
    normalizedIttItems: NormalizedITTItem[]
  ): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    const normalizedResponse = this.normalizeResponseItem(responseItem);

    for (const ittItem of normalizedIttItems) {
      const match = this.calculateMatch(responseItem, normalizedResponse, ittItem);
      if (match && match.confidence >= this.options.lowConfidenceThreshold) {
        matches.push(match);
      }
    }

    return matches;
  }

  /**
   * Calculate match between a response item and an ITT item
   */
  private calculateMatch(
    responseItem: ResponseItemEntity,
    normalizedResponse: NormalizedResponseItem,
    ittItem: NormalizedITTItem
  ): MatchCandidate | null {
    // Stage 1: Exact/Semantic Matching

    // 1.1 Exact code match (highest confidence)
    if (normalizedResponse.itemCode && ittItem.itemCode) {
      if (normalizedResponse.itemCode === ittItem.itemCode) {
        const confidence = this.calculateCodeMatchConfidence(
          normalizedResponse,
          ittItem
        );
        return {
          ittItemId: ittItem.original.ittItemId,
          responseItemId: responseItem.responseItemId,
          contractorId: responseItem.contractorId,
          confidence,
          matchType: "exact_code",
          reason: `Exact code match: ${normalizedResponse.itemCode}`
        };
      }
    }

    // 1.2 Exact description match
    if (normalizedResponse.description.key === ittItem.description.key) {
      const confidence = this.calculateDescriptionMatchConfidence(
        normalizedResponse,
        ittItem,
        1.0 // Perfect token match
      );
      return {
        ittItemId: ittItem.original.ittItemId,
        responseItemId: responseItem.responseItemId,
        contractorId: responseItem.contractorId,
        confidence,
        matchType: "exact_description",
        reason: "Exact description match after normalization"
      };
    }

    // Stage 2: Fuzzy Matching (if enabled)
    if (!this.options.enableFuzzyMatching) {
      return null;
    }

    // 2.1 Fuzzy description matching using Jaccard similarity
    const jaccardSimilarity = calculateJaccardSimilarity(
      normalizedResponse.description.tokens,
      ittItem.description.tokens
    );

    if (jaccardSimilarity >= 0.4) { // Minimum threshold for consideration
      const confidence = this.calculateDescriptionMatchConfidence(
        normalizedResponse,
        ittItem,
        jaccardSimilarity
      );

      if (confidence >= this.options.lowConfidenceThreshold) {
        return {
          ittItemId: ittItem.original.ittItemId,
          responseItemId: responseItem.responseItemId,
          contractorId: responseItem.contractorId,
          confidence,
          matchType: "fuzzy_description",
          reason: `Fuzzy description match (${Math.round(jaccardSimilarity * 100)}% similarity)`
        };
      }
    }

    // 2.2 Fuzzy code matching using Levenshtein (for short codes)
    if (normalizedResponse.itemCode && ittItem.itemCode) {
      const codeLength = Math.max(normalizedResponse.itemCode.length, ittItem.itemCode.length);
      if (codeLength <= 10) { // Only for short codes
        const similarity = calculateLevenshteinSimilarity(
          normalizedResponse.itemCode,
          ittItem.itemCode
        );

        if (similarity >= 0.7) {
          const confidence = this.calculateCodeMatchConfidence(
            normalizedResponse,
            ittItem,
            similarity
          );

          if (confidence >= this.options.lowConfidenceThreshold) {
            return {
              ittItemId: ittItem.original.ittItemId,
              responseItemId: responseItem.responseItemId,
              contractorId: responseItem.contractorId,
              confidence,
              matchType: "fuzzy_code",
              reason: `Fuzzy code match (${Math.round(similarity * 100)}% similarity)`
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate confidence for code matches
   */
  private calculateCodeMatchConfidence(
    response: NormalizedResponseItem,
    itt: NormalizedITTItem,
    baseConfidence: number = 1.0
  ): number {
    let confidence = baseConfidence;

    // Perfect code + description match = 1.0
    if (baseConfidence === 1.0 && response.description.key === itt.description.key) {
      confidence = 1.0;
    }
    // Perfect code match only = 0.9
    else if (baseConfidence === 1.0) {
      confidence = 0.9;
    }
    // Fuzzy code matches get scaled down
    else {
      confidence = baseConfidence * 0.8;
    }

    // Boost for unit match
    if (response.unit && itt.unit && areUnitsEquivalent(response.unit, itt.unit)) {
      confidence = Math.min(1.0, confidence + 0.05);
    }

    // Boost for section match (if available)
    if (response.sectionGuess && itt.sectionId) {
      const sectionMatch = this.isSectionMatch(response.sectionGuess, itt.sectionId);
      if (sectionMatch) {
        confidence = Math.min(1.0, confidence + 0.03);
      }
    }

    return Math.round(confidence * 1000) / 1000; // Round to 3 decimal places
  }

  /**
   * Calculate confidence for description matches
   */
  private calculateDescriptionMatchConfidence(
    response: NormalizedResponseItem,
    itt: NormalizedITTItem,
    similarity: number
  ): number {
    let confidence: number;

    // Base confidence from similarity
    if (similarity === 1.0) {
      confidence = 0.8; // Exact description match = 0.8 per instructions
    } else if (similarity >= 0.8) {
      confidence = 0.7; // High similarity
    } else if (similarity >= 0.6) {
      confidence = 0.6; // Medium similarity
    } else {
      confidence = similarity * 0.8; // Scale down lower similarities
    }

    // Boost for unit match
    if (response.unit && itt.unit && areUnitsEquivalent(response.unit, itt.unit)) {
      confidence = Math.min(1.0, confidence + 0.05);
    }

    // Boost for section match
    if (response.sectionGuess && itt.sectionId) {
      const sectionMatch = this.isSectionMatch(response.sectionGuess, itt.sectionId);
      if (sectionMatch) {
        confidence = Math.min(1.0, confidence + 0.03);
      }
    }

    // Boost for quantity similarity (if both have quantities)
    if (response.qty && itt.qty) {
      const qtyRatio = Math.min(response.qty, itt.qty) / Math.max(response.qty, itt.qty);
      if (qtyRatio >= 0.9) {
        confidence = Math.min(1.0, confidence + 0.02);
      }
    }

    return Math.round(confidence * 1000) / 1000; // Round to 3 decimal places
  }

  /**
   * Check if section guess matches ITT section
   */
  private isSectionMatch(sectionGuess: string, sectionId: string): boolean {
    // This is a simple implementation - could be enhanced with section name matching
    const normalizedGuess = normalizeText(sectionGuess, false);
    const normalizedSection = normalizeText(sectionId, false);

    return normalizedGuess.key === normalizedSection.key;
  }

  /**
   * Preprocess ITT items for efficient matching
   */
  private preprocessIttItems(ittItems: ITTItemEntity[]): NormalizedITTItem[] {
    return ittItems.map(item => ({
      original: item,
      itemCode: item.itemCode ? normalizeItemCode(item.itemCode) : '',
      description: normalizeText(item.description),
      unit: item.unit?.toLowerCase().trim() || '',
      sectionId: item.sectionId,
      qty: item.qty,
    }));
  }

  /**
   * Normalize response item for matching
   */
  private normalizeResponseItem(item: ResponseItemEntity): NormalizedResponseItem {
    return {
      original: item,
      itemCode: item.itemCode ? normalizeItemCode(item.itemCode) : '',
      description: normalizeText(item.description),
      unit: item.unit?.toLowerCase().trim() || '',
      sectionGuess: item.sectionGuess?.toLowerCase().trim() || '',
      qty: item.qty,
    };
  }
}

// Helper interfaces for normalized items
interface NormalizedITTItem {
  original: ITTItemEntity;
  itemCode: string;
  description: NormalizedText;
  unit: string;
  sectionId: string;
  qty?: number;
}

interface NormalizedResponseItem {
  original: ResponseItemEntity;
  itemCode: string;
  description: NormalizedText;
  unit: string;
  sectionGuess: string;
  qty?: number;
}

/**
 * Factory function to create a matching engine with default options
 */
export function createMatchingEngine(options?: Partial<MatchingOptions>): MatchingEngine {
  return new MatchingEngine(options);
}