import { listProjectSections, upsertProjectSection } from "@/lib/repository/sections";
import { deleteProjectIttItems, upsertProjectIttItem } from "@/lib/repository/itt-items";
import { deleteResponseItemsForContractor, upsertProjectResponseItem } from "@/lib/repository/response-items";
import type { SectionEntity } from "@/types/domain";

export interface ParsedIttItem {
  sectionCode?: string;
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

export interface ParsedResponseItem {
  sectionGuess?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  qty?: number;
  rate?: number;
  amount?: number;
}

function normaliseCode(code?: string): string {
  return (code ?? "").trim().toLowerCase();
}

export async function replaceIttItems(
  ownerSub: string,
  projectId: string,
  docId: string,
  items: ParsedIttItem[]
): Promise<number> {
  const existingSections = await listProjectSections(ownerSub, projectId);
  const sectionByCode = new Map<string, SectionEntity>();
  let maxOrder = existingSections.reduce((max, section) => Math.max(max, section.order), 0);

  for (const section of existingSections) {
    sectionByCode.set(normaliseCode(section.code), section);
  }

  async function ensureSection(code?: string, name?: string): Promise<SectionEntity> {
    const normalised = normaliseCode(code) || normaliseCode(name) || "default";
    if (sectionByCode.has(normalised)) {
      return sectionByCode.get(normalised)!;
    }

    const sectionName = name?.trim() || "Default Section";
    const sectionCode = code?.trim() || sectionName.replace(/\s+/g, "_").toUpperCase();
    const created = await upsertProjectSection(ownerSub, projectId, {
      code: sectionCode,
      name: sectionName,
      order: ++maxOrder,
    });
    sectionByCode.set(normalised, created);
    return created;
  }

  await deleteProjectIttItems(ownerSub, projectId);

  for (const item of items) {
    const section = await ensureSection(item.sectionCode, item.sectionName);
    await upsertProjectIttItem(ownerSub, projectId, {
      sectionId: section.sectionId,
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      amount: item.amount,
      meta: { docId },
    });
  }

  return items.length;
}

export async function replaceResponseItems(
  ownerSub: string,
  projectId: string,
  contractorId: string,
  docId: string,
  items: ParsedResponseItem[]
): Promise<number> {
  await deleteResponseItemsForContractor(ownerSub, contractorId);

  for (const item of items) {
    await upsertProjectResponseItem(ownerSub, {
      projectId,
      contractorId,
      sectionGuess: item.sectionGuess,
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      amount: item.amount,
      meta: { docId },
    });
  }

  return items.length;
}
