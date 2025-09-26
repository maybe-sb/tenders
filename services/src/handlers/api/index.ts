import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
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

function normalisePath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  const stage = (event as any).requestContext?.stage as string | undefined;
  const rawPath = (event as any).rawPath ?? (event as APIGatewayProxyEvent).path ?? "/";
  let path = rawPath;

  if (stage && path.startsWith(`/${stage}`)) {
    path = path.slice(stage.length + 1) || "/";
  }

  path = path.replace(/^\/api\/v1/, "");
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  const method = (event as APIGatewayProxyEventV2).requestContext?.http?.method ?? (event as APIGatewayProxyEvent).httpMethod;
  return (method ?? "").toUpperCase();
}

async function main(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const method = resolveMethod(event);
  const path = normalisePath(event);

  if (!method) {
    return errorResponse(400, "Unsupported request");
  }

  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,PATCH,OPTIONS",
      },
      body: "",
    };
  }

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) {
      const params = match.groups ?? {};
      logger.info("Handling route", { method, path, params });
      return route.handler(event as APIGatewayProxyEventV2, params);
    }
  }

  logger.warn("Route not found", { method, path });
  return errorResponse(404, "Route not found");
}

export const handler = middy(main).use(httpErrorHandler());
