import type { SQSEvent, S3Event } from "aws-lambda";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import { logger } from "@/lib/logger";
import { s3Client } from "@/lib/s3";
import { listProjectDocuments, updateDocumentMetadata } from "@/lib/repository/documents";
import { listParseJobs, updateParseJob } from "@/lib/repository/parse-jobs";
import { replaceIttItems, replaceResponseItems } from "@/lib/services/project-items";
import { processPdfWithOpenAI } from "@/lib/openai";
import { OpenAIExtractionError } from "@/types/openai";
import { mapAIResponseToIttItems, mapAIResponseToResponseItems } from "@/lib/services/ai-mappers";

export async function handler(event: SQSEvent) {
  for (const sqsRecord of event.Records) {
    try {
      const s3Event: S3Event = JSON.parse(sqsRecord.body);

      for (const record of s3Event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        try {
          const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          const metadata = normaliseMetadata(head.Metadata ?? {});

          const projectId = metadata["project-id"];
          const ownerSub = metadata["owner-sub"] ?? process.env.DEFAULT_OWNER_SUB ?? "demo-user";
          const documentType = metadata["document-type"];
          const source = metadata["source"] ?? "pdf";
          const contractorId = metadata["contractor-id"];

          if (!projectId || !documentType) {
            logger.warn("Missing metadata for PDF object; skipping", { bucket, key, metadata });
            continue;
          }

          if (source !== "pdf") {
            logger.info("Skipping non-PDF source", { bucket, key, source });
            continue;
          }

          const document = await findDocumentByKeyWithRetry(ownerSub, projectId, key);
          if (!document) {
            logger.warn("Document record not found for PDF upload", { projectId, key });
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

          let ingestedCount = 0;

          try {
            const filename = key.split("/").pop() || "response.pdf";
            logger.info("Processing PDF with OpenAI", {
              bucket,
              key,
              projectId,
              documentType,
              filename,
            });

            const { response: aiResponse } = await processPdfWithOpenAI(
              Buffer.from(buffer),
              filename,
              documentType as "itt" | "response",
              contractorId ?? document.contractorName
            );

            if (documentType === "itt") {
              const parsedItems = mapAIResponseToIttItems(aiResponse);
              const topLevelSections = (aiResponse.sections ?? []).filter((section) => !section.code.includes('.'));
              ingestedCount = await replaceIttItems(ownerSub, projectId, document.docId, parsedItems, topLevelSections);
            } else if (documentType === "response") {
              const contractor = contractorId ?? document.contractorId;
              if (!contractor) {
                throw new Error("CONTRACTOR_ID_MISSING");
              }
              const parsedItems = mapAIResponseToResponseItems(aiResponse);
              ingestedCount = await replaceResponseItems(ownerSub, projectId, contractor, document.docId, parsedItems);
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

            logger.info("PDF extraction completed", {
              bucket,
              key,
              documentType,
              ingestedCount,
            });
          } catch (aiError) {
            logger.error("PDF extraction failed", {
              bucket,
              key,
              error: aiError instanceof Error ? aiError.message : String(aiError),
              isOpenAIError: aiError instanceof OpenAIExtractionError,
              code: aiError instanceof OpenAIExtractionError ? aiError.code : undefined,
            });

            await handleFailure({ s3: record.s3 } as S3Event["Records"][number], aiError as Error);
          }
        } catch (error) {
          logger.error("Failed to process PDF S3 record", {
            bucket,
            key,
            error: error instanceof Error ? error.message : String(error),
          });
          await handleFailure({ s3: record.s3 } as S3Event["Records"][number], error as Error);
        }
      }
    } catch (error) {
      logger.error("Failed to parse SQS message for PDF extraction", {
        messageId: sqsRecord.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

async function findDocumentByKeyWithRetry(
  ownerSub: string,
  projectId: string,
  key: string,
  attempts = 20,
  delayMs = 500
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const document = await findDocumentByKey(ownerSub, projectId, key);
    if (document) {
      return document;
    }
    if (attempt < attempts) {
      await delay(delayMs);
    }
  }
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    logger.error("Failed to record PDF parse failure", {
      bucket,
      key,
      error: innerError instanceof Error ? innerError.message : String(innerError),
    });
  }
}
