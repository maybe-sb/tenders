import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import { z } from "zod";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";
import { getJsonBody, getOwnerSub, ApiEvent, getPathParam } from "@/lib/api-utils";
import { getProjectItem } from "@/lib/repository/projects";
import { createPresignedUploadPost } from "@/lib/s3";
import { getEnv } from "@/lib/env";
import { createDocument } from "@/lib/repository/documents";
import { ensureContractor, getContractor } from "@/lib/repository/contractors";
import { createParseJob } from "@/lib/repository/parse-jobs";
import { toDocumentSummary } from "@/lib/mappers";

const { UPLOADS_BUCKET } = getEnv();

const ITT_EXTENSIONS = new Set([".xlsx", ".xls"]);
const RESPONSE_EXTENSIONS = new Set([".xlsx", ".xls", ".pdf"]);

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pdf": "application/pdf",
};

const REQUEST_ITT_UPLOAD_SCHEMA = z.object({
  fileName: z.string().min(1),
});

const REQUEST_RESPONSE_UPLOAD_SCHEMA = z.object({
  contractorName: z.string().min(1),
  fileName: z.string().min(1),
});

const CONFIRM_ITT_UPLOAD_SCHEMA = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1),
});

const CONFIRM_RESPONSE_UPLOAD_SCHEMA = z.object({
  key: z.string().min(1),
  contractorId: z.string().min(1),
  fileName: z.string().min(1),
  contractorName: z.string().optional(),
});

export async function requestIttUpload(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = REQUEST_ITT_UPLOAD_SCHEMA.parse(getJsonBody(event));
  const extension = extractExtension(payload.fileName);

  if (!ITT_EXTENSIONS.has(extension)) {
    return jsonResponse(400, { message: "Unsupported ITT file type" });
  }

  const key = buildIttKey(projectId, extension);

  const upload = await createPresignedUploadPost({
    bucket: UPLOADS_BUCKET,
    key,
    fields: {
      "Content-Type": resolveContentType(extension),
      "x-amz-meta-project-id": projectId,
      "x-amz-meta-document-type": "itt",
      "x-amz-meta-source": "excel",
      "x-amz-meta-owner-sub": ownerSub,
    },
  });

  return jsonResponse(200, { upload });
}

export async function confirmIttUpload(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = CONFIRM_ITT_UPLOAD_SCHEMA.parse(getJsonBody(event));
  const extension = extractExtension(payload.fileName) || extractExtension(payload.key);

  if (!payload.key.startsWith(`projects/${projectId}/itt/`)) {
    return jsonResponse(400, { message: "Key does not belong to project" });
  }

  if (!ITT_EXTENSIONS.has(extension)) {
    return jsonResponse(400, { message: "Unsupported ITT file type" });
  }

  const document = await createDocument(ownerSub, projectId, {
    type: "itt",
    source: "excel",
    s3KeyRaw: payload.key,
    fileName: payload.fileName,
  });

  const job = await createParseJob(ownerSub, projectId, document.docId);

  return jsonResponse(202, {
    document: toDocumentSummary(document),
    parseJobId: job.jobId,
  });
}

export async function requestResponseUpload(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = REQUEST_RESPONSE_UPLOAD_SCHEMA.parse(getJsonBody(event));
  const extension = extractExtension(payload.fileName);

  if (!RESPONSE_EXTENSIONS.has(extension)) {
    return jsonResponse(400, { message: "Unsupported response file type" });
  }

  const contractor = await ensureContractor(ownerSub, projectId, {
    name: payload.contractorName.trim(),
  });

  const source = extension === ".pdf" ? "pdf" : "excel";
  const key = buildResponseKey(projectId, contractor.contractorId, extension);

  const upload = await createPresignedUploadPost({
    bucket: UPLOADS_BUCKET,
    key,
    fields: {
      "Content-Type": resolveContentType(extension),
      contractorId: contractor.contractorId,
      "x-amz-meta-project-id": projectId,
      "x-amz-meta-document-type": "response",
      "x-amz-meta-contractor-id": contractor.contractorId,
      "x-amz-meta-contractor-name": contractor.name,
      "x-amz-meta-source": source,
      "x-amz-meta-owner-sub": ownerSub,
    },
  });

  return jsonResponse(200, {
    upload,
    contractor: {
      contractorId: contractor.contractorId,
      name: contractor.name,
    },
  });
}

export async function confirmResponseUpload(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  const payload = CONFIRM_RESPONSE_UPLOAD_SCHEMA.parse(getJsonBody(event));
  const extension = extractExtension(payload.fileName) || extractExtension(payload.key);

  if (!payload.key.startsWith(`projects/${projectId}/responses/${payload.contractorId}/`)) {
    return jsonResponse(400, { message: "Key does not belong to contractor/project" });
  }

  if (!RESPONSE_EXTENSIONS.has(extension)) {
    return jsonResponse(400, { message: "Unsupported response file type" });
  }

  let contractor = await getContractor(ownerSub, projectId, payload.contractorId);
  if (!contractor && payload.contractorName) {
    contractor = await ensureContractor(ownerSub, projectId, {
      contractorId: payload.contractorId,
      name: payload.contractorName.trim(),
    });
  }

  if (!contractor) {
    return jsonResponse(400, { message: "Contractor not found" });
  }

  const document = await createDocument(ownerSub, projectId, {
    type: "response",
    source: extension === ".pdf" ? "pdf" : "excel",
    s3KeyRaw: payload.key,
    fileName: payload.fileName,
    contractorId: contractor.contractorId,
    contractorName: contractor.name,
  });

  const job = await createParseJob(ownerSub, projectId, document.docId);

  return jsonResponse(202, {
    document: toDocumentSummary(document),
    parseJobId: job.jobId,
  });
}

function extractExtension(fileName: string): string {
  if (!fileName) {
    return "";
  }
  return path.extname(fileName).toLowerCase();
}

function resolveContentType(extension: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function buildIttKey(projectId: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `projects/${projectId}/itt/${timestamp}/raw${extension}`;
}

function buildResponseKey(projectId: string, contractorId: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `projects/${projectId}/responses/${contractorId}/${timestamp}/raw${extension}`;
}
