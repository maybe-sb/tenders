import type { SQSEvent, S3Event } from "aws-lambda";
import ExcelJS from "exceljs";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import { logger } from "@/lib/logger";
import { s3Client } from "@/lib/s3";
import { listProjectDocuments, updateDocumentMetadata } from "@/lib/repository/documents";
import { listParseJobs, updateParseJob } from "@/lib/repository/parse-jobs";
import { replaceIttItems, replaceResponseItems, ParsedIttItem, ParsedResponseItem } from "@/lib/services/project-items";

const HEADER_SYNONYMS = {
  itemCode: ["item", "item no", "item number", "item code", "ref", "reference"],
  description: ["description", "item description", "scope", "details"],
  unit: ["unit", "uom"],
  qty: ["qty", "quantity", "qty."],
  rate: ["rate", "unit rate", "price"],
  amount: ["amount", "total", "line total", "value"],
  section: ["section", "section name"],
  sectionCode: ["section code", "section id", "section"],
};


export async function handler(event: SQSEvent) {
  for (const sqsRecord of event.Records) {
    try {
      // Parse S3 event from SQS message body
      const s3Event: S3Event = JSON.parse(sqsRecord.body);

      // Process each S3 record within the S3 event
      for (const record of s3Event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        try {
          const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          const metadata = normaliseMetadata(head.Metadata ?? {});

          const projectId = metadata["project-id"];
          const ownerSub = metadata["owner-sub"] ?? process.env.DEFAULT_OWNER_SUB ?? "demo-user";
          const documentType = metadata["document-type"];
          const source = metadata["source"] ?? "excel";
          const contractorId = metadata["contractor-id"];

          if (!projectId || !documentType) {
            logger.warn("Missing metadata for object; skipping", { bucket, key, metadata });
            continue;
          }

          if (source !== "excel") {
            logger.info("Skipping non-Excel source", { bucket, key, source });
            continue;
          }

          const document = await findDocumentByKey(ownerSub, projectId, key);
          if (!document) {
            logger.warn("Document record not found for uploaded object", { projectId, key });
            continue;
          }

          const job = await findLatestParseJob(ownerSub, projectId, document.docId);
          if (job) {
            await updateParseJob(ownerSub, projectId, job.jobId, {
              status: "running",
              startedAt: job.startedAt ?? new Date().toISOString(),
            });
          }

          await updateDocumentMetadata(ownerSub, projectId, document.docId, {
            parseStatus: "parsing",
          });

          const buffer = await fetchObjectBuffer(bucket, key);
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);

          let ingestedCount = 0;

          if (documentType === "itt") {
            const worksheet = findIttWorksheet(workbook);
            if (!worksheet) {
              throw new Error("ITT_WORKSHEET_NOT_FOUND");
            }
            const parsedItems = extractIttItems(worksheet);
            ingestedCount = await replaceIttItems(ownerSub, projectId, document.docId, parsedItems);
          } else if (documentType === "response") {
            const worksheet = findResponseWorksheet(workbook);
            if (!worksheet) {
              throw new Error("RESPONSE_WORKSHEET_NOT_FOUND");
            }
            const contractor = contractorId ?? document.contractorId;
            if (!contractor) {
              throw new Error("CONTRACTOR_ID_MISSING");
            }

            logger.info("Processing response document", {
              documentId: document.docId,
              contractorId: contractor,
              worksheetName: worksheet.name,
              totalWorksheets: workbook.worksheets.length
            });

            const parsedItems = extractResponseItems(worksheet);
            ingestedCount = await replaceResponseItems(ownerSub, projectId, contractor, document.docId, parsedItems);
          } else {
            logger.info("Unsupported document type for Excel extractor", { documentType });
          }

          await updateDocumentMetadata(ownerSub, projectId, document.docId, {
            parseStatus: "parsed",
            stats: {
              lineItems: ingestedCount,
              matched: 0,
            },
          });

          if (job) {
            await updateParseJob(ownerSub, projectId, job.jobId, {
              status: "succeeded",
              finishedAt: new Date().toISOString(),
            });
          }

          logger.info("Excel extraction completed", { bucket, key, documentType, ingestedCount });
        } catch (error) {
          logger.error("Excel extraction failed", {
            bucket,
            key,
            error: error instanceof Error ? error.message : String(error),
          });

          await handleFailure(record, error as Error);
        }
      }
    } catch (error) {
      logger.error("Failed to parse SQS message", {
        messageId: sqsRecord.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function handleFailure(record: S3Event['Records'][number], error: Error) {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const metadata = normaliseMetadata(head.Metadata ?? {});
    const projectId = metadata["project-id"];
    const ownerSub = metadata["owner-sub"] ?? process.env.DEFAULT_OWNER_SUB ?? "demo-user";

    if (!projectId) {
      return;
    }

    const document = await findDocumentByKey(ownerSub, projectId, key);
    if (document) {
      await updateDocumentMetadata(ownerSub, projectId, document.docId, {
        parseStatus: "error",
        message: error.message,
      });

      const job = await findLatestParseJob(ownerSub, projectId, document.docId);
      if (job) {
        await updateParseJob(ownerSub, projectId, job.jobId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          message: error.message,
        });
      }
    }
  } catch (innerError) {
    logger.error("Failed to record parse failure", {
      bucket,
      key,
      error: innerError instanceof Error ? innerError.message : String(innerError),
    });
  }
}

async function fetchObjectBuffer(bucket: string, key: string): Promise<Uint8Array> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error("OBJECT_BODY_EMPTY");
  }

  if (typeof (response.Body as any).transformToByteArray === "function") {
    return await (response.Body as any).transformToByteArray();
  }

  const chunks: Buffer[] = [];
  const body = response.Body as NodeJS.ReadableStream;
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function findDocumentByKey(ownerSub: string, projectId: string, key: string) {
  const documents = await listProjectDocuments(ownerSub, projectId);
  return documents.find((document) => document.s3KeyRaw === key) ?? null;
}

async function findLatestParseJob(ownerSub: string, projectId: string, documentId: string) {
  const jobs = await listParseJobs(ownerSub, projectId);
  const sorted = jobs
    .filter((job) => job.documentId === documentId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sorted[0] ?? null;
}

function findIttWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  // First, try to find worksheet with "Bill of Quantities" or "BOQ" in the name
  const boqSheet = workbook.worksheets.find(sheet =>
    sheet.name.toLowerCase().includes('bill of quantities') ||
    sheet.name.toLowerCase().includes('boq')
  );

  if (boqSheet) {
    return boqSheet;
  }

  // Fallback to first worksheet if no BOQ sheet found
  return workbook.worksheets[0] ?? null;
}

function findIttHeaders(worksheet: ExcelJS.Worksheet): { header: Record<string, number | undefined>, headerRowNumber: number } {
  const headerSynonyms = {
    itemCode: ["item", "item no", "item number", "item code", "ref", "reference"],
    description: ["description", "item description", "scope", "details", "description of work"],
    unit: ["unit", "uom"],
    qty: ["qty", "quantity", "qty."],
    rate: ["rate", "unit rate", "price"],
    amount: ["amount", "total", "line total", "value", "cost"],
    section: ["section", "section name"],
    sectionCode: ["section code", "section id", "section"],
  };

  // Check rows 1-15 for potential headers
  for (let rowNumber = 1; rowNumber <= Math.min(15, worksheet.rowCount); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const mapping: Record<string, number | undefined> = {};
    let foundHeaders = 0;

    row.eachCell((cell, colNumber) => {
      const headerText = String(cell.value || "").toLowerCase().trim();
      if (!headerText) return;

      for (const [key, synonyms] of Object.entries(headerSynonyms)) {
        if (synonyms.some(candidate => headerText === candidate || headerText.includes(candidate))) {
          mapping[key] = colNumber;
          foundHeaders++;
        }
      }
    });

    // If we found at least 4 key headers (item, description, qty, unit), this is likely the header row
    if (foundHeaders >= 4 && mapping.itemCode && mapping.description && mapping.qty) {
      return { header: mapping, headerRowNumber: rowNumber };
    }
  }

  // Fallback to row 1 if no clear header found
  const fallbackHeader = mapHeaders(worksheet);
  return { header: fallbackHeader, headerRowNumber: 1 };
}

function extractSectionFromItemCode(itemCode: string): string {
  // Extract section from hierarchical item codes like "1.1.1" -> "1.1"
  const parts = itemCode.split('.');
  if (parts.length > 1) {
    // Return all but the last part
    return parts.slice(0, -1).join('.');
  }
  // If no dots, return the item code itself as section
  return itemCode;
}

function getHierarchyLevel(itemCode: string): number {
  // Determine hierarchy level based on item code structure
  // Level 1: "1", "2", "3" (sections)
  // Level 2: "1.1", "1.2", "2.1" (sub-sections)
  // Level 3+: "1.1.1", "1.1.2", "1.2.1.1" (line items)
  return itemCode.split('.').length;
}

function buildHierarchyMap(
  worksheet: ExcelJS.Worksheet,
  header: Record<string, number | undefined>,
  headerRowNumber: number
): Map<string, string> {
  const hierarchyMap = new Map<string, string>();

  worksheet.eachRow((row, rowNumber) => {
    // Skip rows until after the header row
    if (rowNumber <= headerRowNumber) {
      return;
    }

    const itemCode = getCellValue(row, header.itemCode)?.trim();
    const description = getCellValue(row, header.description)?.trim();

    // Skip rows without meaningful content
    if (!description || !itemCode) {
      return;
    }

    const hierarchyLevel = getHierarchyLevel(itemCode);

    // Only capture section (level 1) and sub-section (level 2) headers
    if (hierarchyLevel === 1 || hierarchyLevel === 2) {
      // Check if this is likely a header (no quantities typically)
      const hasQuantity = getCellValue(row, header.qty)?.trim();
      const hasUnit = getCellValue(row, header.unit)?.trim();

      // Section/sub-section headers typically don't have quantities
      if (!hasQuantity && !hasUnit) {
        hierarchyMap.set(itemCode, description);
      }
      // But also capture if it's a clear section/sub-section even with quantities
      else if (hierarchyLevel <= 2) {
        // For level 1 and 2, capture the mapping regardless of quantities
        // This handles cases where sections might have summary quantities
        hierarchyMap.set(itemCode, description);
      }
    }
  });

  return hierarchyMap;
}

function extractIttItems(worksheet: ExcelJS.Worksheet): ParsedIttItem[] {
  const { header, headerRowNumber } = findIttHeaders(worksheet);

  // Phase 1: Build hierarchy map by scanning all rows for section/sub-section headers
  const hierarchyMap = buildHierarchyMap(worksheet, header, headerRowNumber);

  // Phase 2: Extract line items with proper section/sub-section context
  const items: ParsedIttItem[] = [];
  let currentSectionCode = "";
  let currentSectionName = "";
  let currentSubSectionCode = "";
  let currentSubSectionName = "";

  worksheet.eachRow((row, rowNumber) => {
    // Skip rows until after the header row
    if (rowNumber <= headerRowNumber) {
      return;
    }

    const itemCode = getCellValue(row, header.itemCode)?.trim();
    const description = getCellValue(row, header.description)?.trim();

    // Skip rows without meaningful content
    if (!description || !itemCode) {
      return;
    }

    const hierarchyLevel = getHierarchyLevel(itemCode);

    if (hierarchyLevel === 1) {
      // Section header (e.g., "1" -> "Preliminaries")
      currentSectionCode = itemCode;
      currentSectionName = hierarchyMap.get(itemCode) || description;
      currentSubSectionCode = "";
      currentSubSectionName = "";
    } else if (hierarchyLevel === 2) {
      // Sub-section header (e.g., "1.1" -> "Establishment")
      currentSubSectionCode = itemCode;
      currentSubSectionName = hierarchyMap.get(itemCode) || description;
    } else if (hierarchyLevel >= 3) {
      // Potential line item - check if it has quantities
      const hasQuantity = getCellValue(row, header.qty)?.trim();
      const hasUnit = getCellValue(row, header.unit)?.trim();

      // Only extract actual line items (not deeper section headers)
      if (hasQuantity || hasUnit) {
        const qty = parseNumber(getCellValue(row, header.qty));
        const rate = parseNumber(getCellValue(row, header.rate));
        const amount = parseNumber(getCellValue(row, header.amount));

        items.push({
          sectionCode: currentSectionCode,
          sectionName: currentSectionName,
          subSectionCode: currentSubSectionCode,
          subSectionName: currentSubSectionName,
          itemCode: itemCode,
          description,
          unit: getCellValue(row, header.unit) ?? "",
          qty,
          rate,
          amount: amount || (qty && rate ? qty * rate : 0),
        });
      }
    }
  });

  return items;
}

function findResponseWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  // First, try to find worksheet with common response/pricing terms
  const responseSheet = workbook.worksheets.find(sheet => {
    const name = sheet.name.toLowerCase();
    return name.includes('response') ||
           name.includes('pricing') ||
           name.includes('tender') ||
           name.includes('quote') ||
           name.includes('prices') ||
           name.includes('schedule') ||
           name.includes('form');
  });

  if (responseSheet) {
    logger.info("Found response worksheet by name", { worksheetName: responseSheet.name });
    return responseSheet;
  }

  // Try to find worksheet with pricing data by scanning for financial columns
  for (const worksheet of workbook.worksheets) {
    if (hasResponseContent(worksheet)) {
      logger.info("Found response worksheet by content analysis", { worksheetName: worksheet.name });
      return worksheet;
    }
  }

  // Fallback to first worksheet if no specific response sheet found
  logger.info("Using first worksheet as fallback", {
    worksheetName: workbook.worksheets[0]?.name || "None"
  });
  return workbook.worksheets[0] ?? null;
}

