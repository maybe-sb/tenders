"use client";

import { useState } from "react";
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

  if (isLoading || !data) {
    return <p className="text-muted-foreground">Loading assessment...</p>;
  }

  const { contractors, sections, lineItems, exceptions } = data;

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
              {sections.map((section) => (
                <TableRow key={section.sectionId}>
                  <TableCell>
                    <p className="font-medium">
                      {section.code}  {section.name}
                    </p>
                  </TableCell>
                  {contractors.map((contractor) => (
                    <TableCell key={contractor.contractorId} className="text-right">
                      {formatCurrency(section.totalsByContractor[contractor.contractorId] ?? 0)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    {formatCurrency(section.totalITTAmount)}
                  </TableCell>
                  <TableCell className="text-center">{section.exceptionCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Tabs defaultValue={sections[0]?.sectionId ?? "all"} className="space-y-4">
        <TabsList className="w-full overflow-x-auto">
          {sections.map((section) => (
            <TabsTrigger key={section.sectionId} value={section.sectionId}>
              {section.code}
            </TabsTrigger>
          ))}
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
        </TabsList>
        {sections.map((section) => (
          <TabsContent key={section.sectionId} value={section.sectionId}>
            <Card>
              <CardHeader>
                <CardTitle>{section.code}</CardTitle>
                <CardDescription>{section.name}</CardDescription>
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
                      {lineItems
                        .filter((line) => line.ittItem.sectionId === section.sectionId)
                        .map((line) => (
                          <TableRow key={line.ittItem.ittItemId}>
                            <TableCell className="font-medium">{line.ittItem.itemCode}</TableCell>
                            <TableCell>{line.ittItem.description}</TableCell>
                            {contractors.map((contractor) => (
                              <TableCell key={contractor.contractorId} className="text-right">
                                {renderResponseAmount(
                                  line.responses[contractor.contractorId]?.amount,
                                  line.responses[contractor.contractorId]?.amountLabel
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
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
                          {typeof exception.amount === "number"
                            ? formatCurrency(exception.amount)
                            : "-"}
                        </TableCell>
                        <TableCell>{exception.attachedSectionId ?? "Unassigned"}</TableCell>
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
