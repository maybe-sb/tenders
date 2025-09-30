"use client";

import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/currency";
import type { ResponseItem, SectionSummary } from "@/types/tenders";

interface DnDPanelProps {
  sections: SectionSummary[];
  responseItems: ResponseItem[];
  onAssignSection: (sectionId: string, responseItemId: string) => void | Promise<void>;
  emptyState?: ReactNode;
}

interface ManualMappingContentProps {
  layout: "compact" | "expanded";
  sections: SectionSummary[];
  responseItems: ResponseItem[];
  filterText: string;
  onFilterChange: (value: string) => void;
  onAssignSection: (sectionId: string, responseItemId: string) => void | Promise<void>;
  emptyState?: ReactNode;
}

export function DnDPanel({ sections, responseItems, onAssignSection, emptyState }: DnDPanelProps) {
  const [filterText, setFilterText] = useState("");
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Manual mapping</h3>
          <p className="text-sm text-muted-foreground">
            Assign unmatched response items to the sections they belong to.
          </p>
        </div>
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Expand view
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw]">
            <DialogHeader>
              <DialogTitle>Manual mapping</DialogTitle>
            </DialogHeader>
            <ManualMappingContent
              layout="expanded"
              sections={sections}
              responseItems={responseItems}
              filterText={filterText}
              onFilterChange={setFilterText}
              onAssignSection={onAssignSection}
              emptyState={emptyState}
            />
          </DialogContent>
        </Dialog>
      </div>

      <ManualMappingContent
        layout="compact"
        sections={sections}
        responseItems={responseItems}
        filterText={filterText}
        onFilterChange={setFilterText}
        onAssignSection={onAssignSection}
        emptyState={emptyState}
      />
    </Card>
  );
}

function ManualMappingContent({
  layout,
  sections,
  responseItems,
  filterText,
  onFilterChange,
  onAssignSection,
  emptyState,
}: ManualMappingContentProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const filteredSections = useMemo(() => {
    const search = filterText.trim().toLowerCase();
    const base = [...sections].sort((a, b) => a.order - b.order);
    if (!search) {
      return base;
    }
    return base.filter((section) =>
      section.code.toLowerCase().includes(search) || section.name.toLowerCase().includes(search)
    );
  }, [sections, filterText]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || !event.active?.id) return;
    const responseItemId = String(event.active.id);
    const sectionId = String(event.over.id);
    onAssignSection(sectionId, responseItemId);
  };

  const responseListHeight = layout === "expanded" ? "60vh" : "320px";
  const sectionListHeight = layout === "expanded" ? "60vh" : "320px";

  return (
    <div
      className={cn(
        "mt-4 grid gap-4",
        layout === "expanded" ? "lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.3fr)]" : "lg:grid-cols-2"
      )}
    >
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold">Unmatched response items</h4>
          <span className="text-xs text-muted-foreground">Drag an item onto a section</span>
        </div>
        <ScrollArea className="mt-4 pr-2" style={{ maxHeight: responseListHeight }}>
          <div className="space-y-3">
            {responseItems.length === 0 ? emptyState : null}
            {responseItems.map((item) => (
              <DraggableResponseCard key={item.responseItemId} item={item} />
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-base font-semibold">ITT sections</h4>
          <span className="text-xs text-muted-foreground">Drop a response onto its section</span>
        </div>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter sections by code or name"
            value={filterText}
            onChange={(event) => onFilterChange(event.target.value)}
            className="pl-9"
          />
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <ScrollArea className="mt-4 pr-2" style={{ maxHeight: sectionListHeight }}>
            <div className="space-y-3">
              {filteredSections.map((section) => (
                <DroppableSectionCard key={section.sectionId} section={section} />
              ))}
              {filteredSections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sections match this filter.</p>
              ) : null}
            </div>
          </ScrollArea>
        </DndContext>
      </Card>
    </div>
  );
}

function DraggableResponseCard({ item }: { item: ResponseItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.responseItemId });

  const style = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab rounded-md border bg-card p-3 shadow-sm transition hover:border-primary/60 active:cursor-grabbing",
        isDragging && "border-primary bg-primary/5"
      )}
      {...listeners}
      {...attributes}
    >
      <p className="font-medium leading-tight">{item.description}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{item.itemCode ?? "No code"}</span>
        {item.qty !== undefined && <span>Qty: {item.qty.toLocaleString()}</span>}
        {item.unit && <span>Unit: {item.unit}</span>}
        {item.rate !== undefined && <span>Rate: ${formatAmount(item.rate)}</span>}
        {item.amount !== undefined ? (
          <span>Amount: ${formatAmount(item.amount)}</span>
        ) : item.amountLabel ? (
          <span>Amount: {item.amountLabel}</span>
        ) : null}
      </div>
    </div>
  );
}

function DroppableSectionCard({ section }: { section: SectionSummary }) {
  const { isOver, setNodeRef } = useDroppable({ id: section.sectionId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md border p-4 transition",
        isOver ? "border-primary bg-primary/10" : "hover:border-primary/40"
      )}
    >
      <p className="text-sm font-semibold leading-tight">
        {section.code} — {section.name}
      </p>
    </div>
  );
}
