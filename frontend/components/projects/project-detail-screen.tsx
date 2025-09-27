"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, RefreshCw, UploadCloud } from "lucide-react";
import { toast } from "sonner";

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
import { MatchSuggestion } from "@/types/tenders";






interface ProjectDetailScreenProps {
  projectId: string;
}

export function ProjectDetailScreen({ projectId }: ProjectDetailScreenProps) {
  const { data: detail, isLoading: detailLoading } = useProjectDetail(projectId);
  const { data: matches, isLoading: matchesLoading } = useProjectMatches(projectId, "all");
  const { data: ittItems } = useProjectIttItems(projectId);
  const { data: unmatchedItems } = useUnmatchedResponseItems(projectId);
  const { data: exceptions } = useProjectExceptions(projectId);

  const { acceptMatch, rejectMatch, createManualMatch, triggerAutoMatch } = useMatchActions(projectId);

  const [contractorName, setContractorName] = useState("");

  const documents = detail?.documents ?? [];
  const responseItems = unmatchedItems ?? [];

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

  const handleAutoMatch = () => {
    triggerAutoMatch.mutate(undefined, {
      onSuccess: () => toast.success("Auto-match triggered"),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "Failed to trigger auto-match"),
    });
  };

  const summaryMatches = useMemo(() => summarizeMatches(matches ?? []), [matches]);

  if (detailLoading) {
    return <ProjectDetailSkeleton />;
  }

  if (!detail) {
    return <p className="text-muted-foreground">Project not found.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-2xl font-semibold">
              <FileSpreadsheet className="h-6 w-6" />
              {detail.name}
            </CardTitle>
            <CardDescription>Project overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Matching status</CardTitle>
            <CardDescription>Suggested matches and review progress.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Suggested</span>
              <Badge>{summaryMatches.suggested}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Pending review</span>
              <Badge variant="secondary">{summaryMatches.pending}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Accepted</span>
              <Badge variant="outline">{summaryMatches.accepted}</Badge>
            </div>
            <Button className="mt-4 w-full" onClick={handleAutoMatch} disabled={triggerAutoMatch.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {triggerAutoMatch.isPending ? "Running auto-match..." : "Run auto-match"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UploadCard
          title="Upload ITT BOQ"
          description="Upload an Excel file containing the ITT BOQ line items. A new upload supersedes previous data."
          accept=".xls,.xlsx"
          onSelectFile={handleIttUpload}
          disabled={acceptMatch.isPending || rejectMatch.isPending || triggerAutoMatch.isPending}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.docId}>
                  <TableCell>{doc.name}</TableCell>
                  <TableCell className="capitalize">{doc.type}</TableCell>
                  <TableCell>{doc.contractorName ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(doc.parseStatus)}>{doc.parseStatus}</Badge>
                  </TableCell>
                  <TableCell>{new Date(doc.uploadedAt).toLocaleString()}</TableCell>
                  <TableCell>{doc.stats?.lineItems ?? "-"}</TableCell>
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
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
        </TabsList>
        <TabsContent value="auto-match" className="space-y-4">
          <MatchSuggestionsScreen projectId={projectId} />
        </TabsContent>
        <TabsContent value="matches" className="space-y-4">
          <MatchReviewTable
            rows={(matches ?? [])
              .filter((match) => match.status !== "accepted" && match.status !== "manual")
              .map((match) => ({
                matchId: match.matchId,
                ittDescription: match.ittDescription,
                contractorName: match.contractorName,
                status: match.status,
                responseItem: match.responseDescription
                  ? {
                      description: match.responseDescription,
                      itemCode: match.responseItemCode,
                      amount: match.responseAmount,
                    }
                  : undefined,
                confidence: match.confidence,
              }))}
            onAccept={handleAccept}
            onReject={handleReject}
          />
          {matchesLoading && <p className="text-sm text-muted-foreground">Refreshing suggestions...</p>}
        </TabsContent>
        <TabsContent value="manual">
          <DnDPanel
            ittItems={ittItems ?? []}
            responseItems={responseItems}
            onManualMatch={handleManualMatch}
            emptyState={<p className="text-sm text-muted-foreground">All response items matched.</p>}
          />
        </TabsContent>
        <TabsContent value="exceptions">
          <ExceptionsList exceptions={exceptions ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function summarizeMatches(matches: MatchSuggestion[]) {
  return matches.reduce(
    (acc, match) => {
      acc.suggested += 1;
      if (match.status === "suggested") {
        acc.pending += 1;
      }
      if (match.status === "accepted") {
        acc.accepted += 1;
      }
      return acc;
    },
    { suggested: 0, pending: 0, accepted: 0 }
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
