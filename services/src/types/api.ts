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
  contractorId: string;
  contractorName?: string;
  responseItemId: string;
  responseDescription?: string;
  responseItemCode?: string;
  responseAmount?: number;
  status: MatchEntity["status"];
  confidence: number;
  comment?: string | null;
}
