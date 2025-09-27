"use client";

import { useMemo } from "react";
import { ArrowLeft, FileSpreadsheet, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { ITTItem, ResponseItem } from "@/types/tenders";

interface DocumentDetailScreenProps {
  projectId: string;
  docId: string;
}

export function DocumentDetailScreen({ projectId, docId }: DocumentDetailScreenProps) {
  // Fetch project detail to get document info
  const { data: projectDetail, isLoading: projectLoading } = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: () => api.getProjectDetail(projectId),
  });

  // Get document details from project detail
  const document = useMemo(() => {
    return projectDetail?.documents.find(doc => doc.docId === docId);
  }, [projectDetail, docId]);

  // Fetch extracted items based on document type
  const { data: ittItems, isLoading: ittLoading } = useQuery({
    queryKey: ["itt-items", projectId],
    queryFn: () => api.listIttItems(projectId),
    enabled: document?.type === "itt",
  });

  const { data: responseItems, isLoading: responseLoading } = useQuery({
    queryKey: ["response-items", projectId],
    queryFn: () => api.listResponseItems(projectId),
    enabled: document?.type === "response",
  });

  // Filter items by document (assuming we'll have documentId field or can filter by contractor)
  const filteredItems = useMemo(() => {
    if (document?.type === "itt") {
      return ittItems || [];
    } else if (document?.type === "response") {
      // Filter response items by contractor if we have contractor info
      return document.contractorId
        ? (responseItems || []).filter(item => item.contractorId === document.contractorId)
        : responseItems || [];
    }
    return [];
  }, [document, ittItems, responseItems]);

  const isLoading = projectLoading || (document?.type === "itt" ? ittLoading : responseLoading);

  if (isLoading) {
    return <DocumentDetailSkeleton />;
  }

  if (!document) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost">
          <Link href={`/projects/${projectId}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Project
          </Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Document not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <Button asChild variant="ghost">
        <Link href={`/projects/${projectId}`}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Project
        </Link>
      </Button>

      {/* Document Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl font-semibold">
            <FileSpreadsheet className="h-6 w-6" />
            {document.name}
          </CardTitle>
          <CardDescription>Document details and extracted results</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Type" value={document.type.toUpperCase()} />
            <InfoItem label="Contractor" value={document.contractorName || "N/A"} />
            <InfoItem label="Source" value={document.source.toUpperCase()} />
            <InfoItem label="Uploaded" value={new Date(document.uploadedAt).toLocaleString()} />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <StatusBadge status={document.parseStatus} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Extracted Items:</span>
              <Badge variant="outline">{document.stats?.lineItems || 0}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Extracted Items */}
      <Card>
        <CardHeader>
          <CardTitle>Extracted Items</CardTitle>
          <CardDescription>
            {document.type === "itt"
              ? "ITT Bill of Quantities line items extracted from this document"
              : "Contractor response items extracted from this document"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {document.parseStatus !== "parsed" ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
              <p>Document parsing is {document.parseStatus}. Items will be available once parsing completes successfully.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2" />
              <p>No items were extracted from this document.</p>
            </div>
          ) : document.type === "itt" ? (
            <IttItemsTable items={filteredItems as ITTItem[]} />
          ) : (
            <ResponseItemsTable items={filteredItems as ResponseItem[]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants = {
    parsed: { variant: "default" as const, icon: CheckCircle, text: "Parsed" },
    parsing: { variant: "secondary" as const, icon: Clock, text: "Parsing" },
    error: { variant: "destructive" as const, icon: AlertTriangle, text: "Error" },
    pending: { variant: "outline" as const, icon: Clock, text: "Pending" },
  };

  const config = variants[status as keyof typeof variants] || variants.pending;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {config.text}
    </Badge>
  );
}

function IttItemsTable({ items }: { items: ITTItem[] }) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Section</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.ittItemId}>
              <TableCell>
                <div className="space-y-1">
                  <div className="font-medium text-sm">{item.sectionName || item.sectionId}</div>
                  {item.subSectionName && (
                    <div className="text-xs text-muted-foreground">{item.subSectionName}</div>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm">{item.itemCode}</TableCell>
              <TableCell className="max-w-md">
                <div className="truncate" title={item.description}>
                  {item.description}
                </div>
              </TableCell>
              <TableCell>{item.unit}</TableCell>
              <TableCell className="text-right font-mono">{item.qty.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">${item.rate.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">${item.amount.toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ResponseItemsTable({ items }: { items: ResponseItem[] }) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Section</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.responseItemId}>
              <TableCell>
                <div className="text-sm">
                  {item.sectionGuess || "Unknown"}
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm">{item.itemCode || "-"}</TableCell>
              <TableCell className="max-w-md">
                <div className="truncate" title={item.description}>
                  {item.description}
                </div>
              </TableCell>
              <TableCell>{item.unit || "-"}</TableCell>
              <TableCell className="text-right font-mono">
                {item.qty !== undefined ? item.qty.toLocaleString() : "-"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {item.rate !== undefined ? `$${item.rate.toLocaleString()}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {item.amount !== undefined ? `$${item.amount.toLocaleString()}` : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DocumentDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-32" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}