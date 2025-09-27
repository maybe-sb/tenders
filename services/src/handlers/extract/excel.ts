import type { S3Event } from "aws-lambda";
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


export async function handler(event: S3Event) {
  for (const record of event.Records) {
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
      const worksheet = workbook.worksheets[0];

      if (!worksheet) {
        throw new Error("WORKSHEET_NOT_FOUND");
      }

      let ingestedCount = 0;

      if (documentType === "itt") {
        const parsedItems = extractIttItems(worksheet);
        ingestedCount = await replaceIttItems(ownerSub, projectId, document.docId, parsedItems);
      } else if (documentType === "response") {
        const contractor = contractorId ?? document.contractorId;
        if (!contractor) {
          throw new Error("CONTRACTOR_ID_MISSING");
        }

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

function extractIttItems(worksheet: ExcelJS.Worksheet): ParsedIttItem[] {
  const header = mapHeaders(worksheet);
  const items: ParsedIttItem[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const description = getCellValue(row, header.description)?.trim();
    if (!description) {
      return;
    }

    const qty = parseNumber(getCellValue(row, header.qty));
    const rate = parseNumber(getCellValue(row, header.rate));
    const amount = parseNumber(getCellValue(row, header.amount));

    items.push({
      sectionCode: getCellValue(row, header.sectionCode) ?? getCellValue(row, header.section),
      sectionName: getCellValue(row, header.section),
      itemCode: getCellValue(row, header.itemCode) ?? "",
      description,
      unit: getCellValue(row, header.unit) ?? "",
      qty,
      rate,
      amount: amount || qty * rate,
    });
  });

  return items;
}

function extractResponseItems(worksheet: ExcelJS.Worksheet): ParsedResponseItem[] {
  const header = mapHeaders(worksheet);
  const items: ParsedResponseItem[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const description = getCellValue(row, header.description)?.trim();
    if (!description) {
      return;
    }

    const qty = parseNumber(getCellValue(row, header.qty));
    const rate = parseNumber(getCellValue(row, header.rate));
    const amount = parseNumber(getCellValue(row, header.amount));

    items.push({
      sectionGuess: getCellValue(row, header.section) ?? getCellValue(row, header.sectionCode),
      itemCode: getCellValue(row, header.itemCode) ?? undefined,
      description,
      unit: getCellValue(row, header.unit) ?? undefined,
      qty: Number.isFinite(qty) ? qty : undefined,
      rate: Number.isFinite(rate) ? rate : undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
    });
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
