import { describe, expect, it } from "vitest";

import { toContractorSummary, toDocumentSummary, toParseJobSummary } from "@/lib/mappers";
import { ContractorEntity, DocumentEntity, ParseJobEntity } from "@/types/domain";

const now = "2024-01-01T00:00:00.000Z";

describe("mappers", () => {
  it("maps document summaries using the provided filename", () => {
    const document: DocumentEntity = {
      docId: "doc-123",
      projectId: "proj-1",
      type: "itt",
      source: "excel",
      s3KeyRaw: "projects/proj-1/itt/raw.xlsx",
      parseStatus: "pending",
      createdAt: now,
      updatedAt: now,
      fileName: "project-boq.xlsx",
    };

    const summary = toDocumentSummary(document);
    expect(summary.name).toBe("project-boq.xlsx");
    expect(summary.parseStatus).toBe("pending");
  });

  it("falls back to contractor name for response documents without a filename", () => {
    const document: DocumentEntity = {
      docId: "doc-456",
      projectId: "proj-1",
      type: "response",
      source: "pdf",
      s3KeyRaw: "projects/proj-1/responses/cont/raw.pdf",
      parseStatus: "parsing",
      createdAt: now,
      updatedAt: now,
      contractorId: "cont-1",
      contractorName: "Acme Corp",
    };

    const summary = toDocumentSummary(document);
    expect(summary.name).toBe("Acme Corp");
    expect(summary.source).toBe("pdf");
  });

  it("uses sensible fallback labels when metadata is missing", () => {
    const document: DocumentEntity = {
      docId: "doc-789",
      projectId: "proj-1",
      type: "response",
      source: "excel",
      s3KeyRaw: "projects/proj-1/responses/cont/raw.xlsx",
      parseStatus: "parsed",
      createdAt: now,
      updatedAt: now,
    };

    const summary = toDocumentSummary(document);
    expect(summary.name).toBe("Tender Response");
  });

  it("maps contractor entities to summaries", () => {
    const contractor: ContractorEntity = {
      contractorId: "cont-1",
      projectId: "proj-1",
      name: "Acme Corp",
      contact: "bid@acme.com",
      createdAt: now,
      updatedAt: now,
    };

    expect(toContractorSummary(contractor)).toEqual({
      contractorId: "cont-1",
      name: "Acme Corp",
      contact: "bid@acme.com",
    });
  });

  it("maps parse job entities to summaries", () => {
    const job: ParseJobEntity = {
      jobId: "job-1",
      projectId: "proj-1",
      documentId: "doc-123",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };

    expect(toParseJobSummary(job)).toEqual({
      jobId: "job-1",
      documentId: "doc-123",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
  });
});
