import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

import { listMatches } from "@/handlers/api/match";

const getProjectItem = vi.fn();
const listProjectMatches = vi.fn();
const listProjectIttItems = vi.fn();
const listProjectResponseItems = vi.fn();
const listProjectContractors = vi.fn();

vi.mock("@/lib/repository/projects", () => ({
  getProjectItem,
}));

vi.mock("@/lib/repository/matches", () => ({
  listProjectMatches,
  upsertProjectMatch: vi.fn(),
  updateProjectMatch: vi.fn(),
  getProjectMatch: vi.fn(),
}));

vi.mock("@/lib/repository/itt-items", () => ({
  listProjectIttItems,
  getProjectIttItem: vi.fn(),
}));

vi.mock("@/lib/repository/response-items", () => ({
  listProjectResponseItems,
  getProjectResponseItem: vi.fn(),
}));

vi.mock("@/lib/repository/contractors", () => ({
  listProjectContractors,
}));

const baseMatch = {
  projectId: "project-1",
  contractorId: "contractor-1",
  responseItemId: "response-1",
  confidence: 1,
  comment: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
} as const;

const eventTemplate: Partial<APIGatewayProxyEvent> = {
  requestContext: {
    authorizer: {
      principalId: "user-1",
    },
  } as any,
};

beforeEach(() => {
  vi.clearAllMocks();

  getProjectItem.mockResolvedValue({ projectId: "project-1", name: "Demo" });
  listProjectIttItems.mockResolvedValue([
    {
      ittItemId: "itt-accepted",
      projectId: "project-1",
      sectionId: "section-1",
      description: "Accepted line",
      itemCode: "A1",
    },
    {
      ittItemId: "itt-suggested",
      projectId: "project-1",
      sectionId: "section-1",
      description: "Suggested line",
      itemCode: "S1",
    },
  ]);
  listProjectResponseItems.mockResolvedValue([
    {
      responseItemId: "response-1",
      projectId: "project-1",
      contractorId: "contractor-1",
      description: "Response item",
    },
  ]);
  listProjectContractors.mockResolvedValue([
    {
      contractorId: "contractor-1",
      projectId: "project-1",
      name: "Contractor One",
      contactName: "",
      contactEmail: "",
    },
  ]);
});

describe("listMatches", () => {
  it("omits suggested matches once the response item already has an accepted match", async () => {
    listProjectMatches.mockResolvedValue([
      {
        matchId: "accepted-match",
        ...baseMatch,
        ittItemId: "itt-accepted",
        status: "accepted",
      },
      {
        matchId: "suggested-match",
        ...baseMatch,
        ittItemId: "itt-suggested",
        status: "suggested",
        confidence: 0.3,
      },
    ]);

    const event = {
      ...eventTemplate,
      queryStringParameters: {
        status: "all",
        contractor: "contractor-1",
      },
    } as APIGatewayProxyEvent;

    const response = await listMatches(event, { projectId: "project-1" });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body ?? "[]");
    expect(body).toHaveLength(1);
    expect(body[0].matchId).toBe("accepted-match");
  });

  it("suppresses stale suggestions when filtering by suggested status", async () => {
    listProjectMatches.mockResolvedValue([
      {
        matchId: "accepted-match",
        ...baseMatch,
        ittItemId: "itt-accepted",
        status: "accepted",
      },
      {
        matchId: "suggested-match",
        ...baseMatch,
        ittItemId: "itt-suggested",
        status: "suggested",
        confidence: 0.25,
      },
    ]);

    const event = {
      ...eventTemplate,
      queryStringParameters: {
        status: "suggested",
        contractor: "contractor-1",
      },
    } as APIGatewayProxyEvent;

    const response = await listMatches(event, { projectId: "project-1" });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body ?? "[]");
    expect(body).toHaveLength(0);
  });
});
