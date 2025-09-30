"use client";

import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, UploadCloud, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCard } from "@/components/projects/upload-card";
import { MatchReviewTable } from "@/components/projects/match-review-table";
import { DnDPanel } from "@/components/projects/dnd-panel";
import { ExceptionsList } from "@/components/projects/exceptions-list";
import { MatchSuggestionsScreen } from "@/components/projects/match-suggestions-screen";
import {
  useProjectDetail,
  useProjectExceptions,
  useUnmatchedResponseItems,
  useProjectUnassignedSummary,
  useProjectResponseItems,
} from "@/hooks/use-project-detail";
import { useMatchActions, useProjectMatches } from "@/hooks/use-matches";
import { uploadToPresignedUrl } from "@/lib/upload";
import { api } from "@/lib/api";






interface ProjectDetailScreenProps {
  projectId: string;
}

export function ProjectDetailScreen({ projectId }: ProjectDetailScreenProps) {
  const { data: detail, isLoading: detailLoading } = useProjectDetail(projectId);
  const [selectedContractorId, setSelectedContractorId] = useState<string | undefined>(undefined);
  const { data: matchesData, isLoading: matchesLoading } = useProjectMatches(projectId, "all", selectedContractorId);
  const { data: unmatchedItemsData } = useUnmatchedResponseItems(projectId, selectedContractorId);
  const { data: exceptionsData } = useProjectExceptions(projectId, selectedContractorId);
  const { data: unassignedSummary, isLoading: unassignedSummaryLoading } = useProjectUnassignedSummary(projectId);
  const { data: allResponseItems } = useProjectResponseItems(projectId);

  const { acceptMatch, rejectMatch } = useMatchActions(projectId);
  const queryClient = useQueryClient();
  const autoMatchStateRef = React.useRef(new Map<string, { fingerprint: string; inFlight: boolean }>());

  const [contractorName, setContractorName] = useState("");

  const documents = detail?.documents ?? [];
  const contractors = React.useMemo(() => detail?.contractors ?? [], [detail?.contractors]);

  React.useEffect(() => {
    if (contractors.length === 0) {
      setSelectedContractorId(undefined);
      return;
    }

    setSelectedContractorId((current) => {
      if (current && contractors.some((contractor) => contractor.contractorId === current)) {
        return current;
      }
      return contractors[0].contractorId;
    });
  }, [contractors]);

  const responseItems = selectedContractorId ? unmatchedItemsData ?? [] : [];
  const matches = selectedContractorId ? matchesData ?? [] : [];
  const exceptions = selectedContractorId ? exceptionsData ?? [] : [];
  const manualEmptyState = selectedContractorId
    ? <p className="text-sm text-muted-foreground">All response items matched.</p>
    : <p className="text-sm text-muted-foreground">Select a contractor to manage manual matches.</p>;

  const matchedItemsFromStats = Number(detail?.stats?.matchedItems ?? 0);
  const unassignedItemsFromStats = Number(detail?.stats?.unmatchedItems ?? 0);

  const contractorUnassignedBreakdown = React.useMemo(() => {
    const counts = new Map<string, number>();

    if (unassignedSummary) {
      for (const item of unassignedSummary) {
        const key = item.contractorId ?? "__unknown__";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    const results = contractors.map((contractor) => ({
      contractorId: contractor.contractorId,
      name: contractor.name,
      unassigned: counts.get(contractor.contractorId) ?? 0,
    }));

    const unknownCount = counts.get("__unknown__");
    if (unknownCount) {
      results.push({ contractorId: "__unknown__", name: "Unattributed", unassigned: unknownCount });
    }

    return results.sort((a, b) => b.unassigned - a.unassigned);
  }, [contractors, unassignedSummary]);

  const totalUnassigned = React.useMemo(() => {
    if (unassignedSummary) {
      return contractorUnassignedBreakdown.reduce((sum, item) => sum + item.unassigned, 0);
    }
    return unassignedItemsFromStats;
  }, [contractorUnassignedBreakdown, unassignedItemsFromStats, unassignedSummary]);

  const totalResponseItems = React.useMemo(() => {
    if (allResponseItems) {
      return allResponseItems.length;
    }
    return matchedItemsFromStats + unassignedItemsFromStats;
  }, [allResponseItems, matchedItemsFromStats, unassignedItemsFromStats]);

  const totalResolved = React.useMemo(() => {
    const resolved = totalResponseItems - totalUnassigned;
    return resolved > 0 ? resolved : 0;
  }, [totalResponseItems, totalUnassigned]);

  React.useEffect(() => {
    if (!detail?.documents) {
      return;
    }

    detail.documents
      .filter(
        (doc) =>
          doc.type === "response" &&
          doc.parseStatus === "parsed" &&
          Boolean(doc.contractorId)
      )
      .forEach((doc) => {
        const fingerprint = `${doc.docId}:${doc.parseStatus}:${doc.uploadedAt}`;
        const current = autoMatchStateRef.current.get(doc.docId);

        if (current && current.fingerprint === fingerprint && !current.inFlight) {
          return;
        }

        if (current && current.fingerprint === fingerprint && current.inFlight) {
          return;
        }

        autoMatchStateRef.current.set(doc.docId, { fingerprint, inFlight: true });

        api
          .triggerAutoMatch(projectId, { contractorId: doc.contractorId })
          .then(() => {
            queryClient.invalidateQueries({
              predicate: (query) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === "match-suggestions" &&
                query.queryKey[1] === projectId,
            });
            queryClient.invalidateQueries({ queryKey: ["project-unmatched-summary", projectId] });
          })
          .catch((error) => {
            console.error("Failed to trigger auto-match", error);
            autoMatchStateRef.current.delete(doc.docId);
          })
          .finally(() => {
            const stored = autoMatchStateRef.current.get(doc.docId);
            if (stored && stored.fingerprint === fingerprint) {
              autoMatchStateRef.current.set(doc.docId, { fingerprint, inFlight: false });
            }
          });
      });
  }, [detail?.documents, projectId, queryClient]);

  const handleIttUpload = async (file: File) => {
    try {
      const { upload } = await api.requestIttUpload(projectId, { fileName: file.name });
      await uploadToPresignedUrl(upload, file);
      await api.confirmIttUpload(projectId, { key: upload.key, fileName: file.name });
      toast.success("ITT upload received; parsing started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload ITT";
      toast.error(message);
    }
  };

  const handleResponseUpload = async (file: File) => {
    if (!contractorName) {
      toast.error("Provide a contractor name before uploading.");
      return;
    }

    try {
      const { upload, contractor } = await api.requestResponseUpload(projectId, {
        contractorName,
        fileName: file.name,
      });
      await uploadToPresignedUrl(upload, file);
      await api.confirmResponseUpload(projectId, {
        key: upload.key,
        contractorId: contractor.contractorId,
        contractorName: contractor.name,
        fileName: file.name,
      });
      toast.success("Response uploaded; parsing started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload response";
      toast.error(message);
    }
  };

  const handleAccept = (matchId: string) => {
    acceptMatch.mutate(matchId, {
      onSuccess: () => toast.success("Match accepted"),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "Failed to accept match"),
    });
  };

  const handleReject = (matchId: string) => {
    rejectMatch.mutate(matchId, {
      onSuccess: () => toast.success("Match rejected"),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "Failed to reject match"),
    });
  };

  const handleAssignToSection = async (sectionId: string, responseItemId: string) => {
    try {
      // If "Other" section, pass undefined to store as unassigned
      const actualSectionId = sectionId === "__OTHER__" ? undefined : sectionId;
      await api.attachException(projectId, { responseItemId, sectionId: actualSectionId });
      toast.success("Response assigned to section");

      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === "project-response-items" &&
          query.queryKey[1] === projectId,
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === "project-exceptions" &&
          query.queryKey[1] === projectId,
      });
      queryClient.invalidateQueries({ queryKey: ["project-unmatched-summary", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-assessment", projectId] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to assign response";
      toast.error(message);
    }
  };

  if (detailLoading) {
    return <ProjectDetailSkeleton />;
  }

  if (!detail) {
    return <p className="text-muted-foreground">Project not found.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="flex h-full flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-xl font-semibold">
                <FileSpreadsheet className="h-5 w-5" />
                {detail.name}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Created {new Date(detail.createdAt).toLocaleDateString()} · Updated {new Date(detail.updatedAt).toLocaleString()}
              </CardDescription>
            </CardHeader>
          </Card>
          <UploadCard
            title="Upload ITT BOQ"
            description="Upload an Excel file containing the ITT BOQ line items. A new upload supersedes previous data."
            accept=".xls,.xlsx"
            onSelectFile={handleIttUpload}
            disabled={acceptMatch.isPending || rejectMatch.isPending}
          />
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Upload contractor response</CardTitle>
              <CardDescription>Provide a contractor name and upload an Excel or PDF file.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between space-y-4">
              <div>
                <label className="text-sm font-medium" htmlFor="contractor-name">
                  Contractor name
                </label>
                <Input
                  id="contractor-name"
                  placeholder="Acme Construction"
                  value={contractorName}
                  onChange={(event) => setContractorName(event.target.value)}
                />
              </div>
              <FilePicker
                accept=".xls,.xlsx,.pdf"
                onSelectFile={handleResponseUpload}
                disabled={contractorName.trim().length === 0}
              />
            </CardContent>
          </Card>
        </div>

          <AssessmentCompletionCard
            resolvedCount={totalResolved}
            unassignedCount={totalUnassigned}
            totalCount={totalResponseItems}
            breakdown={contractorUnassignedBreakdown}
            breakdownLoading={unassignedSummaryLoading && !unassignedSummary}
            projectId={projectId}
          />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Uploads and parsing status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Line items</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.docId}>
                  <TableCell>{doc.name}</TableCell>
                  <TableCell>
                    {doc.type === "itt"
                      ? "ITT"
                      : doc.type === "response"
                        ? "Response"
                        : doc.type}
                  </TableCell>
                  <TableCell>{doc.contractorName ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(doc.parseStatus)}>{doc.parseStatus}</Badge>
                  </TableCell>
                  <TableCell>{new Date(doc.uploadedAt).toLocaleString()}</TableCell>
                  <TableCell>{doc.stats?.lineItems ?? "-"}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm" disabled={doc.parseStatus !== "parsed"}>
                      <Link href={`/projects/${projectId}/documents/${doc.docId}`}>
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Tabs defaultValue="auto-match" className="space-y-4">
        <TabsList>
          <TabsTrigger value="auto-match">Auto-Match & Review</TabsTrigger>
          <TabsTrigger value="matches">Match review</TabsTrigger>
          <TabsTrigger value="manual">Manual mapping</TabsTrigger>
          <TabsTrigger value="exceptions">Unassigned</TabsTrigger>
        </TabsList>
        <TabsContent value="auto-match" className="space-y-4">
          <MatchSuggestionsScreen
            projectId={projectId}
            contractorId={selectedContractorId}
            contractors={contractors}
            onSelectContractor={setSelectedContractorId}
          />
        </TabsContent>
        <TabsContent value="matches" className="space-y-4">
          <MatchReviewTable
            rows={matches
              .filter((match) => match.status !== "accepted" && match.status !== "manual")
              .map((match) => ({
                matchId: match.matchId,
                ittDescription: match.ittDescription,
                contractorName: match.contractorName ?? "Unknown",
                status: match.status,
                responseItem: match.responseDescription
                  ? {
                      description: match.responseDescription,
                      amount: match.responseAmount,
                      qty: match.responseQty,
                      rate: match.responseRate,
                      unit: match.responseUnit,
                    }
                  : undefined,
                confidence: match.confidence,
              }))}
            onAccept={handleAccept}
            onReject={handleReject}
          />
          {matchesLoading && selectedContractorId && (
            <p className="text-sm text-muted-foreground">Refreshing suggestions...</p>
          )}
        </TabsContent>
        <TabsContent value="manual">
          <DnDPanel
            sections={detail.sections ?? []}
            responseItems={responseItems}
            exceptions={exceptions}
            onAssignSection={handleAssignToSection}
            emptyState={manualEmptyState}
          />
        </TabsContent>
        <TabsContent value="exceptions">
          <ExceptionsList
            exceptions={exceptions}
            sections={detail.sections ?? []}
            onAssignSection={handleAssignToSection}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssessmentCompletionCard({
  resolvedCount,
  unassignedCount,
  totalCount,
  breakdown,
  breakdownLoading,
  projectId,
}: {
  resolvedCount: number;
  unassignedCount: number;
  totalCount: number;
  breakdown: Array<{ contractorId: string; name: string; unassigned: number }>;
  breakdownLoading: boolean;
  projectId: string;
}) {
  const completionPercent = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;
  const totalUnassigned = breakdown.reduce((sum, item) => sum + item.unassigned, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Assessment completion overview</CardTitle>
        <CardDescription>Matched items versus remaining work.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,220px),1fr] lg:items-center">
          <div className="flex flex-col items-center gap-6">
            <CompletionDonut resolvedCount={resolvedCount} unassignedCount={unassignedCount} totalCount={totalCount} />
            <div className="text-center text-sm text-muted-foreground">
              <p>
                <span className="text-base font-semibold text-foreground">{completionPercent}%</span> completed
              </p>
              <p>
                {resolvedCount.toLocaleString()} handled out of {totalCount.toLocaleString()} total response items.
              </p>
            </div>
            <Button asChild className="w-full sm:w-auto">
              <Link href={`/projects/${projectId}/assessment`}>View assessment report</Link>
            </Button>
          </div>
          <ContractorUnassignedChart breakdown={breakdown} total={totalUnassigned} isLoading={breakdownLoading} />
        </div>
      </CardContent>
    </Card>
  );
}

function CompletionDonut({
  resolvedCount,
  unassignedCount,
  totalCount,
}: {
  resolvedCount: number;
  unassignedCount: number;
  totalCount: number;
}) {
  const completionRatio = totalCount > 0 ? resolvedCount / totalCount : 0;
  const size = 176;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - completionRatio * circumference;

  return (
    <div className="relative h-44 w-44">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-full w-full"
        role="img"
        aria-label={`Assessment ${Math.round(completionRatio * 100)} percent complete`}
      >
        <circle
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
          fill="transparent"
          cx={size / 2}
          cy={size / 2}
          r={radius}
        />
        <circle
          stroke="#27ABE2"
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
        <span className="text-4xl font-semibold text-foreground">{unassignedCount.toLocaleString()}</span>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Unassigned items</span>
      </div>
    </div>
  );
}

function ContractorUnassignedChart({
  breakdown,
  total,
  isLoading,
}: {
  breakdown: Array<{ contractorId: string; name: string; unassigned: number }>;
  total: number;
  isLoading: boolean;
}) {
  const maxValue = breakdown.reduce((max, entry) => Math.max(max, entry.unassigned), 0);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading contractor breakdown...
      </div>
    );
  }

  if (breakdown.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No contractor responses yet. Upload responses to begin matching.
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm font-medium text-foreground">
          <span>Unassigned by contractor</span>
          <span className="text-muted-foreground">{total}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          All response items are currently assigned.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm font-medium text-foreground">
        <span>Unassigned by contractor</span>
        <span className="text-muted-foreground">{total.toLocaleString()} total</span>
      </div>
      <div className="space-y-3">
        {breakdown.map(({ contractorId, name, unassigned }) => (
          <div key={contractorId} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-foreground">{name}</span>
              <span className="text-muted-foreground">{unassigned.toLocaleString()}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: "#27ABE2",
                  width:
                    unassigned === 0
                      ? "0%"
                      : `${Math.min(100, Math.max(8, (unassigned / Math.max(1, maxValue)) * 100))}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "parsed":
      return "default";
    case "error":
      return "destructive";
    case "parsing":
      return "secondary";
    default:
      return "outline";
  }
}

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function FilePicker({
  accept,
  onSelectFile,
  disabled,
}: {
  accept: string;
  onSelectFile: (file: File) => Promise<void>;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  const handleSelect: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPending(true);
    try {
      await onSelectFile(file);
    } finally {
      setPending(false);
      event.target.value = "";
    }
  };

  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{pending ? "Uploading..." : "Select file"}</p>
        <p className="text-xs text-muted-foreground">Excel or PDF</p>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <UploadCloud className="h-4 w-4" />
        Browse
      </div>
      <input
        type="file"
        className="hidden"
        accept={accept}
        disabled={disabled || pending}
        onChange={handleSelect}
      />
    </label>
  );
}
