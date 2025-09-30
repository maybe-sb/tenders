"use client";

import { useMemo, useState } from "react";
import { FileDown, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssessment, useGenerateInsights, useGenerateReport } from "@/hooks/use-assessment";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import type {
  AssessmentInsightsResponse,
  AssessmentLineItem,
  SectionAttachmentRecord,
  SectionSummary,
} from "@/types/tenders";

interface AssessmentScreenProps {
  projectId: string;
}

export function AssessmentScreen({ projectId }: AssessmentScreenProps) {
  const { data, isLoading } = useAssessment(projectId);
  const generateReport = useGenerateReport(projectId);
  const generateInsights = useGenerateInsights(projectId);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [insightsVisible, setInsightsVisible] = useState(false);
  const [insightsData, setInsightsData] = useState<AssessmentInsightsResponse | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const handleGenerateReport = async () => {
    try {
      setDownloadUrl(null);
      setIsPolling(true);
      const { reportKey } = await generateReport.mutateAsync();
      toast("Generating report", {
        description: "We'll download it automatically once it's ready.",
      });

      const MAX_ATTEMPTS = 8;
      const DELAY_MS = 3000;
      let reportUrl: string | null = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const { url } = await api.getReportDownloadUrl(projectId, reportKey);
          reportUrl = url;
          break;
        } catch (error) {
          if (attempt === MAX_ATTEMPTS - 1) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        }
      }

      if (reportUrl) {
        setDownloadUrl(reportUrl);
        toast.success("Report ready to download");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report is still generating";
      toast.error(message);
    } finally {
      setIsPolling(false);
    }
  };

  const handleGenerateInsights = async () => {
    try {
      setInsightsVisible(true);
      setInsightsError(null);
      setInsightsData(null);
      const result = await generateInsights.mutateAsync();
      setInsightsData(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate insights";
      toast.error(message);
      setInsightsError(message);
    }
  };

  const sectionEntries = useMemo(() => {
    if (!data) {
      return [] as Array<ReturnType<typeof buildSectionDisplay> & { section: SectionSummary }>;
    }

    return sortSections(data.sections).map((section, index) => ({
      section,
      ...buildSectionDisplay(section, index),
    }));
  }, [data]);

  // Initialize selected section when data loads
  if (selectedSectionId === null && sectionEntries.length > 0) {
    setSelectedSectionId(sectionEntries[0].section.sectionId);
  }

  const selectedSection = sectionEntries.find((entry) => entry.section.sectionId === selectedSectionId);

  const lineItemsBySection = useMemo(() => {
    if (!data) {
      return new Map<string, AssessmentLineItem[]>();
    }

    return groupLineItemsBySection(data.lineItems);
  }, [data]);

  const attachmentsBySection = useMemo(() => {
    if (!data) {
      return new Map<string, SectionAttachmentRecord[]>();
    }

    const map = new Map<string, SectionAttachmentRecord[]>();
    Object.entries(data.sectionAttachments ?? {}).forEach(([sectionId, attachments]) => {
      map.set(sectionId, attachments ?? []);
    });
    return map;
  }, [data]);

  const contractors = data?.contractors ?? [];
  const allExceptions = data?.exceptions ?? [];

  // Only show exceptions that were explicitly assigned to "Other/Unclassified" (no section)
  const exceptions = allExceptions.filter((exception) => !exception.attachedSectionId);

  const shouldShowInsightsCard =
    insightsVisible ||
    generateInsights.isPending ||
    Boolean(insightsData) ||
    Boolean(insightsError);

  const insightsDescription = generateInsights.isPending
    ? "Generating insights..."
    : insightsData
      ? `Generated ${new Date(insightsData.generatedAt).toLocaleString()} using ${insightsData.model}${
          insightsData.truncated ? " (partial dataset)" : ""
        }`
      : insightsError
        ? "We couldn't generate insights. Try again."
        : "Use AI to surface highlights across contractor responses.";

  if (isLoading || !data) {
    return <p className="text-muted-foreground">Loading assessment...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Link href={`/projects/${projectId}`} className="text-sm text-primary underline-offset-4 hover:underline">
            ← Back to project
          </Link>
          <h1 className="text-3xl font-semibold">Assessment</h1>
          <p className="text-sm text-muted-foreground">
            Compare contractor responses by section and line item.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleGenerateInsights} disabled={generateInsights.isPending} variant="secondary">
            {generateInsights.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Generate Insights
              </>
            )}
          </Button>
          <Button onClick={handleGenerateReport} disabled={generateReport.isPending || isPolling}>
            {generateReport.isPending || isPolling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <FileDown className="mr-2 h-4 w-4" /> Generate PDF
              </>
            )}
          </Button>
        </div>
      </div>

      {shouldShowInsightsCard ? (
        <Card>
          <CardHeader>
            <CardTitle>AI Insights</CardTitle>
            <CardDescription>{insightsDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {generateInsights.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : insightsError ? (
              <p className="text-sm text-destructive">{insightsError}</p>
            ) : insightsData ? (
              <div className="space-y-4 text-sm leading-6">
                {insightsData.insights
                  .trim()
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((chunk, index) => (
                    <p key={index} className="whitespace-pre-wrap">
                      {chunk}
                    </p>
                  ))}
                {insightsData.truncated ? (
                  <p className="text-xs text-muted-foreground">
                    Note: only part of the dataset was analyzed due to size limits.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Insights will appear here after generation.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {downloadUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Latest report</CardTitle>
            <CardDescription>Your report is ready to download.</CardDescription>
          </CardHeader>
          <CardContent>
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Download report
            </a>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Section totals</CardTitle>
          <CardDescription>Total amounts by section and contractor.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  {contractors.map((contractor) => (
                    <TableHead key={contractor.contractorId} className="text-center">
                      {contractor.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Total ITT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectionEntries.map(({ section, displayName, displayCode }) => (
                  <TableRow
                    key={section.sectionId}
                    onClick={() => setSelectedSectionId(section.sectionId)}
                    className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                      selectedSectionId === section.sectionId ? "bg-muted/70" : ""
                    }`}
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium leading-tight">{displayName}</p>
                        {displayCode ? (
                          <p className="text-xs text-muted-foreground leading-tight">{displayCode}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    {contractors.map((contractor) => (
                      <TableCell key={contractor.contractorId} className="text-center">
                        {formatCurrency(section.totalsByContractor[contractor.contractorId] ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className="text-center">{formatCurrency(section.totalITTAmount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold bg-muted/30">
                  <TableCell>Total</TableCell>
                  {contractors.map((contractor) => {
                    const total = sectionEntries.reduce(
                      (sum, { section }) => sum + (section.totalsByContractor[contractor.contractorId] ?? 0),
                      0
                    );
                    return (
                      <TableCell key={contractor.contractorId} className="text-center">
                        {formatCurrency(total)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center">
                    {formatCurrency(sectionEntries.reduce((sum, { section }) => sum + section.totalITTAmount, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section Detail View */}
      {selectedSection && selectedSectionId !== "__OTHER__" && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedSection.headerTitle}</CardTitle>
            <CardDescription>
              {selectedSection.headerSubtitle ?? `Comparing ${contractors.length} contractor${contractors.length === 1 ? "" : "s"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Description</TableHead>
                    {contractors.map((contractor) => (
                      <TableHead key={contractor.contractorId} className="text-center">
                        {contractor.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const sectionLines = lineItemsBySection.get(selectedSection.section.sectionId) ?? [];
                    const sectionLevelAttachments = attachmentsBySection.get(selectedSection.section.sectionId) ?? [];

                    if (sectionLines.length === 0 && sectionLevelAttachments.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={contractors.length + 2} className="text-center text-muted-foreground">
                            No line items available for this section.
                          </TableCell>
                        </TableRow>
                      );
                    }

                    return (
                      <>
                        {sectionLines.map((line) => (
                          <TableRow key={line.ittItem.ittItemId}>
                            <TableCell className="font-medium">{line.ittItem.itemCode}</TableCell>
                            <TableCell className="whitespace-pre-line">{line.ittItem.description}</TableCell>
                            {contractors.map((contractor) => (
                              <TableCell key={contractor.contractorId} className="text-center">
                                {renderResponseAmount(
                                  line.responses[contractor.contractorId]?.amount,
                                  line.responses[contractor.contractorId]?.amountLabel
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                        {sectionLevelAttachments.length > 0 && sectionLines.length > 0 ? (
                          <TableRow>
                            <TableCell colSpan={contractors.length + 2} className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Section-level responses
                            </TableCell>
                          </TableRow>
                        ) : null}
                        {sectionLevelAttachments.map((attachment) => (
                          <TableRow key={`attachment-${selectedSection.section.sectionId}-${attachment.responseItemId}`} className="bg-muted/20">
                            <TableCell className="font-medium text-muted-foreground">Section item</TableCell>
                            <TableCell className="whitespace-pre-line">
                              <div className="space-y-1">
                                <p>{attachment.description}</p>
                                <p className="text-xs text-muted-foreground">Assigned via manual section mapping</p>
                                {attachment.note ? (
                                  <p className="text-xs text-muted-foreground">Note: {attachment.note}</p>
                                ) : null}
                              </div>
                            </TableCell>
                            {contractors.map((contractor) => (
                              <TableCell key={contractor.contractorId} className="text-center">
                                {contractor.contractorId === attachment.contractorId
                                  ? renderResponseAmount(attachment.amount, attachment.amountLabel)
                                  : "-"}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </>
                    );
                  })()}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other/Unclassified Section */}
      {selectedSectionId === "__OTHER__" && (
        <Card>
          <CardHeader>
            <CardTitle>Other / Unclassified</CardTitle>
            <CardDescription>Items manually assigned to Other/Unclassified in Manual Mapping.</CardDescription>
          </CardHeader>
          <CardContent>
            {exceptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items assigned to Other/Unclassified.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Contractor</TableHead>
                    <TableHead className="text-center">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((exception) => (
                    <TableRow key={exception.responseItemId}>
                      <TableCell>{exception.description}</TableCell>
                      <TableCell>{exception.contractorName}</TableCell>
                      <TableCell className="text-center">
                        {typeof exception.amount === "number" ? formatCurrency(exception.amount) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function renderResponseAmount(value: number | null | undefined, label?: string) {
  if (typeof value === "number") {
    return formatCurrency(value);
  }

  if (label) {
    return label;
  }

  return "-";
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildSectionDisplay(section: SectionSummary, index: number) {
  const trimmedCode = section.code?.trim();
  const trimmedName = section.name?.trim();
  const isUuidCode = trimmedCode ? UUID_REGEX.test(trimmedCode) : false;
  const visibleCode = trimmedCode && !isUuidCode ? trimmedCode : undefined;
  const fallbackName = `Section ${index + 1}`;

  const displayName = trimmedName || visibleCode || fallbackName;
  const displayCode = visibleCode && visibleCode !== displayName ? visibleCode : undefined;
  const tabLabel = visibleCode || displayName;
  const tabDescription = trimmedName && trimmedName !== tabLabel ? trimmedName : undefined;
  const headerSubtitle = displayCode ?? (tabDescription && tabDescription !== displayName ? tabDescription : undefined);

  return {
    displayName,
    displayCode,
    tabLabel,
    tabDescription,
    headerTitle: displayName,
    headerSubtitle,
  };
}

function groupLineItemsBySection(lineItems: AssessmentLineItem[]) {
  const grouped = new Map<string, AssessmentLineItem[]>();

  for (const line of lineItems) {
    const list = grouped.get(line.ittItem.sectionId);
    if (list) {
      list.push(line);
    } else {
      grouped.set(line.ittItem.sectionId, [line]);
    }
  }

  for (const [sectionId, items] of grouped) {
    items.sort((a, b) => compareLineItems(a, b));
    grouped.set(sectionId, items);
  }

  return grouped;
}

function compareLineItems(a: AssessmentLineItem, b: AssessmentLineItem) {
  const aCode = a.ittItem.itemCode ?? "";
  const bCode = b.ittItem.itemCode ?? "";

  const codeComparison = aCode.localeCompare(bCode, undefined, {
    numeric: true,
    sensitivity: "base",
  });

  if (codeComparison !== 0) {
    return codeComparison;
  }

  return a.ittItem.description.localeCompare(b.ittItem.description, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

const sectionCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortSections(sections: SectionSummary[]) {
  return [...sections].sort(compareSections);
}

function compareSections(a: SectionSummary, b: SectionSummary) {
  const orderA = getSectionOrder(a);
  const orderB = getSectionOrder(b);

  if (orderA !== orderB) {
    return orderA < orderB ? -1 : 1;
  }

  const codeComparison = sectionCollator.compare(normalizeSectionCode(a.code), normalizeSectionCode(b.code));
  if (codeComparison !== 0) {
    return codeComparison;
  }

  return sectionCollator.compare(a.name?.trim() ?? "", b.name?.trim() ?? "");
}

function normalizeSectionCode(code?: string) {
  return (code ?? "").trim();
}

function getSectionOrder(section: SectionSummary) {
  const { order, code } = section;

  if (typeof order === "number" && Number.isFinite(order)) {
    return order;
  }

  if (typeof order === "string") {
    const parsed = Number.parseFloat(order);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const normalizedCode = normalizeSectionCode(code);
  const numericMatch = normalizedCode.match(/\d+(?:\.\d+)?/);
  if (numericMatch) {
    const parsed = Number.parseFloat(numericMatch[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Number.POSITIVE_INFINITY;
}
