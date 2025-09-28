import type { SQSEvent, S3Event } from "aws-lambda";
import ExcelJS from "exceljs";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import { logger } from "@/lib/logger";
import { s3Client } from "@/lib/s3";
import { listProjectDocuments, updateDocumentMetadata } from "@/lib/repository/documents";
import { listParseJobs, updateParseJob } from "@/lib/repository/parse-jobs";
import {
  replaceIttItems,
  replaceResponseItems,
  ParsedIttItem,
  ParsedResponseItem,
} from "@/lib/services/project-items";
import { processExcelWithAI } from "@/lib/openai";
import {
  OpenAIExcelResponse,
  OpenAIResponseItem,
  OpenAIExtractionError,
} from "@/types/openai";

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

          try {
            logger.info("Processing Excel with AI", {
              documentType,
              contractorId,
              worksheetCount: workbook.worksheets.length,
            });

            // Process with OpenAI
            const aiResponse = await processExcelWithAI(
              workbook,
              documentType as "itt" | "response",
              contractorId ?? document.contractorName
            );

            // Convert AI response to domain models and persist
            if (documentType === "itt") {
              const parsedItems = mapAIResponseToIttItems(aiResponse);
              ingestedCount = await replaceIttItems(ownerSub, projectId, document.docId, parsedItems);
            } else if (documentType === "response") {
              const contractor = contractorId ?? document.contractorId;
              if (!contractor) {
                throw new Error("CONTRACTOR_ID_MISSING");
              }

              const parsedItems = mapAIResponseToResponseItems(aiResponse);
              ingestedCount = await replaceResponseItems(ownerSub, projectId, contractor, document.docId, parsedItems);
            }

            // Log AI extraction metrics
            logger.info("AI extraction completed", {
              documentType,
              itemsExtracted: aiResponse.items.length,
              itemsPersisted: ingestedCount,
              confidence: aiResponse.metadata.confidence,
              warnings: aiResponse.metadata.warnings,
            });

          } catch (aiError) {
            // Log AI error but continue with successful update if we got some items
            logger.error("AI extraction encountered issues", {
              error: aiError instanceof Error ? aiError.message : String(aiError),
              isOpenAIError: aiError instanceof OpenAIExtractionError,
              code: aiError instanceof OpenAIExtractionError ? aiError.code : undefined,
            });

            // If it's a critical error, re-throw
            if (ingestedCount === 0) {
              throw aiError;
            }
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

          logger.info("Excel AI extraction completed", { bucket, key, documentType, ingestedCount });
        } catch (error) {
          logger.error("Excel AI extraction failed", {
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

// Map AI response to ITT items
function mapAIResponseToIttItems(response: OpenAIExcelResponse): ParsedIttItem[] {
  const items: ParsedIttItem[] = [];
  const sections = response.sections || [];

  // Build section map
  const sectionMap = new Map<string, { code: string; name: string }>();
  sections.forEach(section => {
    sectionMap.set(section.code, section);
  });

  response.items.forEach(aiItem => {
    // Determine section from item code or section guess
    let sectionCode = "";
    let sectionName = "";
    let subSectionCode = "";
    let subSectionName = "";

    if (aiItem.itemCode) {
      const parts = aiItem.itemCode.split(".");
      if (parts.length > 0) {
        sectionCode = parts[0];
        const section = sectionMap.get(sectionCode);
        if (section) {
          sectionName = section.name;
        }

        if (parts.length > 1) {
          subSectionCode = parts.slice(0, 2).join(".");
        }
      }
    } else if (aiItem.sectionGuess) {
      // Try to extract section from the guess
      const sectionMatch = sections.find(s =>
        aiItem.sectionGuess?.toLowerCase().includes(s.name.toLowerCase())
      );
      if (sectionMatch) {
        sectionCode = sectionMatch.code;
        sectionName = sectionMatch.name;
      }
    }

    // Ensure we have required values
    const qty = aiItem.qty ?? 0;
    const rate = aiItem.rate ?? 0;
    const amount = aiItem.amount ?? (qty * rate);

    items.push({
      sectionCode,
      sectionName,
      subSectionCode,
      subSectionName,
      itemCode: aiItem.itemCode || generateItemCode(items.length + 1),
      description: aiItem.description,
      unit: aiItem.unit || "",
      qty,
      rate: Math.round(rate * 100) / 100,
      amount: Math.round(amount * 100) / 100,
    });
  });

  return items;
}

// Map AI response to Response items
function mapAIResponseToResponseItems(response: OpenAIExcelResponse): ParsedResponseItem[] {
  return response.items.map(aiItem => ({
    sectionGuess: aiItem.sectionGuess,
    itemCode: aiItem.itemCode,
    description: aiItem.description,
    unit: aiItem.unit,
    qty: aiItem.qty,
    rate: aiItem.rate ? Math.round(aiItem.rate * 100) / 100 : undefined,
    amount: aiItem.amount ? Math.round(aiItem.amount * 100) / 100 : undefined,
  }));
}

// Generate a default item code if missing
function generateItemCode(index: number): string {
  return `AUTO-${index.toString().padStart(4, "0")}`;
}

async function handleFailure(record: S3Event["Records"][number], error: Error) {
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

function normaliseMetadata(metadata: Record<string, string>): Record<string, string> {
  const normalised: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    normalised[key.toLowerCase()] = value;
  }
  return normalised;
}