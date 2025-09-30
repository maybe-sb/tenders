"use client";

import React, { useState } from "react";
import { FileSpreadsheet, UploadCloud, Eye } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCard } from "@/components/projects/upload-card";
import { MatchReviewTable } from "@/components/projects/match-review-table";
import { DnDPanel } from "@/components/projects/dnd-panel";
import { ExceptionsList } from "@/components/projects/exceptions-list";
import { StatusBadge } from "@/components/projects/status-badge";
import { MatchSuggestionsScreen } from "@/components/projects/match-suggestions-screen";
import {
  useProjectDetail,
  useProjectExceptions,
  useProjectIttItems,
  useUnmatchedResponseItems,
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
  const { data: ittItems } = useProjectIttItems(projectId);
  const { data: unmatchedItemsData } = useUnmatchedResponseItems(projectId, selectedContractorId);
  const { data: exceptionsData } = useProjectExceptions(projectId, selectedContractorId);

  const { acceptMatch, rejectMatch, createManualMatch } = useMatchActions(projectId);

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

  const selectedContractor = contractors.find((contractor) => contractor.contractorId === selectedContractorId) ?? null;

  const responseItems = selectedContractorId ? unmatchedItemsData ?? [] : [];
  const matches = selectedContractorId ? matchesData ?? [] : [];
  const exceptions = selectedContractorId ? exceptionsData ?? [] : [];
  const manualEmptyState = selectedContractorId
    ? <p className="text-sm text-muted-foreground">All response items matched.</p>
    : <p className="text-sm text-muted-foreground">Select a contractor to manage manual matches.</p>;

  const matchedItems = detail?.stats?.matchedItems ?? 0;
  const unassignedItems = detail?.stats?.unmatchedItems ?? 0;

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

  const handleManualMatch = async (ittItemId: string, responseItemId: string) => {
    try {
      await createManualMatch.mutateAsync({ ittItemId, responseItemId });
      toast.success("Manual match recorded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create manual match";
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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-2xl font-semibold">
              <FileSpreadsheet className="h-6 w-6" />
              {detail.name}
            </CardTitle>
            <CardDescription>Project overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-4">
              <span>Created: {new Date(detail.createdAt).toLocaleDateString()}</span>
              <span>Updated: {new Date(detail.updatedAt).toLocaleString()}</span>
            </div>
            <div className="flex flex-wrap gap-4">
              <StatBlock label="Contractors" value={detail.stats?.contractors ?? 0} />
              <StatBlock label="ITT Items" value={detail.stats?.ittItems ?? 0} />
              <StatBlock label="Matched" value={detail.stats?.matchedItems ?? 0} />
              <StatBlock label="Exceptions" value={detail.stats?.unmatchedItems ?? 0} />
            </div>
            <StatusBadge status={detail.status} />
          </CardContent>
        </Card>
        <AssessmentCompletionCard
          matchedItems={matchedItems}
          unassignedItems={unassignedItems}
          projectId={projectId}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UploadCard
          title="Upload ITT BOQ"
          description="Upload an Excel file containing the ITT BOQ line items. A new upload supersedes previous data."
          accept=".xls,.xlsx"
          onSelectFile={handleIttUpload}
          disabled={acceptMatch.isPending || rejectMatch.isPending}
        />
        <Card>
          <CardHeader>
            <CardTitle>Upload contractor response</CardTitle>
            <CardDescription>Provide a contractor name and upload an Excel or PDF file.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {contractors.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Contractor</span>
            <Select
              value={selectedContractorId ?? ""}
              onValueChange={(value) => setSelectedContractorId(value)}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select contractor" />
              </SelectTrigger>
              <SelectContent>
                {contractors.map((contractor) => (
                  <SelectItem key={contractor.contractorId} value={contractor.contractorId}>
                    {contractor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Upload a contractor response to enable matching workflows.
          </p>
        )}
      </div>

      <Tabs defaultValue="auto-match" className="space-y-4">
        <TabsList>
          <TabsTrigger value="auto-match">Auto-Match & Review</TabsTrigger>
          <TabsTrigger value="matches">Match review</TabsTrigger>
          <TabsTrigger value="manual">Manual mapping</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
        </TabsList>
        <TabsContent value="auto-match" className="space-y-4">
          <MatchSuggestionsScreen
            projectId={projectId}
            contractorId={selectedContractorId}
            contractorName={selectedContractor?.name}
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
            ittItems={ittItems ?? []}
            responseItems={responseItems}
            onManualMatch={handleManualMatch}
            emptyState={manualEmptyState}
          />
        </TabsContent>
        <TabsContent value="exceptions">
          <ExceptionsList exceptions={exceptions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssessmentCompletionCard({
  matchedItems,
  unassignedItems,
  projectId,
}: {
  matchedItems: number;
  unassignedItems: number;
  projectId: string;
}) {
  const totalItems = matchedItems + unassignedItems;
  const completionPercent = totalItems > 0 ? Math.round((matchedItems / totalItems) * 100) : 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Assessment completion overview</CardTitle>
        <CardDescription>Matched items versus remaining work.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-6">
          <CompletionDonut matchedItems={matchedItems} unassignedItems={unassignedItems} />
          <div className="text-center text-sm text-muted-foreground">
            <p>
              <span className="text-base font-semibold text-foreground">{completionPercent}%</span> completed
            </p>
            <p>
              {matchedItems.toLocaleString()} matched out of {totalItems.toLocaleString()} total items.
            </p>
          </div>
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/projects/${projectId}/assessment`}>View assessment report</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompletionDonut({
  matchedItems,
  unassignedItems,
}: {
  matchedItems: number;
  unassignedItems: number;
}) {
  const total = matchedItems + unassignedItems;
  const completionRatio = total > 0 ? matchedItems / total : 0;
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
          className="text-muted-foreground/20"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          cx={size / 2}
          cy={size / 2}
          r={radius}
        />
        <circle
          className="text-primary"
          stroke="currentColor"
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
        <span className="text-4xl font-semibold text-foreground">{unassignedItems.toLocaleString()}</span>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Unassigned items</span>
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

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
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
