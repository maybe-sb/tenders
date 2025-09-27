import type { ApiEvent } from "@/lib/api-utils";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";

export async function getAssessment(_event: ApiEvent, _params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, {
    project: null,
    contractors: [],
    sections: [],
    lineItems: [],
    exceptions: [],
  });
}

export async function generateReport(_event: ApiEvent, _params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(202, { reportKey: "placeholder" });
}

export async function getReport(_event: ApiEvent, _params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { url: "https://example.com/report.pdf" });
}