function hasResponseContent(worksheet: ExcelJS.Worksheet): boolean {
  // Check first 10 rows for signs of pricing content
  for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    let hasAmount = false;
    let hasDescription = false;

    row.eachCell((cell) => {
      const value = String(cell.value || "").toLowerCase();
      if (value.includes('amount') || value.includes('total') || value.includes('price') || value.includes('rate')) {
        hasAmount = true;
      }
      if (value.includes('description') || value.includes('item') || value.includes('scope')) {
        hasDescription = true;
      }
    });

    if (hasAmount && hasDescription) {
      return true;
    }
  }
  return false;
}

function findResponseHeaders(worksheet: ExcelJS.Worksheet): { header: Record<string, number | undefined>, headerRowNumber: number } {
  const responseHeaderSynonyms = {
    itemCode: ["item", "item no", "item number", "item code", "ref", "reference", "line", "line no"],
    description: ["description", "item description", "scope", "details", "work description", "specification"],
    unit: ["unit", "uom", "each", "ea"],
    qty: ["qty", "quantity", "qty.", "amount", "no."],
    rate: ["rate", "unit rate", "price", "unit price", "unit cost"],
    amount: ["amount", "total", "line total", "value", "total cost", "total price", "extension"],
    section: ["section", "section name", "trade", "category"],
    sectionCode: ["section code", "section id", "section", "trade code"],
  };

  // Check rows 1-15 for potential headers (similar to ITT logic)
  for (let rowNumber = 1; rowNumber <= Math.min(15, worksheet.rowCount); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const mapping: Record<string, number | undefined> = {};
    let foundHeaders = 0;

    row.eachCell((cell, colNumber) => {
      const headerText = String(cell.value || "").toLowerCase().trim();
      if (!headerText) return;

      for (const [key, synonyms] of Object.entries(responseHeaderSynonyms)) {
        if (synonyms.some(candidate => headerText === candidate || headerText.includes(candidate))) {
          mapping[key] = colNumber;
          foundHeaders++;
        }
      }
    });

    // If we found at least 3 key headers, this is likely the header row
    if (foundHeaders >= 3 && mapping.description) {
      logger.info("Found response headers", {
        headerRowNumber: rowNumber,
        foundHeaders,
        mapping: Object.keys(mapping)
      });
      return { header: mapping, headerRowNumber: rowNumber };
    }
  }

  // Fallback to row 1 if no clear header found
  logger.warn("No clear header row found, using row 1 as fallback");
  const fallbackHeader = mapResponseHeaders(worksheet);
  return { header: fallbackHeader, headerRowNumber: 1 };
}

