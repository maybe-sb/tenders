"use client";

import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { ITTItem, ResponseItem } from "@/types/tenders";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/currency";

interface DnDPanelProps {
  ittItems: ITTItem[];
  responseItems: ResponseItem[];
  onManualMatch: (ittItemId: string, responseItemId: string) => void;
  emptyState?: ReactNode;
}

// Format hierarchical section information for display
function formatHierarchy(itt: ITTItem): string {
  const parts = [];

  // Extract section code from item code (e.g., "5.4.1.13" -> "5")
  const sectionCode = itt.itemCode.split('.')[0];

  // Add section if available
  if (itt.sectionName && sectionCode) {
    parts.push(`${sectionCode}. ${itt.sectionName}`);
  } else if (itt.sectionName) {
    parts.push(itt.sectionName);
  }

  // Add sub-section if available
  if (itt.subSectionName && itt.subSectionCode) {
    parts.push(`${itt.subSectionCode}. ${itt.subSectionName}`);
  } else if (itt.subSectionCode) {
    parts.push(`Sub-section: ${itt.subSectionCode}`);
  }

  // Join with arrow if we have multiple parts, otherwise fallback to section code
  if (parts.length > 0) {
    return parts.join(" → ");
  }

  // Fallback to section code if no hierarchy info available
  return `Section: ${sectionCode}`;
}

// Natural sort function for hierarchical item codes like "1.1.1", "1.1.10", "1.2.1"
function naturalSort(a: string, b: string): number {
  const aParts = a.split('.').map(part => {
    const num = parseInt(part, 10);
    return isNaN(num) ? part : num;
  });
  const bParts = b.split('.').map(part => {
    const num = parseInt(part, 10);
    return isNaN(num) ? part : num;
  });

  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (typeof aPart === 'number' && typeof bPart === 'number') {
      if (aPart !== bPart) return aPart - bPart;
    } else {
      const comparison = String(aPart).localeCompare(String(bPart));
      if (comparison !== 0) return comparison;
    }
  }

  return 0;
}

export function DnDPanel({ ittItems, responseItems, onManualMatch, emptyState }: DnDPanelProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [filterText, setFilterText] = useState("");

  // Filter and sort ITT items
  const filteredAndSortedIttItems = useMemo(() => {
    let filtered = ittItems;

    // Apply text filter
    if (filterText.trim()) {
      const searchTerm = filterText.toLowerCase().trim();
      filtered = ittItems.filter(item =>
        item.itemCode.toLowerCase().includes(searchTerm) ||
        item.description.toLowerCase().includes(searchTerm) ||
        item.sectionId.toLowerCase().includes(searchTerm) ||
        (item.sectionName && item.sectionName.toLowerCase().includes(searchTerm)) ||
        (item.subSectionCode && item.subSectionCode.toLowerCase().includes(searchTerm)) ||
        (item.subSectionName && item.subSectionName.toLowerCase().includes(searchTerm))
      );
    }

    // Sort by item code using natural sorting
    return [...filtered].sort((a, b) => naturalSort(a.itemCode, b.itemCode));
  }, [ittItems, filterText]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || !event.active?.id) return;
    const responseItemId = String(event.active.id);
    const ittItemId = String(event.over.id);
    onManualMatch(ittItemId, responseItemId);
  };

  const clearFilter = () => setFilterText("");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <h3 className="mb-4 text-lg font-semibold">Unmatched Response Items</h3>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {responseItems.length === 0 && emptyState}
            {responseItems.map((item) => (
              <DraggableCard key={item.responseItemId} id={item.responseItemId}>
                <p className="font-medium">{item.description}</p>
                <p className="text-xs text-muted-foreground">
                  {item.itemCode ?? "No code"}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {item.qty !== undefined && (
                    <span>Qty: {item.qty.toLocaleString()}</span>
                  )}
                  {item.unit && (
                    <span>Unit: {item.unit}</span>
                  )}
                  {item.rate !== undefined && (
                    <span>Rate: ${formatAmount(item.rate)}</span>
                  )}
                  {item.amount !== undefined ? (
                    <span>Amount: ${formatAmount(item.amount)}</span>
                  ) : item.amountLabel ? (
                    <span>Amount: {item.amountLabel}</span>
                  ) : null}
                </div>
              </DraggableCard>
            ))}
          </div>
        </ScrollArea>
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">ITT Items</h3>
          <span className="text-sm text-muted-foreground">Drag response items into an ITT row</span>
        </div>

        {/* Filter Input */}
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by code, description, section, or sub-section..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-9 pr-9"
          />
          {filterText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilter}
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <ScrollArea className="mt-4 h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedIttItems.map((itt) => (
                  <DroppableRow key={itt.ittItemId} id={itt.ittItemId}>
                    <TableCell className="font-medium">{itt.itemCode}</TableCell>
                    <TableCell>
                      <p>{itt.description}</p>
                      <div className="text-xs text-muted-foreground">
                        {formatHierarchy(itt)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{itt.qty}</TableCell>
                  </DroppableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DndContext>
      </Card>
    </div>
  );
}

function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { transform, listeners, setNodeRef, setActivatorNodeRef, attributes, isDragging } =
    useDraggable({ id });

  const style = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-md border bg-card p-3 shadow-sm transition",
        isDragging && "opacity-70"
      )}
    >
      {children}
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="sm"
        className="mt-2 w-full"
        type="button"
        {...listeners}
        {...attributes}
      >
        Drag to match
      </Button>
    </div>
  );
}

function DroppableRow({ id, children }: { id: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <TableRow
      ref={setNodeRef}
      className={cn(isOver ? "bg-primary/10" : undefined, "transition-colors")}
    >
      {children}
    </TableRow>
  );
}
