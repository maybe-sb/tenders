import type { SQSEvent } from "aws-lambda";

import { logger } from "@/lib/logger";

export async function handler(event: SQSEvent) {
  logger.info("generate-report invoked", { records: event.Records.length });
  // TODO: Render HTML and create PDF using headless Chromium.
}
