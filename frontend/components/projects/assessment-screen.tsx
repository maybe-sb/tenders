"use client";

import { useMemo, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAssessment, useGenerateReport } from "@/hooks/use-assessment";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import type { AssessmentLineItem, SectionSummary } from "@/types/tenders";

interface AssessmentScreenProps {
  projectId: string;
}

export function AssessmentScreen({ projectId }: AssessmentScreenProps) {
  const { data, isLoading } = useAssessment(projectId);
  const generateReport = useGenerateReport(projectId);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

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

  const sectionEntries = useMemo(() => {
    if (!data) {
      return [] as Array<ReturnType<typeof buildSectionDisplay> & { section: SectionSummary }>;
    }

    return [...data.sections]
      .sort((a, b) => a.order - b.order)
      .map((section, index) => ({
        section,
        ...buildSectionDisplay(section, index),
      }));
  }, [data]);

  const sectionLabelById = useMemo(
    () =>
      new Map(sectionEntries.map(({ section, displayName }) => [section.sectionId, displayName])),
    [sectionEntries]
  );

  const lineItemsBySection = useMemo(() => {
    if (!data) {
      return new Map<string, AssessmentLineItem[]>();
    }

    return groupLineItemsBySection(data.lineItems);
  }, [data]);

  const contractors = data?.contractors ?? [];
  const exceptions = data?.exceptions ?? [];

  if (isLoading || !data) {
    return <p className="text-muted-foreground">Loading assessment...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Assessment</h1>
          <p className="text-sm text-muted-foreground">
            Compare contractor responses by section and line item.
          </p>
        </div>
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
                    <TableHead key={contractor.contractorId}>{contractor.name}</TableHead>
                  ))}
                  <TableHead>Total ITT</TableHead>
                  <TableHead>Exceptions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectionEntries.map(({ section, displayName, displayCode }) => (
                  <TableRow key={section.sectionId}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium leading-tight">{displayName}</p>
                        {displayCode ? (
                          <p className="text-xs text-muted-foreground leading-tight">{displayCode}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    {contractors.map((contractor) => (
                      <TableCell key={contractor.contractorId} className="text-right">
                        {formatCurrency(section.totalsByContractor[contractor.contractorId] ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatCurrency(section.totalITTAmount)}</TableCell>
                    <TableCell className="text-center">{section.exceptionCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={sectionEntries[0]?.section.sectionId ?? "exceptions"} className="space-y-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-2 overflow-x-auto">
          {sectionEntries.map(({ section, tabLabel, tabDescription }) => (
            <TabsTrigger
              key={section.sectionId}
              value={section.sectionId}
              className="flex-none flex-col items-start gap-1 whitespace-normal text-left h-auto min-w-[160px] px-3 py-2"
            >
              <span className="text-sm font-semibold leading-tight">{tabLabel}</span>
              {tabDescription ? (
                <span className="text-xs text-muted-foreground leading-tight">{tabDescription}</span>
              ) : null}
            </TabsTrigger>
          ))}
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
        </TabsList>
        {sectionEntries.map(({ section, headerTitle, headerSubtitle }) => {
          const sectionLines = lineItemsBySection.get(section.sectionId) ?? [];

          return (
            <TabsContent key={section.sectionId} value={section.sectionId}>
              <Card>
                <CardHeader>
                  <CardTitle>{headerTitle}</CardTitle>
                  <CardDescription>
                    {headerSubtitle ?? `Comparing ${contractors.length} contractor${contractors.length === 1 ? "" : "s"}.`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead>Description</TableHead>
                          {contractors.map((contractor) => (
                            <TableHead key={contractor.contractorId}>{contractor.name}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sectionLines.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={contractors.length + 2} className="text-center text-muted-foreground">
                              No line items available for this section.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sectionLines.map((line) => (
                            <TableRow key={line.ittItem.ittItemId}>
                              <TableCell className="font-medium">{line.ittItem.itemCode}</TableCell>
                              <TableCell className="whitespace-pre-line">{line.ittItem.description}</TableCell>
                              {contractors.map((contractor) => (
                                <TableCell key={contractor.contractorId} className="text-right">
                                  {renderResponseAmount(
                                    line.responses[contractor.contractorId]?.amount,
                                    line.responses[contractor.contractorId]?.amountLabel
                                  )}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
        <TabsContent value="exceptions">
          <Card>
            <CardHeader>
              <CardTitle>Exceptions</CardTitle>
              <CardDescription>Items that could not be matched to ITT lines.</CardDescription>
            </CardHeader>
            <CardContent>
              {exceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exceptions recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Contractor</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Section</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exceptions.map((exception) => (
                      <TableRow key={exception.responseItemId}>
                        <TableCell>{exception.description}</TableCell>
                        <TableCell>{exception.contractorName}</TableCell>
                        <TableCell>
                          {typeof exception.amount === "number" ? formatCurrency(exception.amount) : "-"}
                        </TableCell>
                        <TableCell>
                          {exception.attachedSectionId
                            ? sectionLabelById.get(exception.attachedSectionId) ?? exception.attachedSectionId
                            : "Unassigned"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
