import { getProjectItem } from "@/lib/repository/projects";
import { listProjectMatches } from "@/lib/repository/matches";
import { listProjectIttItems } from "@/lib/repository/itt-items";
import { listProjectResponseItems } from "@/lib/repository/response-items";
import { listProjectContractors } from "@/lib/repository/contractors";
import { listProjectExceptions } from "@/lib/repository/exceptions";
import { listProjectSections } from "@/lib/repository/sections";
import type {
  AssessmentLineItem,
  AssessmentPayload,
  ContractorSummary,
  SectionSummary,
} from "@/types/api";
import type {
  ContractorEntity,
  ExceptionEntity,
  ITTItemEntity,
  MatchEntity,
  ResponseItemEntity,
  SectionEntity,
} from "@/types/domain";

export async function loadAssessment(
  ownerSub: string,
  projectId: string
): Promise<AssessmentPayload | null> {
  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return null;
  }

  const [sections, ittItems, responseItems, matches, contractors, exceptions] = await Promise.all([
    listProjectSections(ownerSub, projectId),
    listProjectIttItems(ownerSub, projectId),
    listProjectResponseItems(ownerSub, projectId),
    listProjectMatches(ownerSub, projectId, { status: "all" }),
    listProjectContractors(ownerSub, projectId),
    listProjectExceptions(ownerSub, projectId),
  ]);

  const assessment = buildAssessmentPayload(
    projectId,
    project.name,
    project.status,
    project.currency,
    project.createdAt,
    project.updatedAt,
    sections,
    ittItems,
    responseItems,
    matches,
    contractors,
    exceptions
  );

  return assessment;
}

