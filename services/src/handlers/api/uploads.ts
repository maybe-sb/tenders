import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";

export async function requestIttUpload(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { upload: { uploadUrl: "https://example.com", key: "placeholder" } });
}

export async function confirmIttUpload(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(202, { message: "ITT upload confirmation not implemented" });
}

export async function requestResponseUpload(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { upload: { uploadUrl: "https://example.com", key: "placeholder" } });
}

export async function confirmResponseUpload(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(202, { message: "Response upload confirmation not implemented" });
}
