import OpenAI from "openai";
import path from "node:path";
import { File } from "node:buffer";
import { logger } from "@/lib/logger";
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

// Generate extraction prompt for direct file upload
function generateExtractionPrompt(
  filename: string,
  documentType: "itt" | "response",
  contractorName?: string
): string {
  return `You are an expert in construction tender documents and bills of quantities.

I'm uploading an Excel workbook file: "${filename}"

Your task is to:
1. ANALYZE the entire workbook to understand the document structure
2. IDENTIFY which worksheet(s) contain actual line item pricing/quotation data
3. EXTRACT all line items with their details from the most relevant sections

This is a ${documentType === "itt" ? "Bill of Quantities (ITT)" : "Contractor Response"} document.
${contractorName ? `Contractor: ${contractorName}` : ""}

EXTRACTION RULES:
- Find and extract ALL line items that have quantities, rates, or monetary amounts
- Identify section headers and hierarchical structures
- Skip rows that are clearly notes, comments, totals, or headers
- Round all monetary values to exactly 2 decimal places
- Recognize construction terminology and units (m², m³, kg, hours, etc.)
- Handle various item code formats (1.1.1, A.2.3, etc.)
- Intelligently determine section groupings

COMMON CONSTRUCTION SECTIONS:
- Preliminaries / General Conditions / Site Setup
- Earthworks / Excavation / Site Preparation
- Concrete Works / Foundations
- Masonry / Blockwork / Brickwork
- Structural Steel / Metalwork
- Roofing / Waterproofing
- Windows and Doors / Glazing
- Finishes / Painting / Flooring
- Plumbing / Hydraulics / Drainage
- Electrical / Lighting
- HVAC / Mechanical / Air Conditioning

IMPORTANT: Analyze the ENTIRE workbook first, then focus on extracting data from the worksheet(s) that contain actual pricing/line item data. Ignore cover sheets and summaries unless they contain line items.

Return ONLY a valid JSON response in this exact format:
{
  "documentType": "${documentType}",
  "contractorName": "contractor name if identified",
  "worksheetAnalyzed": "name of primary worksheet used for extraction",
  "items": [
    {
      "itemCode": "item code or null",
      "description": "description of work",
      "unit": "unit of measurement or null",
      "qty": numeric_quantity_or_null,
      "rate": numeric_rate_rounded_to_2_decimals_or_null,
      "amount": numeric_amount_rounded_to_2_decimals_or_null,
      "sectionGuess": "best guess at section name"
    }
  ],
  "sections": [
    {
      "code": "section code",
      "name": "section name"
    }
  ],
  "metadata": {
    "totalRows": total_number_of_rows_processed,
    "totalWorksheets": number_of_worksheets_analyzed,
    "extractedItems": number_of_items_extracted,
    "confidence": confidence_score_0_to_1,
    "warnings": ["any warnings or issues encountered"]
  }
}`;
}


