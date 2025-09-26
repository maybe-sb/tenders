import type { S3Event } from "aws-lambda";

import { logger } from "@/lib/logger";

export async function handler(event: S3Event) {
  logger.info("extract-excel invoked", { records: event.Records.length });
  // TODO: Implement Excel parsing and DynamoDB persistence.
}
