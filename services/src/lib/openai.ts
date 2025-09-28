import OpenAI from "openai";
import ExcelJS from "exceljs";
import { logger } from "@/lib/logger";
import {
  OpenAIExcelResponse,
  OpenAIExcelResponseSchema,
  ExcelContext,
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

// Convert Excel worksheet to structured text format
export function worksheetToText(
  worksheet: ExcelJS.Worksheet,
  maxRows: number = 100
): { text: string; context: ExcelContext } {
  const headers: string[] = [];
  const rows: string[][] = [];
  let headerRowIndex = 0;

  // Find header row (usually within first 15 rows)
  for (let i = 1; i <= Math.min(15, worksheet.rowCount); i++) {
    const row = worksheet.getRow(i);
    const values = row.values as any[];
    if (values && values.length > 3) {
      const nonEmptyCount = values.filter(v => v && String(v).trim()).length;
      if (nonEmptyCount >= 3) {
        headerRowIndex = i;
        values.forEach((val, idx) => {
          if (val) headers[idx] = String(val).trim();
        });
        break;
      }
    }
  }

  // Extract sample rows
  const startRow = headerRowIndex + 1;
  const endRow = Math.min(startRow + maxRows, worksheet.rowCount);

  for (let i = startRow; i <= endRow; i++) {
    const row = worksheet.getRow(i);
    const values = row.values as any[];
    if (values && values.some(v => v && String(v).trim())) {
      const rowData: string[] = [];
      values.forEach((val, idx) => {
        rowData[idx] = val ? String(val).trim() : "";
      });
      rows.push(rowData);
    }
  }

  // Build text representation
  let text = `Worksheet: ${worksheet.name}\n\n`;
  text += "Headers:\n";
  headers.forEach((header, idx) => {
    if (header) text += `Column ${idx}: ${header}\n`;
  });

  text += "\nSample Data (first 10 rows):\n";
  rows.slice(0, 10).forEach((row, rowIdx) => {
    text += `Row ${rowIdx + 1}:\n`;
    row.forEach((cell, cellIdx) => {
      if (cell && headers[cellIdx]) {
        text += `  ${headers[cellIdx]}: ${cell}\n`;
      }
    });
  });

  const context: ExcelContext = {
    worksheetName: worksheet.name,
    totalRows: worksheet.rowCount,
    headers: headers.filter(Boolean),
    sampleRows: rows.slice(0, 10),
  };

  return { text, context };
}

// Generate prompt for construction/tender document extraction
export function generateExtractionPrompt(
  worksheetText: string,
  documentType: "itt" | "response",
  contractorName?: string
): string {
  const basePrompt = `You are an expert in construction tender documents and bills of quantities.
Analyze the following Excel worksheet data and extract ALL line items with their details.

${worksheetText}

This is a ${documentType === "itt" ? "Bill of Quantities (ITT)" : "Contractor Response"} document.
${contractorName ? `Contractor: ${contractorName}` : ""}

Extract information following these rules:
1. Identify ALL line items that have quantities, rates, or amounts
2. Detect section headers (e.g., "1. Preliminaries", "2. Earthworks")
3. Skip rows that are clearly notes, comments, or totals
4. Round all monetary values (rate, amount) to 2 decimal places
5. Recognize construction industry terminology and units (m², m³, kg, hours, etc.)
6. Handle hierarchical item codes (1.1.1, A.2.3) correctly
7. For response documents, make intelligent guesses about which section items belong to

Common construction sections include:
- Preliminaries / General Conditions
- Earthworks / Site Preparation
- Concrete Works
- Masonry / Blockwork
- Structural Steel
- Roofing
- Windows and Doors
- Finishes
- Plumbing / Hydraulics
- Electrical
- HVAC / Mechanical

Return a structured JSON response with all extracted items.`;

  return basePrompt;
}

// Call OpenAI API with retry logic
export async function callOpenAI(
  prompt: string,
  model: string = DEFAULT_MODEL
): Promise<{ response: OpenAIExcelResponse; usage: TokenUsage }> {
  const client = getOpenAIClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info("Calling OpenAI API", { model, attempt, serviceTier: SERVICE_TIER });

      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: "You are an expert in construction tender documents. Extract structured data from Excel worksheets accurately."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 4000,
        // @ts-ignore - service_tier might not be in types yet
        service_tier: SERVICE_TIER,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new OpenAIExtractionError(
          "Empty response from OpenAI",
          "EMPTY_RESPONSE"
        );
      }

      // Parse and validate response
      const parsed = JSON.parse(content);
      const validated = OpenAIExcelResponseSchema.parse(parsed);

      // Calculate token usage
      const usage: TokenUsage = {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
        estimatedCost: calculateCost(
          completion.usage?.prompt_tokens || 0,
          completion.usage?.completion_tokens || 0,
          model
        ),
      };

      logger.info("OpenAI extraction successful", {
        itemsExtracted: validated.items.length,
        usage,
      });

      return { response: validated, usage };
    } catch (error) {
      lastError = error as Error;
      logger.warn(`OpenAI attempt ${attempt} failed`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        willRetry: attempt < MAX_RETRIES,
      });

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt); // Exponential backoff
      }
    }
  }

  throw new OpenAIExtractionError(
    `Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    "MAX_RETRIES_EXCEEDED",
    { originalError: lastError }
  );
}

// Process Excel workbook with OpenAI
export async function processExcelWithAI(
  workbook: ExcelJS.Workbook,
  documentType: "itt" | "response",
  contractorName?: string
): Promise<OpenAIExcelResponse> {
  // Find the most relevant worksheet
  const worksheet = findRelevantWorksheet(workbook, documentType);
  if (!worksheet) {
    throw new OpenAIExtractionError(
      "No relevant worksheet found",
      "NO_WORKSHEET"
    );
  }

  logger.info("Processing worksheet with AI", {
    worksheetName: worksheet.name,
    documentType,
    contractorName,
  });

  // Convert worksheet to text
  const { text, context } = worksheetToText(worksheet);

  // Generate prompt
  const prompt = generateExtractionPrompt(text, documentType, contractorName);

  // Call OpenAI
  const { response, usage } = await callOpenAI(
    prompt,
    process.env.OPENAI_MODEL || DEFAULT_MODEL
  );

  // Log extraction metrics
  logger.info("AI extraction completed", {
    worksheetName: worksheet.name,
    itemsExtracted: response.items.length,
    sectionsFound: response.sections?.length || 0,
    confidence: response.metadata.confidence,
    tokenUsage: usage,
  });

  return response;
}

// Helper: Find most relevant worksheet
function findRelevantWorksheet(
  workbook: ExcelJS.Workbook,
  documentType: "itt" | "response"
): ExcelJS.Worksheet | null {
  // Try to find by name patterns
  const patterns = documentType === "itt"
    ? ["boq", "bill", "quantities", "schedule", "itt"]
    : ["response", "pricing", "tender", "quote", "rates"];

  for (const worksheet of workbook.worksheets) {
    const nameLower = worksheet.name.toLowerCase();
    if (patterns.some(pattern => nameLower.includes(pattern))) {
      return worksheet;
    }
  }

  // Check content of first worksheet
  const firstSheet = workbook.worksheets[0];
  if (firstSheet && hasRelevantContent(firstSheet)) {
    return firstSheet;
  }

  // Fallback to first non-empty worksheet
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > 5) {
      return worksheet;
    }
  }

  return null;
}

// Helper: Check if worksheet has relevant content
function hasRelevantContent(worksheet: ExcelJS.Worksheet): boolean {
  const keywords = ["item", "description", "qty", "quantity", "rate", "amount", "total", "price"];

  // Check first 10 rows for keywords
  for (let i = 1; i <= Math.min(10, worksheet.rowCount); i++) {
    const row = worksheet.getRow(i);
    const values = row.values as any[];
    if (values) {
      const text = values.map(v => String(v || "").toLowerCase()).join(" ");
      if (keywords.some(keyword => text.includes(keyword))) {
        return true;
      }
    }
  }

  return false;
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