export type ProjectStatus = "draft" | "in_review" | "finalized";
export type DocumentType = "itt" | "response";

export interface TenderProject {
  projectId: string;
  name: string;
  status: ProjectStatus;
  currency: string;
  createdAt: string;
  updatedAt: string;
  stats?: ProjectStats;
}

export interface ProjectDetail extends TenderProject {
  documents: DocumentSummary[];
  sections: SectionSummary[];
  contractors: ContractorSummary[];
  pendingJobs: ParseJobStatus[];
}

export interface DocumentSummary {
  docId: string;
  type: DocumentType;
  name: string;
  contractorId?: string;
  contractorName?: string;
  source: "excel" | "pdf";
  uploadedAt: string;
  parseStatus: "pending" | "parsing" | "parsed" | "error";
  stats?: {
    lineItems: number;
    matched: number;
  };
}

export interface ParseJobStatus {
  jobId: string;
  documentId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

export interface ProjectStats {
  contractors: number;
  sections: number;
  ittItems: number;
  matchedItems: number;
  unmatchedItems: number;
}

export interface SectionSummary {
  sectionId: string;
  code: string;
  name: string;
  order: number;
  totalsByContractor: Record<string, number>;
  totalITTAmount: number;
  exceptionCount: number;
}

export interface ITTItem {
  ittItemId: string;
  sectionId: string;
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface ResponseDocument {
  docId: string;
  contractorId: string;
  contractorName: string;
  source: "excel" | "pdf";
  uploadedAt: string;
  parseStatus: "pending" | "parsing" | "parsed" | "error";
}

export interface ResponseItem {
  responseItemId: string;
  contractorId: string;
  sectionGuess?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  qty?: number;
  rate?: number;
  amount?: number;
}

export type MatchStatus = "suggested" | "accepted" | "rejected" | "manual";

export interface MatchRecord {
  matchId: string;
  ittItemId: string;
  contractorId: string;
  responseItemId: string;
  status: MatchStatus;
  confidence: number;
  comment?: string;
}

export interface ExceptionRecord {
  responseItemId: string;
  contractorId: string;
  contractorName: string;
  description: string;
  attachedSectionId?: string;
  amount?: number;
  note?: string;
}

export interface AssessmentLineItem {
  ittItem: ITTItem;
  responses: Record<string, ResponseItem & { matchStatus: MatchStatus; amount: number | null }>;
}

export interface AssessmentPayload {
  project: TenderProject;
  contractors: ContractorSummary[];
  sections: SectionSummary[];
  lineItems: AssessmentLineItem[];
  exceptions: ExceptionRecord[];
}

export interface ContractorSummary {
  contractorId: string;
  name: string;
  contact?: string;
  totalValue?: number;
}

export interface PresignedUpload {
  uploadUrl: string;
  fields?: Record<string, string>;
  key: string;
  expiresAt: string;
}

export interface UploadResponse {
  document: DocumentSummary;
  parseJobId: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface MatchSuggestion {
  matchId: string;
  ittItemId: string;
  ittDescription: string;
  responseItemId: string;
  responseDescription?: string;
  responseItemCode?: string;
  responseAmount?: number;
  contractorName: string;
  confidence: number;
  status: MatchStatus;
}
