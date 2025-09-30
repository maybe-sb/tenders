import type { MatchEntity } from "@/types/domain";

export interface IttItemResponse {
  ittItemId: string;
  sectionId: string;
  sectionName?: string;
  subSectionCode?: string;
  subSectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface ResponseItemResponse {
  responseItemId: string;
  contractorId: string;
  sectionGuess?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  amountLabel?: string;
}

export interface ExceptionResponse {
  responseItemId: string;
  contractorId: string;
  contractorName: string;
  description: string;
  attachedSectionId?: string;
  amount?: number;
  note?: string;
}

export interface MatchResponse {
  matchId: string;
  ittItemId: string;
  ittDescription?: string | null;
  ittSectionName?: string;
  contractorId: string;
  contractorName?: string;
  responseItemId: string;
  responseDescription?: string;
  responseItemCode?: string;
  responseAmount?: number;
  responseQty?: number;
  responseRate?: number;
  responseUnit?: string;
  status: MatchEntity["status"];
  confidence: number;
  comment?: string | null;
}

export interface AssessmentIttItem {
  ittItemId: string;
  sectionId: string;
  sectionName?: string;
  subSectionCode?: string;
  subSectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface AssessmentLineItem {
  ittItem: AssessmentIttItem;
  responses: Record<
    string,
    {
      responseItemId: string;
      contractorId: string;
      sectionGuess?: string;
      itemCode?: string;
      description: string;
      unit?: string;
      qty?: number;
      rate?: number;
      amount: number | null;
      amountLabel?: string;
      matchStatus: MatchEntity["status"];
    }
  >;
}

export interface ContractorSummary {
  contractorId: string;
  name: string;
  contact?: string;
  totalValue?: number;
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

export interface SectionAttachment {
  responseItemId: string;
  contractorId: string;
  contractorName: string;
  description: string;
  amount: number | null;
  amountLabel?: string;
  note?: string;
}

export interface AssessmentPayload {
  project: {
    projectId: string;
    name: string;
    status: string;
    currency: string;
    createdAt: string;
    updatedAt: string;
  };
  contractors: ContractorSummary[];
  sections: SectionSummary[];
  lineItems: AssessmentLineItem[];
  exceptions: Array<{
    responseItemId: string;
    contractorId: string;
    contractorName: string;
    description: string;
    attachedSectionId?: string;
    amount?: number;
    note?: string;
  }>;
  sectionAttachments: Record<string, SectionAttachment[]>;
}

export interface AssessmentInsightsResponse {
  insights: string;
  generatedAt: string;
  model: string;
  truncated: boolean;
}