// Process Excel file with OpenAI using direct file upload
export async function processExcelWithDirectUpload(
  fileBuffer: Buffer,
  filename: string,
  documentType: "itt" | "response",
  contractorName?: string
): Promise<{ response: OpenAIExcelResponse; usage: TokenUsage }> {
  const client = getOpenAIClient();
  let assistantId: string | null = null;
  let fileId: string | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
      const serviceTier = process.env.OPENAI_SERVICE_TIER || SERVICE_TIER;

      logger.info("Processing Excel with OpenAI direct upload", {
        filename,
        documentType,
        contractorName,
        attempt,
        serviceTier,
      });

      // Upload file to OpenAI
      logger.info("Uploading file to OpenAI");
      const mimeType = inferMimeType(filename);
      const fileUpload = new File([fileBuffer], filename, { type: mimeType });
      const file = await client.files.create({
        file: fileUpload,
        purpose: "assistants",
      });
      fileId = file.id;
      logger.info("File uploaded successfully", { fileId: file.id, size: file.bytes, mimeType });

      // Create assistant
      logger.info("Creating OpenAI assistant");
      const assistant = await client.beta.assistants.create({
        name: "Construction Document Analyzer",
        instructions: `You are an expert at analyzing construction tender Excel files.

When given an Excel file, analyze it and extract all line items with pricing information.

Return a JSON response with:
- contractorName: name if found
- items: array of line items with itemCode, description, qty, unit, rate, amount
- totalItems: count of items found

Focus on finding actual line items with quantities and pricing, not headers or totals.`,
        model: model,
        tools: [{ type: "code_interpreter" }],
        tool_resources: {
          code_interpreter: {
            file_ids: [file.id]
          }
        }
      });
      assistantId = assistant.id;
      logger.info("Assistant created successfully", { assistantId: assistant.id });

      // Create thread
      logger.info("Creating conversation thread");
      const thread = await client.beta.threads.create();

      // Add message with extraction prompt
      await client.beta.threads.messages.create(thread.id, {
        role: "user",
        content: generateExtractionPrompt(filename, documentType, contractorName)
      });

      // Run the assistant
      logger.info("Starting analysis run");
      const run = await client.beta.threads.runs.create(thread.id, {
        assistant_id: assistant.id
      });

      // Wait for completion
      let runStatus = run;
      while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
        await sleep(2000);
        runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
        logger.info("Run status update", { status: runStatus.status });
      }

      if (runStatus.status === 'completed') {
        // Get the response
        const messages = await client.beta.threads.messages.list(thread.id);
        const lastMessage = messages.data[0];

        if (lastMessage.content[0].type === 'text') {
          const rawText = lastMessage.content[0].text.value;
          const jsonPayload = extractJsonFromText(rawText);

          let parsed: unknown;
          try {
            parsed = JSON.parse(jsonPayload);
          } catch (error) {
            logger.error('Failed to parse JSON from OpenAI response', {
              rawTextPreview: rawText?.slice(0, 500),
            });
            throw new OpenAIExtractionError(
              'Failed to parse JSON from OpenAI response',
              'INVALID_JSON',
              { rawTextPreview: rawText?.slice(0, 500) }
            );
          }

          let validated: OpenAIExcelResponse;
          try {
            validated = OpenAIExcelResponseSchema.parse(parsed);
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
        } else {
          throw new OpenAIExtractionError(
            'Unexpected response format from OpenAI',
            'INVALID_RESPONSE_FORMAT'
          );
        }
      } else {
        throw new OpenAIExtractionError(
          `Run failed with status: ${runStatus.status}. Error: ${runStatus.last_error?.message || 'Unknown error'}`,
          "RUN_FAILED"
        );
      }
    } catch (error) {
      lastError = error as Error;
      logger.warn(`OpenAI attempt ${attempt} failed`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        willRetry: attempt < MAX_RETRIES,
      });

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    } finally {
      // Cleanup resources
      if (assistantId) {
        try {
          await client.beta.assistants.del(assistantId);
          logger.info("Assistant cleaned up", { assistantId });
        } catch (cleanupError) {
          logger.warn("Failed to cleanup assistant", { assistantId, error: cleanupError });
        }
      }
      if (fileId) {
        try {
          await client.files.del(fileId);
          logger.info("File cleaned up", { fileId });
        } catch (cleanupError) {
          logger.warn("Failed to cleanup file", { fileId, error: cleanupError });
        }
      }
    }
  }

  throw new OpenAIExtractionError(
    `Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    "MAX_RETRIES_EXCEEDED",
    { originalError: lastError }
  );
}

// Legacy function for backward compatibility - now uses direct upload
export async function processExcelWithAI(
  workbook: ExcelJS.Workbook,
  documentType: "itt" | "response",
  contractorName?: string
): Promise<OpenAIExcelResponse> {
  // Convert workbook back to buffer for direct upload
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `workbook_${Date.now()}.xlsx`;

  const { response } = await processExcelWithDirectUpload(
    Buffer.from(buffer),
    filename,
    documentType,
    contractorName
  );

  return response;
}


function extractJsonFromText(text: string): string {
  if (!text) {
    return text;
  }

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

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}
function inferMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".csv":
      return "text/csv";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

// Helper: Calculate cost estimate
function calculateCost(
  promptTokens: number,
  completionTokens: number,
  model: string
): number {
  // GPT-5 pricing (hypothetical - adjust as needed)
  const pricing = {
    "gpt-5": { prompt: 0.00015, completion: 0.0006 }, // per token
    "gpt-4-turbo-preview": { prompt: 0.00001, completion: 0.00003 },
    "gpt-4": { prompt: 0.00003, completion: 0.00006 },
  };

  const modelPricing = pricing[model as keyof typeof pricing] || pricing["gpt-4"];

  return (
    (promptTokens * modelPricing.prompt) +
    (completionTokens * modelPricing.completion)
  );
}

// Helper: Sleep function
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

