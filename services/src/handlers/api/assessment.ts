import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";

export async function getAssessment(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, {
    project: null,
    contractors: [],
    sections: [],
    lineItems: [],
    exceptions: [],
  });
}

export async function generateReport(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(202, { reportKey: "placeholder" });
}

export async function getReport(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { url: "https://example.com/report.pdf" });
}
