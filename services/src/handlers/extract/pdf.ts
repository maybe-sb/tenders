import type { SQSEvent, S3Event } from "aws-lambda";

import { logger } from "@/lib/logger";

export async function handler(event: SQSEvent) {
  for (const sqsRecord of event.Records) {
    try {
      // Parse S3 event from SQS message body
      const s3Event: S3Event = JSON.parse(sqsRecord.body);

      logger.info("extract-pdf invoked", { records: s3Event.Records.length });

      // Process each S3 record within the S3 event
      for (const record of s3Event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        logger.info("Processing PDF", { bucket, key });
        // TODO: Call Textract to extract tabular data and persist.
      }
    } catch (error) {
      logger.error("Failed to parse SQS message", {
        messageId: sqsRecord.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