function mapResponseHeaders(worksheet: ExcelJS.Worksheet): Record<string, number | undefined> {
  const headerRow = worksheet.getRow(1);
  const mapping: Record<string, number | undefined> = {};

  const responseHeaderSynonyms = {
    itemCode: ["item", "item no", "item number", "item code", "ref", "reference", "line", "line no"],
    description: ["description", "item description", "scope", "details", "work description", "specification"],
    unit: ["unit", "uom", "each", "ea"],
    qty: ["qty", "quantity", "qty.", "amount", "no."],
    rate: ["rate", "unit rate", "price", "unit price", "unit cost"],
    amount: ["amount", "total", "line total", "value", "total cost", "total price", "extension"],
    section: ["section", "section name", "trade", "category"],
    sectionCode: ["section code", "section id", "section", "trade code"],
  };

  headerRow.eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? "").toLowerCase().trim();
    if (!headerText) {
      return;
    }

    for (const [key, synonyms] of Object.entries(responseHeaderSynonyms)) {
      if (synonyms.some((candidate) => headerText === candidate || headerText.includes(candidate))) {
        mapping[key] = colNumber;
      }
    }
  });

  return mapping;
}

function extractResponseItems(worksheet: ExcelJS.Worksheet): ParsedResponseItem[] {
  const { header, headerRowNumber } = findResponseHeaders(worksheet);
  const items: ParsedResponseItem[] = [];

  logger.info("Starting response item extraction", {
    worksheetName: worksheet.name,
    headerRowNumber,
    totalRows: worksheet.rowCount,
    headerMapping: Object.keys(header)
  });

  let extractedCount = 0;
  let skippedCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    // Skip rows until after the header row
    if (rowNumber <= headerRowNumber) {
      return;
    }

    const description = getCellValue(row, header.description)?.trim();

    // Skip rows without meaningful description
    if (!description || description.length < 3) {
      skippedCount++;
      return;
    }

    // Skip rows that look like section headers or totals
    const descriptionLower = description.toLowerCase();
    if (descriptionLower.includes('total') ||
        descriptionLower.includes('subtotal') ||
        descriptionLower.includes('section') ||
        descriptionLower.startsWith('part ') ||
        descriptionLower.match(/^[0-9]+\.?\s*$/)) {
      skippedCount++;
      return;
    }

    const qty = parseNumber(getCellValue(row, header.qty));
    const rate = parseNumber(getCellValue(row, header.rate));
    const amount = parseNumber(getCellValue(row, header.amount));

    // For valid response items, we should have at least description and some pricing data
    const hasValidData = description && (
      Number.isFinite(qty) ||
      Number.isFinite(rate) ||
      Number.isFinite(amount)
    );

    if (hasValidData) {
      items.push({
        sectionGuess: getCellValue(row, header.section) ?? getCellValue(row, header.sectionCode),
        itemCode: getCellValue(row, header.itemCode) ?? undefined,
        description,
        unit: getCellValue(row, header.unit) ?? undefined,
        qty: Number.isFinite(qty) ? qty : undefined,
        rate: Number.isFinite(rate) ? rate : undefined,
        amount: Number.isFinite(amount) ? amount : undefined,
      });
      extractedCount++;
    } else {
      skippedCount++;
    }
  });

  logger.info("Response item extraction completed", {
    extractedCount,
    skippedCount,
    totalProcessedRows: extractedCount + skippedCount
  });

  return items;
}

function mapHeaders(worksheet: ExcelJS.Worksheet): Record<string, number | undefined> {
  const headerRow = worksheet.getRow(1);
  const mapping: Record<string, number | undefined> = {};

  headerRow.eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? "").toLowerCase().trim();
    if (!headerText) {
      return;
    }

    for (const [key, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.some((candidate) => headerText === candidate || headerText.startsWith(candidate))) {
        mapping[key] = colNumber;
      }
    }
  });

  return mapping;
}

function getCellValue(row: ExcelJS.Row, column?: number): string | undefined {
  if (!column) {
    return undefined;
  }
  const cell = row.getCell(column);
  if (cell.value === null || cell.value === undefined) {
    return undefined;
  }
  if (typeof cell.value === "object" && cell.value && "text" in cell.value) {
    return String((cell.value as ExcelJS.CellRichTextValue | ExcelJS.CellHyperlinkValue).text ?? "");
  }
  return String(cell.value ?? "");
}

function parseNumber(value?: string): number {
  if (!value) {
    return 0;
  }
  const cleaned = value.replace(/[,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseMetadata(metadata: Record<string, string>): Record<string, string> {
  const normalised: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    normalised[key.toLowerCase()] = value;
  }
  return normalised;
}
