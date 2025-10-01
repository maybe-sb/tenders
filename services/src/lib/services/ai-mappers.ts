import type { OpenAIExcelResponse, OpenAIResponseItem } from "@/types/openai";
import type { ParsedIttItem, ParsedResponseItem } from "@/lib/services/project-items";

// Map AI response to ITT items
export function mapAIResponseToIttItems(response: OpenAIExcelResponse): ParsedIttItem[] {
  const items: ParsedIttItem[] = [];
  const sections = response.sections || [];

  // Helper to extract top-level section code (before first dot)
  const extractTopLevelSection = (code: string) => code.split(".")[0];

  const sectionMap = new Map<string, { code: string; name: string }>();
  sections.forEach((section) => {
    sectionMap.set(section.code.toLowerCase(), section);
  });

  type HierarchyState = {
    sectionCode: string;
    sectionName: string;
    subSectionCode: string;
    subSectionName: string;
  };

  const state: HierarchyState = {
    sectionCode: "",
    sectionName: "",
    subSectionCode: "",
    subSectionName: "",
  };

  const sortedItems = [...response.items].sort((a, b) => {
    const codeA = a.itemCode ?? "";
    const codeB = b.itemCode ?? "";
    if (codeA && codeB) {
      return codeA.localeCompare(codeB, undefined, { numeric: true });
    }
    return codeA.localeCompare(codeB);
  });

  const parseHierarchyFromGuess = (guess?: string) => {
    if (!guess) return {};
    const parts = guess.split(">").map((part) => part.trim()).filter(Boolean);

    const extract = (segment: string) => {
      const tokens = segment.split(" ").filter(Boolean);
      if (!tokens.length) return { code: "", name: "" };
      const maybeCode = tokens[0];
      if (/^[\d.]+$/.test(maybeCode)) {
        return { code: maybeCode, name: tokens.slice(1).join(" ") || segment };
      }
      return { code: "", name: segment };
    };

    const section = parts.length ? extract(parts[0]) : { code: "", name: "" };
    const subSection = parts.length > 1 ? extract(parts[1]) : { code: "", name: "" };

    return {
      sectionCode: section.code,
      sectionName: section.name,
      subSectionCode: subSection.code,
      subSectionName: subSection.name,
    };
  };

  sortedItems.forEach((aiItem, index) => {
    const itemCode = aiItem.itemCode?.trim();
    const description = (aiItem.description ?? "").trim();
    const levels = itemCode ? itemCode.split(".") : [];
    const level = levels.length;

    const { sectionCode: guessSectionCode, sectionName: guessSectionName, subSectionCode: guessSubCode, subSectionName: guessSubName } =
      parseHierarchyFromGuess(aiItem.sectionGuess);

    if (level === 1 && !hasQuantities(aiItem)) {
      state.sectionCode = levels[0];
      const sectionKey = levels[0]?.toLowerCase();
      const mappedSection = sectionKey ? sectionMap.get(sectionKey) : undefined;
      state.sectionName = description || mappedSection?.name || guessSectionName || levels[0];
      state.subSectionCode = "";
      state.subSectionName = "";
      return;
    }

    if (level === 2 && !hasQuantities(aiItem)) {
      // Check if this is a provisional sum or allowance item (should be kept as line item)
      const isProvisionalItem = description && (
        description.toLowerCase().includes("provisional") ||
        description.toLowerCase().includes("allowance") ||
        description.toLowerCase().includes("sum for") ||
        description.length > 15
      );

      if (!isProvisionalItem) {
        state.subSectionCode = levels.slice(0, 2).join(".");
        state.subSectionName = description || guessSubName || state.subSectionCode;
        if (!state.sectionCode && guessSectionCode) {
          state.sectionCode = guessSectionCode;
        }
        if (!state.sectionName && guessSectionName) {
          state.sectionName = guessSectionName;
        }
        return;
      }
    }

    const qty = aiItem.qty ?? 0;
    const rate = aiItem.rate ?? 0;
    const amount = aiItem.amount ?? qty * rate;

    const rawSectionCode = state.sectionCode || guessSectionCode || (levels[0] ?? "");
    const sectionCode = extractTopLevelSection(rawSectionCode);
    const sectionName = state.sectionName || guessSectionName || sectionMap.get(sectionCode.toLowerCase())?.name || sectionCode;
    const subSectionCode = state.subSectionCode || guessSubCode || (levels.length > 1 ? levels.slice(0, 2).join(".") : "");
    const subSectionName = state.subSectionName || guessSubName || subSectionCode;

    items.push({
      sectionCode,
      sectionName,
      subSectionCode,
      subSectionName,
      itemCode: itemCode || generateItemCode(index + 1),
      description: description || aiItem.sectionGuess || "",
      unit: aiItem.unit || "",
      qty,
      rate: Math.round(rate * 100) / 100,
      amount: Math.round(amount * 100) / 100,
    });
  });

  return items;
}

export function mapAIResponseToResponseItems(response: OpenAIExcelResponse): ParsedResponseItem[] {
  return response.items.map((aiItem) => ({
    sectionGuess: aiItem.sectionGuess,
    itemCode: undefined,
    description: aiItem.description,
    unit: aiItem.unit,
    qty: aiItem.qty,
    rate: typeof aiItem.rate === "number" ? Math.round(aiItem.rate * 100) / 100 : undefined,
    amount: typeof aiItem.amount === "number" ? Math.round(aiItem.amount * 100) / 100 : undefined,
    amountLabel: aiItem.amountLabel,
  }));
}

function hasQuantities(item: OpenAIResponseItem): boolean {
  const qty = item.qty ?? 0;
  const rate = item.rate ?? 0;
  const amount = item.amount ?? 0;
  return Boolean(qty) || Boolean(rate) || Boolean(amount);
}

function generateItemCode(index: number): string {
  return `AUTO-${index.toString().padStart(4, "0")}`;
}
