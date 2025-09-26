import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import middy from "@middy/core";
import httpJsonBodyParser from "@middy/http-json-body-parser";
import httpErrorHandler from "@middy/http-error-handler";

import { errorResponse } from "@/lib/response";
import { logger } from "@/lib/logger";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/handlers/api/projects";
import {
  confirmIttUpload,
  confirmResponseUpload,
  requestIttUpload,
  requestResponseUpload,
} from "@/handlers/api/uploads";
import { createManualMatch, listMatches, triggerAutoMatch, updateMatchStatus } from "@/handlers/api/match";
import { generateReport, getAssessment, getReport } from "@/handlers/api/assessment";

interface RouteConfig {
  method: string;
  pattern: RegExp;
  handler: (event: APIGatewayProxyEventV2, params: Record<string, string>) => Promise<APIGatewayProxyStructuredResultV2>;
}

const routes: RouteConfig[] = [
  { method: "GET", pattern: /^\/projects$/, handler: () => listProjects() },
  { method: "POST", pattern: /^\/projects$/, handler: () => createProject() },
  { method: "GET", pattern: /^\/projects\/(?<projectId>[\w-]+)$/, handler: () => getProject() },
  { method: "PATCH", pattern: /^\/projects\/(?<projectId>[\w-]+)$/, handler: () => updateProject() },
  { method: "DELETE", pattern: /^\/projects\/(?<projectId>[\w-]+)$/, handler: () => deleteProject() },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/itt\/upload-url$/,
    handler: () => requestIttUpload(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/itt\/confirm-upload$/,
    handler: () => confirmIttUpload(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/responses\/upload-url$/,
    handler: () => requestResponseUpload(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/responses\/confirm-upload$/,
    handler: () => confirmResponseUpload(),
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match$/,
    handler: () => listMatches(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/auto$/,
    handler: () => triggerAutoMatch(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/status$/,
    handler: () => updateMatchStatus(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/manual$/,
    handler: () => createManualMatch(),
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/assessment$/,
    handler: () => getAssessment(),
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/reports$/,
    handler: () => generateReport(),
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/reports\/(?<reportKey>.+)$/,
    handler: () => getReport(),
  },
];

async function main(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  const path = event.rawPath.replace(/^\/api\/v1/, "");

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) {
      const params = match.groups ?? {};
      logger.info("Handling route", { method, path, params });
      return route.handler(event, params);
    }
  }

  return errorResponse(404, "Route not found");
}

export const handler = middy(main).use(httpJsonBodyParser()).use(httpErrorHandler());
