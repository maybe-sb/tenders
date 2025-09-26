import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,PATCH,OPTIONS",
};

export function jsonResponse(
  statusCode: number,
  body: Record<string, unknown> | unknown[] | string | null
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
    body: body === null ? "" : JSON.stringify(body),
  };
}

export function errorResponse(statusCode: number, message: string) {
  return jsonResponse(statusCode, { message });
}
