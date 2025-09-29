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
    if (exception.attachedSectionId) {
      const sectionData = sectionTotals.get(exception.attachedSectionId);
      if (sectionData) {
        sectionData.exceptionCount += 1;
      }
    }
  });

  const sectionMetadata = new Map<string, SectionEntity>();
  sections.forEach((section) => {
    sectionMetadata.set(section.sectionId, section);
  });

  const uniqueSections = new Map<string, { code: string; name: string; order: number }>();
  ittItems.forEach((item) => {
    if (!uniqueSections.has(item.sectionId)) {
      const sectionInfo = sectionMetadata.get(item.sectionId);
      uniqueSections.set(item.sectionId, {
        code: sectionInfo?.code ?? item.sectionId,
        name: sectionInfo?.name ?? item.sectionName ?? item.sectionId,
        order: sectionInfo?.order ?? uniqueSections.size + 1,
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

  const exceptionRecords = exceptions.map((exception) => ({
    responseItemId: exception.responseItemId,
    contractorId: exception.contractorId,
    contractorName: contractorMap.get(exception.contractorId)?.name || "Unknown",
    description: exception.description,
    attachedSectionId: exception.attachedSectionId,
    amount: exception.amount,
    note: exception.note,
  }));

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
  };
}

function calculateResponseAmount(responseItem: ResponseItemEntity): number | null {
  if (typeof responseItem.amount === "number" && !Number.isNaN(responseItem.amount)) {
    return Math.round(responseItem.amount * 100) / 100;
  }
  if (typeof responseItem.qty === "number" && typeof responseItem.rate === "number") {
    const calculated = responseItem.qty * responseItem.rate;
    return Number.isFinite(calculated) ? Math.round(calculated * 100) / 100 : null;
  }
  return null;
}

export type LoadAssessmentResult = NonNullable<Awaited<ReturnType<typeof loadAssessment>>>;
