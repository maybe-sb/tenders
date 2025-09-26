import type { SQSEvent } from "aws-lambda";

import { logger } from "@/lib/logger";

export async function handler(event: SQSEvent) {
  logger.info("match-engine invoked", { records: event.Records.length });
  // TODO: Implement normalization and matching logic.
}
