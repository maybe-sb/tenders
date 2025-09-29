import { z } from "zod";

import { jsonResponse } from "@/lib/response";
import { listProjectDocuments } from "@/lib/repository/documents";
import { listProjectContractors } from "@/lib/repository/contractors";
import { listParseJobs } from "@/lib/repository/parse-jobs";
import { listProjectIttItems as fetchProjectIttItems } from "@/lib/repository/itt-items";
import { listProjectResponseItems as fetchProjectResponseItems } from "@/lib/repository/response-items";
import { listProjectExceptions as fetchProjectExceptions } from "@/lib/repository/exceptions";
import { listProjectMatches as fetchProjectMatches } from "@/lib/repository/matches";
import { listProjectSections } from "@/lib/repository/sections";
import { toContractorSummary, toDocumentSummary, toParseJobSummary, toIttItemResponse, toResponseItemResponse, toExceptionResponse } from "@/lib/mappers";
import type { ProjectDetail } from "@/types/domain";
import type { ExceptionResponse, IttItemResponse, ResponseItemResponse } from "@/types/api";
import { getJsonBody, getOwnerSub, ApiEvent, getPathParam, getQueryParam } from "@/lib/api-utils";
import {
  createProjectItem,
  getProjectItem,
  listProjectsForOwner,
  mapToProjectDetail,
  softDeleteProject,
  updateProjectItem,
} from "@/lib/repository/projects";

async function loadProjectDetail(ownerSub: string, projectId: string): Promise<ProjectDetail | null> {

  const projectItem = await getProjectItem(ownerSub, projectId);

  if (!projectItem) {

    return null;

  }



  const [documents, contractors, jobs, sections] = await Promise.all([

    listProjectDocuments(ownerSub, projectId),

    listProjectContractors(ownerSub, projectId),

    listParseJobs(ownerSub, projectId),

    listProjectSections(ownerSub, projectId),

  ]);



  return mapToProjectDetail(projectItem, {

    documents: documents.map(toDocumentSummary),

    contractors: contractors.map(toContractorSummary),

    pendingJobs: jobs.map(toParseJobSummary),

    sections,

  });

}



const CREATE_PROJECT_SCHEMA = z.object({

  name: z.string().min(1).max(200),

});



const UPDATE_PROJECT_SCHEMA = z.object({

  name: z.string().min(1).max(200).optional(),

  status: z.enum(["draft", "in_review", "finalized"]).optional(),

});



export async function listProjects(event: ApiEvent, _params?: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projects = await listProjectsForOwner(ownerSub);

  return jsonResponse(200, projects);

}



export async function createProject(event: ApiEvent, _params?: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const payload = CREATE_PROJECT_SCHEMA.parse(getJsonBody(event));

  const project = await createProjectItem(ownerSub, {

    name: payload.name.trim(),

  });

  return jsonResponse(201, project);

}



export async function getProject(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");



  const detail = await loadProjectDetail(ownerSub, projectId);

  if (!detail) {

    return jsonResponse(404, { message: "Project not found" });

  }



  return jsonResponse(200, detail);

}



export async function getProjectDetail(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");



  const detail = await loadProjectDetail(ownerSub, projectId);

  if (!detail) {

    return jsonResponse(404, { message: "Project not found" });

  }



  return jsonResponse(200, detail);

}



export async function listProjectIttItems(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");



  const project = await getProjectItem(ownerSub, projectId);

  if (!project) {

    return jsonResponse(404, { message: "Project not found" });

  }



  const items = await fetchProjectIttItems(ownerSub, projectId);

  const payload: IttItemResponse[] = items.map(toIttItemResponse);

  return jsonResponse(200, payload);

}



export async function listProjectResponseItems(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");



  const project = await getProjectItem(ownerSub, projectId);

  if (!project) {

    return jsonResponse(404, { message: "Project not found" });

  }



  const unmatchedOnlyValue = getQueryParam(event, "unmatchedOnly");
  const unmatchedOnly =
    typeof unmatchedOnlyValue === "string" &&
    ["true", "1", "yes"].includes(unmatchedOnlyValue.toLowerCase());

  const contractorParam = getQueryParam(event, "contractor");
  const contractorFilter = contractorParam && contractorParam !== "all" ? contractorParam : undefined;

  let responseItems = await fetchProjectResponseItems(ownerSub, projectId);

  if (contractorFilter) {
    responseItems = responseItems.filter((item) => item.contractorId === contractorFilter);
  }

  if (unmatchedOnly) {
    const matches = await fetchProjectMatches(ownerSub, projectId, { status: "all" });

    const matchedSet = new Set(
      matches
        .filter((match) => match.status === "accepted" || match.status === "manual")
        .filter((match) => !contractorFilter || match.contractorId === contractorFilter)
        .map((match) => match.responseItemId)
    );

    responseItems = responseItems.filter((item) => !matchedSet.has(item.responseItemId));
  }

  const payload: ResponseItemResponse[] = responseItems.map(toResponseItemResponse);

  return jsonResponse(200, payload);

}



export async function listProjectExceptions(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");



  const project = await getProjectItem(ownerSub, projectId);

  if (!project) {

    return jsonResponse(404, { message: "Project not found" });

  }



  const contractorParam = getQueryParam(event, "contractor");
  const contractorFilter = contractorParam && contractorParam !== "all" ? contractorParam : undefined;

  const [exceptions, responseItems, contractors] = await Promise.all([

    fetchProjectExceptions(ownerSub, projectId),

    fetchProjectResponseItems(ownerSub, projectId),

    listProjectContractors(ownerSub, projectId),

  ]);



  const filteredExceptions = contractorFilter
    ? exceptions.filter((exception) => exception.contractorId === contractorFilter)
    : exceptions;

  const responseItemMap = new Map(

    responseItems.map((item) => [item.responseItemId, item])

  );



  const contractorNameMap = new Map(

    contractors.map((contractor) => [contractor.contractorId, contractor.name])

  );



  const payload: ExceptionResponse[] = filteredExceptions.map((exception) =>

    toExceptionResponse(exception, {

      responseItem: responseItemMap.get(exception.responseItemId),

      contractorName: contractorNameMap.get(exception.contractorId),

    })

  );



  return jsonResponse(200, payload);

}



export async function updateProject(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");

  const payload = UPDATE_PROJECT_SCHEMA.parse(getJsonBody(event));



  try {

    const project = await updateProjectItem(ownerSub, projectId, payload);

    return jsonResponse(200, project);

  } catch (error) {

    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {

      return jsonResponse(404, { message: "Project not found" });

    }

    throw error;

  }

}



export async function deleteProject(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");



  try {

    await softDeleteProject(ownerSub, projectId);

  } catch (error) {

    return jsonResponse(404, { message: "Project not found" });

  }



  return jsonResponse(204, null);

}

