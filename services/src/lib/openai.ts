import OpenAI from "openai";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse/lib/pdf-parse";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";
import {
  OpenAIExcelResponse,
  OpenAIExcelResponseSchema,
  OpenAIExtractionError,
  TokenUsage,
  SERVICE_TIER,
  DEFAULT_MODEL,
  MAX_RETRIES,
  RETRY_DELAY_MS,
} from "@/types/openai";

// Initialize OpenAI client
let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new OpenAIExtractionError(
        "OpenAI API key not configured",
        "MISSING_API_KEY"
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ITT-specific strict JSON Schema based on successful extraction
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    doc_type: { type: "string", enum: ["itt", "response", "tender"] },
    primary_worksheet: { type: "string" },
    contractor_name: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item_code: { type: ["string", "null"] },
          description: { type: "string" },
          unit: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          rate: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          amount_label: { type: ["string", "null"] },
          section: { type: ["string", "null"] }
        },
        required: ["item_code", "description", "unit", "quantity", "rate", "amount", "amount_label", "section"]
      }
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          name: { type: "string" }
        },
        required: ["code", "name"]
      }
    },
    metadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        total_items: { type: "integer" },
        total_worksheets: { type: "integer" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        warnings: { type: "array", items: { type: "string" } }
      },
      required: ["total_items", "total_worksheets", "confidence", "warnings"]
    }
  },
  required: ["doc_type", "primary_worksheet", "contractor_name", "items", "sections", "metadata"]
};

// Helpers for XLSX → compact JSON text across ALL sheets
function normalizeHeader(key: any): string {
  return String(key)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "")
    .toLowerCase();
}

function sheetToJsonLimited(ws: any, options: { maxRowsPerSheet?: number } = {}): any[] {
  const { maxRowsPerSheet = 1000 } = options;
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  const sliced = rows.slice(0, maxRowsPerSheet);
  return sliced.map((row: any) => {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) {
      out[normalizeHeader(k)] = v;
    }
    return out;
  });
}

function workbookToMultiSheetJson(wb: any, options: { maxRowsPerSheet?: number } = {}): any {
  const { maxRowsPerSheet = 1000 } = options;
  const data: any = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    data[name] = sheetToJsonLimited(ws, { maxRowsPerSheet });
  }
  return data;
}

// Build Responses API requests based on successful approach
interface BuildRequestOptions {
  preParsedText: string;
  documentType: "itt" | "response";
  contractorName?: string;
  model: string;
  serviceTier?: string;
}

function buildTextFormatRequest(options: BuildRequestOptions) {
  const contractorContext = options.contractorName && options.documentType === "response"
    ? `Contractor: ${options.contractorName}.\n\n`
    : "";

  const content = [
    {
      type: "input_text",
      text: `You are an expert construction tender analyst extracting Bill of Quantities (ITT) data.

${contractorContext}CRITICAL REQUIREMENTS:
1. Analyze ALL worksheets in the provided Excel data
2. Identify the main "Bill of Quantities" worksheet (may be named "BoQ", "Schedule", "Bill of Quantities", etc.)
3. Extract EVERY line item that contains work scope - not just samples
4. Include complete descriptions, item codes, units, quantities
5. For ITT documents, rates/amounts are typically 0 or missing
6. Return confidence as decimal between 0-1
7. IMPORTANT - Amount Column Handling:
   - If amount column contains a NUMBER: set amount to that number, set amount_label to null
   - If amount column contains TEXT (e.g., "Included", "N/A", "TBC", "See spec"):
     * Set amount_label to the exact text value
     * Set amount to null
     * DO NOT calculate qty × rate as a substitute

EXTRACTION PROCESS:
- Review all worksheet names and data structure
- Find the primary worksheet containing line items
- Extract ALL rows with item data (skip headers/totals)
- Preserve complete descriptions and item codes
- Group by sections where identifiable
- Set rates/amounts to 0 or null for ITT documents
- Carefully distinguish between numeric amounts and text labels in amount column

IMPORTANT: Extract EVERY item to resolve the 0 line items issue. Do not limit to samples.

Return ONLY JSON matching the exact schema provided.

${options.preParsedText}`,
    },
  ];

  return {
    model: options.model,
    service_tier: options.serviceTier,
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "ITTExtraction",
        strict: true,
        schema,
      },
    },
  } as const;
}