function buildAssessmentPayload(
  projectId: string,
  projectName: string,
  projectStatus: string,
  currency: string,
  createdAt: string,
  updatedAt: string,
  sections: SectionEntity[],
  ittItems: ITTItemEntity[],
  responseItems: ResponseItemEntity[],
  matches: MatchEntity[],
  contractors: ContractorEntity[],
  exceptions: ExceptionEntity[]
): AssessmentPayload {
  const contractorMap = new Map(contractors.map((contractor) => [contractor.contractorId, contractor]));
  const responseItemMap = new Map(responseItems.map((item) => [item.responseItemId, item]));

  const matchesByIttItem = new Map<string, MatchEntity[]>();
  matches.forEach((match) => {
    if (!matchesByIttItem.has(match.ittItemId)) {
      matchesByIttItem.set(match.ittItemId, []);
    }
    matchesByIttItem.get(match.ittItemId)!.push(match);
  });

  type AssessmentResponse = AssessmentLineItem["responses"][string];

  const lineItems: AssessmentLineItem[] = ittItems.map((ittItem) => {
    const itemMatches = matchesByIttItem.get(ittItem.ittItemId) || [];
    const responses: Record<string, AssessmentResponse> = {};

    itemMatches.forEach((match) => {
      const responseItem = responseItemMap.get(match.responseItemId);
      const contractor = contractorMap.get(match.contractorId);
      if (responseItem && contractor) {
        responses[contractor.contractorId] = {
          responseItemId: responseItem.responseItemId,
          contractorId: responseItem.contractorId,
          sectionGuess: responseItem.sectionGuess,
          itemCode: responseItem.itemCode,
          description: responseItem.description,
          unit: responseItem.unit,
          qty: responseItem.qty,
          rate: responseItem.rate,
          amount: calculateResponseAmount(responseItem),
          amountLabel: responseItem.amountLabel,
          matchStatus: match.status,
        };
      }
    });

    return {
      ittItem: {
        ittItemId: ittItem.ittItemId,
        sectionId: ittItem.sectionId,
        sectionName: ittItem.sectionName,
        subSectionCode: ittItem.subSectionCode,
        subSectionName: ittItem.subSectionName,
        itemCode: ittItem.itemCode,
        description: ittItem.description,
        unit: ittItem.unit,
        qty: ittItem.qty,
        rate: ittItem.rate,
        amount: ittItem.amount,
      },
      responses,
    };
  });

  const contractorTotals = new Map<string, number>();
  lineItems.forEach((lineItem) => {
    Object.values(lineItem.responses).forEach((response) => {
      if (response.matchStatus === "accepted" && typeof response.amount === "number") {
        contractorTotals.set(response.contractorId, (contractorTotals.get(response.contractorId) || 0) + response.amount);
      }
    });
  });

  // Include manually mapped items (exceptions with sectionId) in contractor totals
  // Only include if the responseItem doesn't have an amountLabel like "Included"
  exceptions.forEach((exception) => {
    if (exception.sectionId && typeof exception.amount === "number") {
      const responseItem = responseItemMap.get(exception.responseItemId);
      if (!responseItem?.amountLabel) {
        contractorTotals.set(
          exception.contractorId,
          (contractorTotals.get(exception.contractorId) || 0) + exception.amount
        );
      }
    }
  });

  const contractorSummaries: ContractorSummary[] = contractors.map((contractor) => ({
    contractorId: contractor.contractorId,
    name: contractor.name,
    contact: contractor.contact,
    totalValue: contractorTotals.get(contractor.contractorId) || 0,
  }));

  const sectionTotals = new Map<
    string,
    {
      ittTotal: number;
      contractorTotals: Record<string, number>;
      exceptionCount: number;
    }
  >();

  const sectionAttachmentMap = new Map<
    string,
    Array<{
      responseItemId: string;
      contractorId: string;
      contractorName: string;
      description: string;
      amount: number | null;
      amountLabel?: string;
      note?: string;
    }>
  >();

  lineItems.forEach((lineItem) => {
    const sectionId = lineItem.ittItem.sectionId;
    if (!sectionTotals.has(sectionId)) {
      sectionTotals.set(sectionId, {
        ittTotal: 0,
        contractorTotals: {},
        exceptionCount: 0,
      });
    }
    const sectionData = sectionTotals.get(sectionId)!;
    sectionData.ittTotal += lineItem.ittItem.amount;

    Object.values(lineItem.responses).forEach((response) => {
      if (response.matchStatus === "accepted" && typeof response.amount === "number") {
        sectionData.contractorTotals[response.contractorId] =
          (sectionData.contractorTotals[response.contractorId] || 0) + response.amount;
      }
    });
  });

  exceptions.forEach((exception) => {
    if (exception.sectionId) {
      let sectionData = sectionTotals.get(exception.sectionId);

      // Initialize section data if it doesn't exist (for sections with only manual mappings)
      if (!sectionData) {
        sectionData = {
          ittTotal: 0,
          contractorTotals: {},
          exceptionCount: 0,
        };
        sectionTotals.set(exception.sectionId, sectionData);
      }

      sectionData.exceptionCount += 1;

      // Lookup responseItem to check for amountLabel
      const responseItem = responseItemMap.get(exception.responseItemId);
      const contractor = contractorMap.get(exception.contractorId);

      // Add exception amount to section contractor totals (only if no label like "Included")
      if (typeof exception.amount === "number" && !responseItem?.amountLabel) {
        sectionData.contractorTotals[exception.contractorId] =
          (sectionData.contractorTotals[exception.contractorId] || 0) + exception.amount;
      }
      if (responseItem && contractor) {
        if (!sectionAttachmentMap.has(exception.sectionId)) {
          sectionAttachmentMap.set(exception.sectionId, []);
        }
        sectionAttachmentMap.get(exception.sectionId)!.push({
          responseItemId: responseItem.responseItemId,
          contractorId: contractor.contractorId,
          contractorName: contractor.name,
          description: responseItem.description,
          amount: calculateResponseAmount(responseItem),
          amountLabel: responseItem.amountLabel,
          note: exception.note ?? undefined,
        });
      }
    }
  });

  // Include ALL sections, not just ones with ITT items
  const uniqueSections = new Map<string, { code: string; name: string; order: number }>();

  // First, add all sections from the database (including those without line items)
  sections.forEach((section) => {
    uniqueSections.set(section.sectionId, {
      code: section.code,
      name: section.name,
      order: section.order,
    });
  });

  // Then, add any sections from ITT items that might not be in the sections table
  // (This is a fallback for data integrity)
  ittItems.forEach((item) => {
    if (!uniqueSections.has(item.sectionId)) {
      uniqueSections.set(item.sectionId, {
        code: item.sectionId,
        name: item.sectionName ?? item.sectionId,
        order: uniqueSections.size + 1,
      });
    }
  });

  const sectionSummaries: SectionSummary[] = Array.from(uniqueSections.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .map(([sectionId, sectionInfo]) => {
    const sectionData = sectionTotals.get(sectionId) || { ittTotal: 0, contractorTotals: {}, exceptionCount: 0 };
    return {
      sectionId,
      code: sectionInfo.code,
      name: sectionInfo.name,
      order: sectionInfo.order,
      totalsByContractor: sectionData.contractorTotals,
      totalITTAmount: sectionData.ittTotal,
      exceptionCount: sectionData.exceptionCount,
    };
  });

  // Add synthetic "Other/Unclassified" section for unassigned exceptions
  const unassignedExceptions = exceptions.filter((ex) => !ex.sectionId);
  const otherContractorTotals: Record<string, number> = {};
  unassignedExceptions.forEach((exception) => {
    if (typeof exception.amount === "number") {
      const responseItem = responseItemMap.get(exception.responseItemId);
      if (!responseItem?.amountLabel) {
        otherContractorTotals[exception.contractorId] =
          (otherContractorTotals[exception.contractorId] || 0) + exception.amount;
      }
    }
  });

  if (unassignedExceptions.length > 0) {
    const maxOrder = Math.max(...sectionSummaries.map((s) => s.order), 0);
    sectionSummaries.push({
      sectionId: "__OTHER__",
      code: "—",
      name: "Other / Unclassified",
      order: maxOrder + 1,
      totalsByContractor: otherContractorTotals,
      totalITTAmount: 0,
      exceptionCount: unassignedExceptions.length,
    });
  }

  const exceptionRecords = exceptions.map((exception) => ({
    responseItemId: exception.responseItemId,
    contractorId: exception.contractorId,
    contractorName: contractorMap.get(exception.contractorId)?.name || "Unknown",
    description: exception.description,
    attachedSectionId: exception.sectionId,
    amount: exception.amount,
    note: exception.note,
  }));

  const sectionAttachments = Object.fromEntries(
    Array.from(sectionAttachmentMap.entries()).map(([sectionId, attachments]) => {
      const sorted = [...attachments].sort((a, b) => {
        const nameCompare = a.contractorName.localeCompare(b.contractorName, undefined, {
          sensitivity: "base",
        });
        if (nameCompare !== 0) {
          return nameCompare;
        }
        return a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      });
      return [sectionId, sorted];
    })
  );

  return {
    project: {
      projectId,
      name: projectName,
      status: projectStatus as AssessmentPayload["project"]["status"],
      currency,
      createdAt,
      updatedAt,
    },
    contractors: contractorSummaries,
    sections: sectionSummaries,
    lineItems,
    exceptions: exceptionRecords,
    sectionAttachments,
  };
}

function calculateResponseAmount(responseItem: ResponseItemEntity): number | null {
  // If there's an explicit amount, use it
  if (typeof responseItem.amount === "number" && !Number.isNaN(responseItem.amount)) {
    return Math.round(responseItem.amount * 100) / 100;
  }

  // If there's a label like "Included", return null so frontend displays the label
  if (responseItem.amountLabel) {
    return null;
  }

  // Only calculate from qty × rate if no amount and no label
  if (typeof responseItem.qty === "number" && typeof responseItem.rate === "number") {
    const calculated = responseItem.qty * responseItem.rate;
    return Number.isFinite(calculated) ? Math.round(calculated * 100) / 100 : null;
  }

  return null;
}

export type LoadAssessmentResult = NonNullable<Awaited<ReturnType<typeof loadAssessment>>>;
