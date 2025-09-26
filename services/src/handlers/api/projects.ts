import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";

export async function listProjects(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, []);
}

export async function createProject(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(201, { message: "createProject not implemented" });
}

export async function getProject(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { message: "getProject not implemented" });
}

export async function updateProject(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { message: "updateProject not implemented" });
}

export async function deleteProject(): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(204, null);
}