// Process Excel file with OpenAI using local parsing + Responses API
export async function processExcelWithDirectUpload(
  fileBuffer: Buffer,
  filename: string,
  documentType: "itt" | "response",
  contractorName?: string
): Promise<{ response: OpenAIExcelResponse; usage: TokenUsage }> {
  const client = getOpenAIClient();
  let lastError: Error | null = null;
  const { OPENAI_MODEL, OPENAI_SERVICE_TIER } = getEnv();
  const model = OPENAI_MODEL ?? DEFAULT_MODEL;
  const serviceTier = OPENAI_SERVICE_TIER ?? SERVICE_TIER;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();

      logger.info("Processing Excel with local parsing + GPT-5 Responses API", {
        filename,
        documentType,
        contractorName,
        attempt,
      });

      // Parse Excel locally using XLSX
      logger.info("Parsing Excel file locally");
      const wb = XLSX.read(fileBuffer);
      logger.info(`Found ${wb.SheetNames.length} worksheets: ${wb.SheetNames.join(', ')}`);

      const multi = workbookToMultiSheetJson(wb, { maxRowsPerSheet: 1000 });
      const jsonStr = JSON.stringify(multi);
      const MAX_BYTES = 700_000; // ~700 KB cap

      const preParsedText =
        jsonStr.length <= MAX_BYTES
          ? `XLSX workbook parsed (all sheets):\n${jsonStr}`
          : `XLSX workbook parsed (all sheets, truncated):\n${jsonStr.slice(0, MAX_BYTES)}\n/* TRUNCATED */`;

      logger.info(`Parsed data size: ${(jsonStr.length / 1024).toFixed(1)} KB`);

      // Build request for Responses API
      const baseOptions: BuildRequestOptions = {
        preParsedText,
        documentType,
        contractorName,
        model,
        serviceTier,
      };

      logger.info("Processing with GPT Responses API (text.format json_schema payload)", { model, serviceTier });
      const resp = await client.responses.create(buildTextFormatRequest(baseOptions));

      const endTime = Date.now();
      logger.info(`Processing completed in ${(endTime - startTime) / 1000}s`);

      // Extract JSON response
      const out = resp.output_text ?? resp.output?.[0]?.content?.[0]?.text;
      if (!out) {
        logger.error("No output returned from GPT-5", {
          fullResponse: JSON.stringify(resp, null, 2)
        });
        throw new OpenAIExtractionError(
          "No output returned from GPT-5",
          "NO_OUTPUT"
        );
      }

      logger.info("Received structured JSON response");

      // Log the full raw response for debugging
      logger.info("Raw OpenAI response", {
        rawResponse: out,
        responseLength: out.length,
        truncatedResponse: out.slice(0, 2000) // First 2000 chars for logging
      });

      let parsed: unknown;
      try {
        // Extract JSON from markdown code blocks if present
        const cleanedJson = extractJsonFromMarkdown(out);
        parsed = JSON.parse(cleanedJson);
      } catch (error) {
        logger.error('Failed to parse JSON from OpenAI response', {
          rawTextPreview: out?.slice(0, 500),
          error: error instanceof Error ? error.message : String(error)
        });
        throw new OpenAIExtractionError(
          'Failed to parse JSON from OpenAI response',
          'INVALID_JSON',
          { rawTextPreview: out?.slice(0, 500) }
        );
      }

      // Log parsed response for debugging
      logger.info("Parsed OpenAI response", {
        parsedResponse: JSON.stringify(parsed, null, 2),
        itemsCount: parsed && typeof parsed === 'object' && 'items' in parsed ? (parsed as any).items?.length : 'unknown'
      });

      // Transform the response to match our expected schema
      const transformedResponse = transformGPTResponseToSchema(parsed, documentType, contractorName);

      logger.info("Transformed response", {
        transformedItemsCount: transformedResponse.items?.length || 0,
        transformedSectionsCount: transformedResponse.sections?.length || 0
      });

      let validated: OpenAIExcelResponse;
      try {
        validated = OpenAIExcelResponseSchema.parse(transformedResponse);
      } catch (error) {
        const issues =
          error && typeof error === 'object' && 'issues' in (error as any)
            ? (error as any).issues
            : error;
        logger.error('OpenAI response schema validation failed', { issues });
        throw new OpenAIExtractionError(
          'OpenAI response schema validation failed',
          'INVALID_RESPONSE_SCHEMA',
          { issues },
        );
      }

      const usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      };

      logger.info('OpenAI extraction successful', {
        itemsExtracted: validated.items.length,
        sectionsFound: validated.sections?.length || 0,
        confidence: validated.metadata.confidence,
      });

      return { response: validated, usage };

   } catch (error) {
     lastError = error as Error;
      const detailed = (error as any)?.response?.data;
      logger.warn(`OpenAI attempt ${attempt} failed`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        willRetry: attempt < MAX_RETRIES,
        diagnostic: detailed ? JSON.stringify(detailed) : undefined,
      });

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new OpenAIExtractionError(
    `Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    "MAX_RETRIES_EXCEEDED",
    { originalError: lastError }
  );
}

const MAX_PDF_BYTES = 900_000;

export async function processPdfWithOpenAI(
  fileBuffer: Buffer,
  filename: string,
  documentType: "itt" | "response",
  contractorName?: string
): Promise<{ response: OpenAIExcelResponse; usage: TokenUsage }> {
  const client = getOpenAIClient();
  const { OPENAI_MODEL, OPENAI_SERVICE_TIER } = getEnv();
  const model = OPENAI_MODEL ?? DEFAULT_MODEL;
  const serviceTier = OPENAI_SERVICE_TIER ?? SERVICE_TIER;

  logger.info("Processing PDF with GPT-5 Responses API", {
    filename,
    documentType,
    contractorName,
  });

  const parsed = await pdfParse(fileBuffer);
  const rawText = (parsed.text ?? "").replace(/\r/g, "").trim();
  if (!rawText) {
    throw new OpenAIExtractionError("No text extracted from PDF", "EMPTY_PDF_TEXT");
  }

  const truncated = Buffer.byteLength(rawText, "utf8") > MAX_PDF_BYTES;
  const textSlice = truncated ? rawText.slice(0, MAX_PDF_BYTES) + "\n/* TRUNCATED */" : rawText;

  const contractorContext = contractorName && documentType === "response"
    ? `Contractor: ${contractorName}.\n`
    : "";

  const instructions = `You are an expert construction tender analyst extracting structured Bill of Quantities data.

${contractorContext}The source material is a PDF render of a tender ${documentType === "itt" ? "schedule" : "contractor response"}. You are given line-by-line text extracted from the document. Tables may be flattened, so infer column groupings where possible.

Return JSON that matches the exact schema provided. Interpret headings, subtotals, and free-form notes carefully to assign each priced item to the correct section hierarchy. Preserve rate-only or allowance style labels in amountLabel when numerical amounts are missing.

If the source omits a value, use null (not zero).`;

  const response = await client.responses.create({
    model,
    service_tier: serviceTier,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${instructions}\n\nPDF text (extracted):\n${textSlice}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ITTExtraction",
        strict: true,
        schema,
      },
    },
  });

  const out = response.output_text ?? response.output?.[0]?.content?.[0]?.text;
  if (!out) {
    logger.error("No output returned from GPT-5 for PDF", {
      filename,
      fullResponse: JSON.stringify(response, null, 2),
    });
    throw new OpenAIExtractionError("No output returned from GPT-5", "NO_OUTPUT");
  }

  let parsedJson: unknown;
  try {
    const cleanedJson = extractJsonFromMarkdown(out);
    parsedJson = JSON.parse(cleanedJson);
  } catch (error) {
    logger.error("Failed to parse JSON from GPT-5 PDF response", {
      filename,
      rawTextPreview: out.slice(0, 500),
      error: error instanceof Error ? error.message : String(error),
    });
    throw new OpenAIExtractionError("Failed to parse JSON from GPT-5 response", "INVALID_JSON", {
      rawTextPreview: out.slice(0, 500),
    });
  }

  let validated: OpenAIExcelResponse;
  try {
    const transformed = transformGPTResponseToSchema(parsedJson, documentType, contractorName);
    validated = OpenAIExcelResponseSchema.parse(transformed);
  } catch (error) {
    const issues = error && typeof error === "object" && "issues" in (error as any) ? (error as any).issues : error;
    logger.error("OpenAI PDF response schema validation failed", { issues });
    throw new OpenAIExtractionError("OpenAI response schema validation failed", "INVALID_RESPONSE_SCHEMA", { issues });
  }

  const usage: TokenUsage = {
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    estimatedCost: 0,
  };

  logger.info("PDF extraction successful", {
    filename,
    itemsExtracted: validated.items.length,
    truncated,
    pages: parsed.numpages,
  });

  return { response: validated, usage };
}

// Transform GPT response to match our expected schema
export function transformGPTResponseToSchema(gptResponse: any, documentType: "itt" | "response", contractorName?: string): any {
  const isItt = documentType === "itt";

  const parseNumeric = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }

      let normalised = trimmed.replace(/[,\s]/g, "");

      // Handle accounting-style negatives e.g. ($1,234.50)
      let accountingNegative = false;
      if (/^\(.*\)$/.test(normalised)) {
        accountingNegative = true;
        normalised = normalised.slice(1, -1);
      }

      // Remove common currency symbols before stripping remaining noise
      normalised = normalised.replace(/[£€¥$]/g, "");

      // Remove any trailing annotations like 'exGST' or stray text
      normalised = normalised.replace(/[^0-9+\-.]/g, "");

      if (!normalised || /^(?:\+|-)?\.?$/.test(normalised)) {
        return undefined;
      }

      const parsed = Number(normalised);
      if (!Number.isFinite(parsed)) {
        return undefined;
      }

      return accountingNegative ? -parsed : parsed;
    }

    return undefined;
  };

  const coerceNumber = (value: unknown, fallback?: number): number | undefined => {
    const parsed = parseNumeric(value);
    if (parsed !== undefined) {
      return parsed;
    }
    return fallback;
  };

  const coerceConfidence = (value: unknown): number => {
    const parsed = parseNumeric(value);
    if (parsed === undefined) {
      return 0;
    }
    return Math.min(1, Math.max(0, parsed));
  };

  const normaliseString = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    }
    return undefined;
  };

  return {
    documentType: gptResponse.doc_type || documentType,
    contractorName: gptResponse.contractor_name || contractorName || null,
    worksheetAnalyzed: gptResponse.primary_worksheet || "Unknown",
    items: (gptResponse.items || []).map((item: any) => {
      const qty = coerceNumber(item.quantity, isItt ? 0 : undefined);
      const rate = coerceNumber(item.rate, isItt ? 0 : undefined);
      const amount = coerceNumber(item.amount, isItt ? 0 : undefined);
      const amountLabel = normaliseString(item.amount_label);

      return {
        itemCode: normaliseString(item.item_code),
        description: typeof item.description === "string"
          ? item.description
          : String(item.description ?? ""),
        unit: normaliseString(item.unit),
        qty,
        rate,
        amount,
        amountLabel,
        sectionGuess: normaliseString(item.section)
      };
    }),
    sections: (gptResponse.sections || []).map((section: any) => ({
      code: section.code,
      name: section.name
    })),
    metadata: {
      totalRows: coerceNumber(gptResponse.metadata?.total_items),
      totalWorksheets: coerceNumber(gptResponse.metadata?.total_worksheets),
      extractedItems: gptResponse.items?.length || 0,
      confidence: coerceConfidence(gptResponse.metadata?.confidence),
      warnings: Array.isArray(gptResponse.metadata?.warnings)
        ? gptResponse.metadata?.warnings
        : [],
    }
  };
}

// Legacy function for backward compatibility - now uses local parsing
export async function processExcelWithAI(
  workbook: any,
  documentType: "itt" | "response",
  contractorName?: string
): Promise<OpenAIExcelResponse> {
  // Convert workbook to buffer for processing
  let buffer: Buffer;
  if (workbook && typeof workbook.xlsx === 'object' && typeof workbook.xlsx.writeBuffer === 'function') {
    // ExcelJS workbook
    buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  } else {
    // Already a buffer or other format
    buffer = Buffer.isBuffer(workbook) ? workbook : Buffer.from(workbook);
  }

  const filename = `workbook_${Date.now()}.xlsx`;

  const { response } = await processExcelWithDirectUpload(
    buffer,
    filename,
    documentType,
    contractorName
  );

  return response;
}



// Helper: Extract JSON from markdown code blocks
function extractJsonFromMarkdown(text: string): string {
  if (!text) return text;

  // Remove markdown code fences
  const fenceStart = text.indexOf('```');
  if (fenceStart !== -1) {
    const afterFence = text.slice(fenceStart + 3);
    const firstNewline = afterFence.indexOf('\n');
    const withoutLang = firstNewline !== -1 ? afterFence.slice(firstNewline + 1) : afterFence;
    const fenceEnd = withoutLang.indexOf('```');
    if (fenceEnd !== -1) {
      return withoutLang.slice(0, fenceEnd).trim();
    }
  }

  // Find JSON object boundaries
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

// Helper: Sleep function
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
