export type ProjectStatus = "draft" | "in_review" | "finalized";

export interface ProjectEntity {
  projectId: string;
  name: string;
  status: ProjectStatus;
  currency: string;
  createdAt: string;
  updatedAt: string;
  ownerSub: string;
}

export interface ProjectStats {
  contractors: number;
  sections: number;
  ittItems: number;
  matchedItems: number;
  unmatchedItems: number;
}

export interface TenderProject {
  projectId: string;
  name: string;
  status: ProjectStatus;
  currency: string;
  createdAt: string;
  updatedAt: string;
  stats: ProjectStats;
}

export interface SectionEntity {
  sectionId: string;
  projectId: string;
  code: string;
  name: string;
  order: number;
}

export interface ITTItemEntity {
  ittItemId: string;
  projectId: string;
  sectionId: string;
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  meta?: Record<string, unknown>;
}

export type DocumentSource = "excel" | "pdf";
export type DocumentParseStatus = "pending" | "parsing" | "parsed" | "error";

export interface DocumentStats {
  lineItems: number;
  matched: number;
}

export interface DocumentEntity {
  docId: string;
  projectId: string;
  type: "itt" | "response";
  contractorId?: string;
  contractorName?: string;
  source: DocumentSource;
  fileName?: string;
  s3KeyRaw: string;
  s3KeyExtracted?: string;
  parseStatus: DocumentParseStatus;
  createdAt: string;
  updatedAt: string;
  stats?: DocumentStats;
}

export interface ContractorEntity {
  contractorId: string;
  projectId: string;
  name: string;
  contact?: string;
  createdAt: string;
  updatedAt: string;
}

export type ParseJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface ParseJobEntity {
  jobId: string;
  projectId: string;
  documentId: string;
  status: ParseJobStatus;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResponseItemEntity {
  responseItemId: string;
  projectId: string;
  contractorId: string;
  sectionGuess?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  meta?: Record<string, unknown>;
}

export interface MatchEntity {
  matchId: string;
  projectId: string;
  ittItemId: string;
  contractorId: string;
  responseItemId: string;
  status: "suggested" | "accepted" | "rejected" | "manual";
  confidence: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExceptionEntity {
  exceptionId: string;
  projectId: string;
  responseItemId: string;
  contractorId: string;
  sectionId?: string;
  note?: string;
  amount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  docId: string;
  type: "itt" | "response";
  name: string;
  contractorId?: string;
  contractorName?: string;
  source: DocumentSource;
  uploadedAt: string;
  parseStatus: DocumentParseStatus;
  stats?: DocumentStats;
}

export interface ContractorSummary {
  contractorId: string;
  name: string;
  contact?: string;
  totalValue?: number;
}

export interface ParseJobStatusRecord {
  jobId: string;
  documentId: string;
  status: ParseJobStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectDetail extends TenderProject {
  documents: DocumentSummary[];
  sections: SectionEntity[];
  contractors: ContractorSummary[];
  pendingJobs: ParseJobStatusRecord[];
}
