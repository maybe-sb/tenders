import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";

export async function listMatches(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, []);
}

export async function triggerAutoMatch(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(202, { enqueued: true });
}

export async function updateMatchStatus(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { message: "updateMatchStatus not implemented" });
}

export async function createManualMatch(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(201, { message: "createManualMatch not implemented" });
}
