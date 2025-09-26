import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function jsonResponse(
  statusCode: number,
  body: Record<string, unknown> | unknown[] | string | null
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === null ? "" : JSON.stringify(body),
  };
}

export function errorResponse(statusCode: number, message: string) {
  return jsonResponse(statusCode, { message });
}
