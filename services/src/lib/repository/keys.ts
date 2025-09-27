export const PROJECT_META_SK = "META";

export function projectPk(projectId: string): string {
  return `PROJECT#${projectId}`;
}

export function documentSk(uploadedAt: string, docId: string): string {
  return `DOC#${uploadedAt}#${docId}`;
}

export function contractorSk(contractorId: string): string {
  return `CONTRACTOR#${contractorId}`;
}

export function responseItemSk(responseItemId: string): string {
  return `RESPITEM#${responseItemId}`;
}

export function jobSk(jobCreatedAt: string, jobId: string): string {
  return `JOB#${jobCreatedAt}#${jobId}`;
}

export function sectionSk(sectionId: string): string {
  return `SECTION#${sectionId}`;
}

export function ittItemSk(ittItemId: string): string {
  return `ITTITEM#${ittItemId}`;
}

export function matchSk(matchId: string): string {
  return `MATCH#${matchId}`;
}

export function exceptionSk(exceptionId: string): string {
  return `EXCEPTION#${exceptionId}`;
}

export function ownerGsiPk(ownerSub: string): string {
  return `OWNER#${ownerSub}`;
}

export function ownerGsiSk(updatedAt: string, projectId: string): string {
  return `PROJECT#${updatedAt}#${projectId}`;
}

export function contractorGsiPk(contractorId: string): string {
  return `CONTRACTOR#${contractorId}`;
}

export function contractorGsiSk(entityId: string): string {
  return entityId;
}

export function matchStatusGsiPk(projectId: string, status: string): string {
  return `MATCH#${projectId}#${status.toUpperCase()}`;
}

export function matchStatusGsiSk(updatedAt: string, matchId: string): string {
  return `${updatedAt}#${matchId}`;
}

export function projectExceptionGsiPk(projectId: string): string {
  return `EXCEPTION#${projectId}`;
}

export function projectExceptionGsiSk(createdAt: string, exceptionId: string): string {
  return `${createdAt}#${exceptionId}`;
}
