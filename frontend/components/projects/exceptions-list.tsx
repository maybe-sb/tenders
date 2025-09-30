"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { ExceptionRecord, SectionSummary } from "@/types/tenders";
import { cn } from "@/lib/utils";

const OTHER_SECTION_ID = "__OTHER__";

interface ExceptionsListProps {
  exceptions: ExceptionRecord[];
  sections?: SectionSummary[];
  onAssignSection?: (sectionId: string, responseItemId: string) => void | Promise<void>;
}

export function ExceptionsList({ exceptions, sections = [], onAssignSection }: ExceptionsListProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const canAssign = sections.length > 0 && onAssignSection;

  const allSelected = exceptions.length > 0 && selectedItems.size === exceptions.length;
  const someSelected = selectedItems.size > 0 && selectedItems.size < exceptions.length;

  const handleToggleAll = () => {
    if (allSelected || someSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(exceptions.map((e) => e.responseItemId)));
    }
  };

  const handleToggleItem = (responseItemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(responseItemId)) {
      newSelected.delete(responseItemId);
    } else {
      newSelected.add(responseItemId);
    }
    setSelectedItems(newSelected);
  };

  const handleBulkAssign = async () => {
    if (!selectedSectionId || !onAssignSection || selectedItems.size === 0) return;

    setIsAssigning(true);
    try {
      for (const responseItemId of Array.from(selectedItems)) {
        await onAssignSection(selectedSectionId, responseItemId);
      }
      setSelectedItems(new Set());
      setSelectedSectionId(null);
    } finally {
      setIsAssigning(false);
    }
  };

  // Create sorted sections list with "Other" at the end
  const sortedSections = [...sections].sort((a, b) => a.order - b.order);
  const sectionsWithOther: Array<SectionSummary & { isOther?: boolean }> = [
    ...sortedSections,
    {
      sectionId: OTHER_SECTION_ID,
      code: "—",
      name: "Other / Unclassified",
      order: sortedSections.length > 0 ? Math.max(...sortedSections.map((s) => s.order)) + 1 : 0,
      totalsByContractor: {},
      totalITTAmount: 0,
      exceptionCount: 0,
      isOther: true,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unassigned Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAssign && exceptions.length > 0 && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someSelected;
                  }}
                  onChange={handleToggleAll}
                  className="h-4 w-4 cursor-pointer rounded border-gray-300"
                />
                <span className="text-sm font-medium">Select All</span>
              </label>
              {selectedItems.size > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {selectedItems.size} selected
                </Badge>
              )}
            </div>

            {selectedItems.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Assign to:</span>
                <Select value={selectedSectionId ?? ""} onValueChange={setSelectedSectionId}>
                  <SelectTrigger className="w-[300px]">
                    <SelectValue placeholder="Select a section..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sectionsWithOther.map((section) => (
                      <SelectItem key={section.sectionId} value={section.sectionId}>
                        {section.isOther ? (
                          <span className="italic text-muted-foreground">
                            {section.code} {section.name}
                          </span>
                        ) : (
                          `${section.code} — ${section.name}`
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleBulkAssign}
                  disabled={!selectedSectionId || isAssigning}
                  size="sm"
                >
                  {isAssigning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    "Assign"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedItems(new Set())}
                  size="sm"
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        )}

        {exceptions.length === 0 && (
          <p className="text-sm text-muted-foreground">No unassigned items.</p>
        )}

        {exceptions.map((exception) => (
          <div
            key={exception.responseItemId}
            className={cn(
              "rounded-md border p-3 transition-colors",
              selectedItems.has(exception.responseItemId) && "border-primary bg-primary/5"
            )}
          >
            <div className="flex items-start gap-3">
              {canAssign && (
                <input
                  type="checkbox"
                  checked={selectedItems.has(exception.responseItemId)}
                  onChange={() => handleToggleItem(exception.responseItemId)}
                  className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300"
                />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{exception.description}</p>
                  <Badge variant="outline">{exception.contractorName}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>
                    Section: {exception.attachedSectionId ? exception.attachedSectionId : "Unassigned"}
                  </span>
                  {typeof exception.amount === "number" && <span>Amount: ${exception.amount.toLocaleString()}</span>}
                </div>
                {exception.note && (
                  <p className="mt-2 text-sm text-muted-foreground">Note: {exception.note}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}