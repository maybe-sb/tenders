import { z } from "zod";

// Zod schema for a single response item from OpenAI
export const OpenAIResponseItemSchema = z.object({
  itemCode: z.string().optional().describe("Item code or reference number (e.g., '1.1.1', 'A-01')"),
  description: z.string().describe("Description of the work or item"),
  unit: z.string().optional().describe("Unit of measurement (e.g., 'm2', 'each', 'hours')"),
  qty: z.number().optional().describe("Quantity as a number"),
  rate: z.number().optional().describe("Rate or unit price, rounded to 2 decimal places"),
  amount: z.number().optional().describe("Total amount (qty * rate), rounded to 2 decimal places"),
  sectionGuess: z.string().optional().describe("Best guess at which section this item belongs to"),
  notes: z.string().optional().describe("Any special notes or conditions"),
});

// Schema for the complete OpenAI response
export const OpenAIExcelResponseSchema = z.object({
  documentType: z.enum(["itt", "response"]).describe("Type of document detected"),
  contractorName: z.string().nullish().describe("Name of contractor if this is a response document"),
  items: z.array(OpenAIResponseItemSchema).describe("List of extracted line items"),
  sections: z.array(z.object({
    code: z.string().describe("Section code (e.g., '1', '2')"),
    name: z.string().describe("Section name (e.g., 'Preliminaries', 'Earthworks')"),
  })).optional().describe("List of sections found in the document"),
  metadata: z
    .object({
      totalRows: z
        .number()
        .describe("Total number of rows processed")
        .optional(),
      totalWorksheets: z
        .number()
        .describe("Total number of worksheets analyzed")
        .optional(),
      extractedItems: z
        .number()
        .describe("Number of items successfully extracted"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Confidence score of extraction quality"),
      warnings: z
        .array(z.string())
        .optional()
        .describe("Any warnings or issues encountered"),
    })
    .refine(
      (metadata) =>
        metadata.totalRows !== undefined || metadata.totalWorksheets !== undefined,
      { message: "Either totalRows or totalWorksheets must be provided" }
    ),
});

// TypeScript types derived from Zod schemas
export type OpenAIResponseItem = z.infer<typeof OpenAIResponseItemSchema>;
export type OpenAIExcelResponse = z.infer<typeof OpenAIExcelResponseSchema>;

// Mapping function types
export interface ResponseItemMapping {
  sectionGuess?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  qty?: number;
  rate?: number;
  amount?: number;
}

export interface IttItemMapping {
  sectionCode: string;
  sectionName: string;
  subSectionCode: string;
  subSectionName: string;
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
}

// Prompt template types
export interface ExcelContext {
  worksheetName: string;
  totalRows: number;
  headers: string[];
  sampleRows: string[][];
  documentType?: "itt" | "response";
  contractorName?: string;
}

// Error types for OpenAI operations
export class OpenAIExtractionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: any
  ) {
    super(message);
    this.name = "OpenAIExtractionError";
  }
}

// Token usage tracking
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

// Service tier configuration
export const SERVICE_TIER = "priority" as const;
export const DEFAULT_MODEL = "gpt-4.1" as const;
export const MAX_RETRIES = 1;
export const RETRY_DELAY_MS = 1000;
