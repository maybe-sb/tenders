import {
  ContractorEntity,
  ContractorSummary,
  DocumentEntity,
  DocumentSummary,
  ExceptionEntity,
  ITTItemEntity,
  ParseJobEntity,
  ParseJobStatusRecord,
  ResponseItemEntity,
} from "@/types/domain";
import { ExceptionResponse, IttItemResponse, ResponseItemResponse } from "@/types/api";

export function toDocumentSummary(document: DocumentEntity): DocumentSummary {
  const fallbackName = document.type === "itt" ? "ITT Bill of Quantities" : "Tender Response";
  return {
    docId: document.docId,
    type: document.type,
    name: document.fileName ?? document.contractorName ?? fallbackName,
    contractorId: document.contractorId,
    contractorName: document.contractorName,
    source: document.source,
    uploadedAt: document.createdAt,
    parseStatus: document.parseStatus,
    stats: document.stats,
  };
}

export function toContractorSummary(contractor: ContractorEntity): ContractorSummary {
  return {
    contractorId: contractor.contractorId,
    name: contractor.name,
    contact: contractor.contact,
  };
}

export function toParseJobSummary(job: ParseJobEntity): ParseJobStatusRecord {
  return {
    jobId: job.jobId,
    documentId: job.documentId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function toIttItemResponse(item: ITTItemEntity): IttItemResponse {
  return {
    ittItemId: item.ittItemId,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
    subSectionCode: item.subSectionCode,
    subSectionName: item.subSectionName,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    qty: item.qty,
    rate: item.rate,
    amount: item.amount,
  };
}

export function toResponseItemResponse(item: ResponseItemEntity): ResponseItemResponse {
  return {
    responseItemId: item.responseItemId,
    contractorId: item.contractorId,
    sectionGuess: item.sectionGuess,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    qty: item.qty,
    rate: item.rate,
    amount: item.amount,
    amountLabel: item.amountLabel,
  };
}

export function toExceptionResponse(
  exception: ExceptionEntity,
  options: { responseItem?: ResponseItemEntity; contractorName?: string }
): ExceptionResponse {
  const description = options.responseItem?.description ?? "Response item";
  return {
    responseItemId: exception.responseItemId,
    contractorId: exception.contractorId,
    contractorName: options.contractorName ?? "Unknown contractor",
    description,
    attachedSectionId: exception.sectionId,
    amount: exception.amount,
    note: exception.note,
  };
}
