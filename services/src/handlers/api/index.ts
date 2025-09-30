import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { ZodError } from "zod";

import { errorResponse, jsonResponse } from "@/lib/response";
import { logger } from "@/lib/logger";
import type { ApiEvent } from "@/lib/api-utils";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectDetail,
  listProjectExceptions,
  listProjectIttItems,
  listProjectResponseItems,
  listProjects,
  updateProject,
  attachProjectException,
} from "@/handlers/api/projects";
import {
  confirmIttUpload,
  confirmResponseUpload,
  requestIttUpload,
  requestResponseUpload,
} from "@/handlers/api/uploads";
import { bulkAcceptMatches, createManualMatch, listMatches, triggerAutoMatch, updateMatchStatus } from "@/handlers/api/match";
import { generateReport, getAssessment, getReport } from "@/handlers/api/assessment";

interface RouteConfig {
  method: string;
  pattern: RegExp;
  handler: (event: ApiEvent, params: Record<string, string>) => Promise<APIGatewayProxyStructuredResultV2>;
}

const routes: RouteConfig[] = [
  { method: "GET", pattern: /^\/projects\/(?<projectId>[\w-]+)\/exceptions$/, handler: listProjectExceptions },
  { method: "POST", pattern: /^\/projects\/(?<projectId>[\w-]+)\/exceptions$/, handler: attachProjectException },
  { method: "GET", pattern: /^\/projects\/(?<projectId>[\w-]+)\/responses\/items$/, handler: listProjectResponseItems },
  { method: "GET", pattern: /^\/projects\/(?<projectId>[\w-]+)\/itt\/items$/, handler: listProjectIttItems },
  { method: "GET", pattern: /^\/projects\/(?<projectId>[\w-]+)\/detail$/, handler: getProjectDetail },
  { method: "GET", pattern: /^\/projects$/, handler: listProjects },
  { method: "POST", pattern: /^\/projects$/, handler: createProject },
  { method: "GET", pattern: /^\/projects\/(?<projectId>[\w-]+)$/, handler: getProject },
  { method: "PATCH", pattern: /^\/projects\/(?<projectId>[\w-]+)$/, handler: updateProject },
  { method: "DELETE", pattern: /^\/projects\/(?<projectId>[\w-]+)$/, handler: deleteProject },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/itt\/upload-url$/,
    handler: requestIttUpload,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/itt\/confirm-upload$/,
    handler: confirmIttUpload,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/responses\/upload-url$/,
    handler: requestResponseUpload,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/responses\/confirm-upload$/,
    handler: confirmResponseUpload,
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match$/,
    handler: listMatches,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/auto$/,
    handler: triggerAutoMatch,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/status$/,
    handler: updateMatchStatus,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/manual$/,
    handler: createManualMatch,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/match\/bulk-accept$/,
    handler: bulkAcceptMatches,
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/assessment$/,
    handler: getAssessment,
  },
  {
    method: "POST",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/reports$/,
    handler: generateReport,
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<projectId>[\w-]+)\/reports\/(?<reportKey>.+)$/,
    handler: getReport,
  },
];

function normalisePath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  const stage = (event as any).requestContext?.stage as string | undefined;
  const rawPath = (event as any).rawPath ?? (event as APIGatewayProxyEvent).path ?? "/";
  let path = rawPath;

  if (stage && path.startsWith(`/${stage}`)) {
    path = path.slice(stage.length + 1) || "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function resolveMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string | undefined {
  return (
    (event as APIGatewayProxyEventV2).requestContext?.http?.method ??
    (event as APIGatewayProxyEvent).httpMethod
  );
}

export async function handler(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const method = resolveMethod(event)?.toUpperCase();
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
        return await route.handler(event as ApiEvent, params);
      }
    }

    logger.warn("Route not found", { method, path });
    return errorResponse(404, "Route not found");
  } catch (error) {
    logger.error("Unhandled API error", {
      message: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof ZodError) {
      return jsonResponse(400, {
        message: "Invalid request payload",
        issues: error.issues,
      });
    }

    if (error instanceof Error && error.message === "INVALID_JSON_BODY") {
      return errorResponse(400, "Invalid JSON body");
    }

    return errorResponse(500, "Internal server error");
  }
}
