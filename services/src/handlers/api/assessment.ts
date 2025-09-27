import type { ApiEvent } from "@/lib/api-utils";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "@/lib/response";
import { getOwnerSub, getPathParam } from "@/lib/api-utils";
import { getProjectItem } from "@/lib/repository/projects";
import { listProjectMatches } from "@/lib/repository/matches";
import { listProjectIttItems } from "@/lib/repository/itt-items";
import { listProjectResponseItems } from "@/lib/repository/response-items";
import { listProjectContractors } from "@/lib/repository/contractors";
import { listProjectExceptions } from "@/lib/repository/exceptions";
import type { MatchEntity, ITTItemEntity, ResponseItemEntity, ContractorEntity, ExceptionEntity } from "@/types/domain";
import type { AssessmentPayload, AssessmentLineItem, ContractorSummary, SectionSummary } from "@/types/api";

export async function getAssessment(event: ApiEvent, params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  const ownerSub = getOwnerSub(event);
  const projectId = getPathParam(params, "projectId");

  const project = await getProjectItem(ownerSub, projectId);
  if (!project) {
    return jsonResponse(404, { message: "Project not found" });
  }

  // Fetch all data in parallel for performance
  const [ittItems, responseItems, matches, contractors, exceptions] = await Promise.all([
    listProjectIttItems(ownerSub, projectId),
    listProjectResponseItems(ownerSub, projectId),
    listProjectMatches(ownerSub, projectId, { status: "all" }),
    listProjectContractors(ownerSub, projectId),
    listProjectExceptions(ownerSub, projectId),
  ]);

  // Create contractor lookup maps
  const contractorMap = new Map(contractors.map(c => [c.contractorId, c]));
  const responseItemMap = new Map(responseItems.map(r => [r.responseItemId, r]));

  // Group matches by ITT item ID
  const matchesByIttItem = new Map<string, MatchEntity[]>();
  matches.forEach(match => {
    if (!matchesByIttItem.has(match.ittItemId)) {
      matchesByIttItem.set(match.ittItemId, []);
    }
    matchesByIttItem.get(match.ittItemId)!.push(match);
  });

  // Build assessment line items
  const lineItems: AssessmentLineItem[] = ittItems.map(ittItem => {
    const itemMatches = matchesByIttItem.get(ittItem.ittItemId) || [];
    const responses: Record<string, any> = {};

    // Process each match for this ITT item
    itemMatches.forEach(match => {
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

  // Calculate contractor totals
  const contractorTotals = new Map<string, number>();
  lineItems.forEach(lineItem => {
    Object.values(lineItem.responses).forEach((response: any) => {
      if (response.matchStatus === "accepted" && response.amount) {
        const currentTotal = contractorTotals.get(response.contractorId) || 0;
        contractorTotals.set(response.contractorId, currentTotal + response.amount);
      }
    });
  });

  // Build contractor summaries with totals
  const contractorSummaries: ContractorSummary[] = contractors.map(contractor => ({
    contractorId: contractor.contractorId,
    name: contractor.name,
    contact: contractor.contact,
    totalValue: contractorTotals.get(contractor.contractorId) || 0,
  }));

  // Build section summaries
  const sectionTotals = new Map<string, { ittTotal: number; contractorTotals: Record<string, number>; exceptionCount: number }>();

  lineItems.forEach(lineItem => {
    const sectionId = lineItem.ittItem.sectionId;
    if (!sectionTotals.has(sectionId)) {
      sectionTotals.set(sectionId, {
        ittTotal: 0,
        contractorTotals: {},
        exceptionCount: 0
      });
    }

    const sectionData = sectionTotals.get(sectionId)!;
    sectionData.ittTotal += lineItem.ittItem.amount;

    Object.values(lineItem.responses).forEach((response: any) => {
      if (response.matchStatus === "accepted" && response.amount) {
        sectionData.contractorTotals[response.contractorId] =
          (sectionData.contractorTotals[response.contractorId] || 0) + response.amount;
      }
    });
  });

  // Add exception counts to sections
  exceptions.forEach(exception => {
    if (exception.attachedSectionId) {
      const sectionData = sectionTotals.get(exception.attachedSectionId);
      if (sectionData) {
        sectionData.exceptionCount++;
      }
    }
  });

  // Build unique sections from ITT items
  const uniqueSections = new Map<string, { code: string; name: string; order: number }>();
  ittItems.forEach(item => {
    if (!uniqueSections.has(item.sectionId)) {
      uniqueSections.set(item.sectionId, {
        code: item.sectionId,
        name: item.sectionName || item.sectionId,
        order: Array.from(uniqueSections.keys()).length + 1
      });
    }
  });

  const sections: SectionSummary[] = Array.from(uniqueSections.entries()).map(([sectionId, sectionInfo]) => {
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

  // Transform exceptions for API response
  const exceptionRecords = exceptions.map(exception => ({
    responseItemId: exception.responseItemId,
    contractorId: exception.contractorId,
    contractorName: contractorMap.get(exception.contractorId)?.name || "Unknown",
    description: exception.description,
    attachedSectionId: exception.attachedSectionId,
    amount: exception.amount,
    note: exception.note,
  }));

  const assessmentPayload: AssessmentPayload = {
    project: {
      projectId: project.projectId,
      name: project.name,
      status: project.status,
      currency: project.currency,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    contractors: contractorSummaries,
    sections,
    lineItems,
    exceptions: exceptionRecords,
  };

  return jsonResponse(200, assessmentPayload);
}

// Helper function to calculate response item amount
function calculateResponseAmount(responseItem: ResponseItemEntity): number | null {
  if (typeof responseItem.amount === "number" && !Number.isNaN(responseItem.amount)) {
    return responseItem.amount;
  }
  if (typeof responseItem.qty === "number" && typeof responseItem.rate === "number") {
    const calculated = responseItem.qty * responseItem.rate;
    return Number.isFinite(calculated) ? calculated : null;
  }
  return null;
}

export async function generateReport(_event: ApiEvent, _params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(202, { reportKey: "placeholder" });
}

export async function getReport(_event: ApiEvent, _params: Record<string, string>): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { url: "https://example.com/report.pdf" });
}
