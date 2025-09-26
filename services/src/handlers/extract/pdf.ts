import type { S3Event } from "aws-lambda";

import { logger } from "@/lib/logger";

export async function handler(event: S3Event) {
  logger.info("extract-pdf invoked", { records: event.Records.length });
  // TODO: Call Textract to extract tabular data and persist.
}
