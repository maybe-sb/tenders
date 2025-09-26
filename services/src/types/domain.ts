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

export interface ResponseDocumentEntity {
  docId: string;
  projectId: string;
  type: "itt" | "response";
  contractorId?: string;
  contractorName?: string;
  source: "excel" | "pdf";
  s3KeyRaw: string;
  s3KeyExtracted?: string;
  parseStatus: "pending" | "parsing" | "parsed" | "error";
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
