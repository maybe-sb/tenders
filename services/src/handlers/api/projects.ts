import { z } from "zod";

import { jsonResponse } from "@/lib/response";
import { listProjectDocuments } from "@/lib/repository/documents";
import { listProjectContractors } from "@/lib/repository/contractors";
import { listParseJobs } from "@/lib/repository/parse-jobs";
import { listProjectIttItems as fetchProjectIttItems } from "@/lib/repository/itt-items";
import {
  getProjectResponseItem,
  listProjectResponseItems as fetchProjectResponseItems,
} from "@/lib/repository/response-items";
import {
  findProjectExceptionByResponseItem,
  listProjectExceptions as fetchProjectExceptions,
  upsertProjectException,
} from "@/lib/repository/exceptions";
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

const ATTACH_EXCEPTION_SCHEMA = z.object({
  responseItemId: z.string().min(1),
  sectionId: z.string().min(1).optional(),
  note: z.string().max(2000).optional().nullable(),
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

    const exceptions = await fetchProjectExceptions(ownerSub, projectId);
    const sectionAssignedSet = new Set(
      exceptions
        .filter((exception) => !contractorFilter || exception.contractorId === contractorFilter)
        .map((exception) => exception.responseItemId)
    );

    responseItems = responseItems.filter((item) => !sectionAssignedSet.has(item.responseItemId));
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



  // Only show exceptions that are truly unassigned (no sectionId)
  // Exceptions WITH sectionId are already assigned to a section via drag-and-drop
  const filteredExceptions = exceptions
    .filter((exception) => !exception.sectionId)  // Only unassigned
    .filter((exception) => !contractorFilter || exception.contractorId === contractorFilter);

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


export async function attachProjectException(event: ApiEvent, params: Record<string, string>) {

  const ownerSub = getOwnerSub(event);

  const projectId = getPathParam(params, "projectId");


  const project = await getProjectItem(ownerSub, projectId);

  if (!project) {

    return jsonResponse(404, { message: "Project not found" });

  }


  const payload = ATTACH_EXCEPTION_SCHEMA.parse(getJsonBody(event));


  const responseItem = await getProjectResponseItem(ownerSub, projectId, payload.responseItemId);

  if (!responseItem) {

    return jsonResponse(404, { message: "Response item not found" });

  }


  const existingException = await findProjectExceptionByResponseItem(ownerSub, payload.responseItemId);


  await upsertProjectException(ownerSub, {

    exceptionId: existingException?.exceptionId,

    projectId,

    responseItemId: responseItem.responseItemId,

    contractorId: responseItem.contractorId,

    sectionId: payload.sectionId ?? undefined,

    note: payload.note ?? undefined,

    amount: typeof responseItem.amount === "number" ? responseItem.amount : undefined,

  });


  return jsonResponse(204, null);

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
