"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { closestCenter } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/currency";
import type { ResponseItem, SectionSummary, ExceptionRecord } from "@/types/tenders";

const OTHER_SECTION_ID = "__OTHER__";

interface DnDPanelProps {
  sections: SectionSummary[];
  responseItems: ResponseItem[];
  exceptions: ExceptionRecord[];
  onAssignSection: (sectionId: string, responseItemId: string) => void | Promise<void>;
  emptyState?: ReactNode;
}

interface ManualMappingContentProps {
  layout: "compact" | "expanded";
  sections: SectionSummary[];
  responseItems: ResponseItem[];
  exceptions: ExceptionRecord[];
  filterText: string;
  onFilterChange: (value: string) => void;
  onAssignSection: (sectionId: string, responseItemId: string) => void | Promise<void>;
  emptyState?: ReactNode;
}

export function DnDPanel({ sections, responseItems, exceptions, onAssignSection, emptyState }: DnDPanelProps) {
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
          <DialogContent className="max-w-[95vw] sm:max-w-[95vw]">
            <DialogHeader>
              <DialogTitle>Manual mapping</DialogTitle>
            </DialogHeader>
            <ManualMappingContent
              layout="expanded"
              sections={sections}
              responseItems={responseItems}
              exceptions={exceptions}
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
        exceptions={exceptions}
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
  exceptions,
  filterText,
  onFilterChange,
  onAssignSection,
  emptyState,
}: ManualMappingContentProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const filteredSections = useMemo(() => {
    const search = filterText.trim().toLowerCase();
    const base = [...sections].sort((a, b) => a.order - b.order);

    // Calculate unassigned exception count for "Other" section
    const unassignedCount = exceptions.filter(e => !e.attachedSectionId).length;

    // Get the max order to position "Other" at the end
    const maxOrder = sections.length > 0 ? Math.max(...sections.map(s => s.order)) : 0;

    // Create synthetic "Other" section
    const otherSection: SectionSummary = {
      sectionId: OTHER_SECTION_ID,
      code: "—",
      name: "Other / Unclassified",
      order: maxOrder + 1,
      totalsByContractor: {},
      totalITTAmount: 0,
      exceptionCount: unassignedCount,
    };

    // Filter real sections based on search
    const filtered = search
      ? base.filter((section) =>
          section.code.toLowerCase().includes(search) || section.name.toLowerCase().includes(search)
        )
      : base;

    // Always append "Other" section at the end
    return [...filtered, otherSection];
  }, [sections, filterText, exceptions]);

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active?.id) {
      setActiveId(String(event.active.id));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (!event.over || !event.active?.id) return;
    const responseItemId = String(event.active.id);
    const sectionId = String(event.over.id);
    onAssignSection(sectionId, responseItemId);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const responseListHeight = layout === "expanded" ? "60vh" : "320px";
  const sectionListHeight = layout === "expanded" ? "60vh" : "320px";

  const dragOverlay = (
    <DragOverlay>
      {activeId ? (
        <DraggingPreview item={responseItems.find((item) => item.responseItemId === activeId)} />
      ) : null}
    </DragOverlay>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
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
        </Card>
      </div>
      {layout === "expanded" && typeof document !== "undefined"
        ? createPortal(dragOverlay, document.body)
        : dragOverlay}
    </DndContext>
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
        "select-none touch-none cursor-grab rounded-md border bg-card p-3 shadow-sm transition hover:border-primary/60 active:cursor-grabbing",
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
  const isOtherSection = section.sectionId === OTHER_SECTION_ID;

  return (
    <div
      ref={setNodeRef}
      data-droppable
      className={cn(
        "rounded-md border p-4 transition",
        isOver ? "border-[#27ABE2] bg-[#27ABE2]/10" : "hover:border-primary/40",
        isOtherSection && "border-dashed bg-muted/30"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold leading-tight">
          {section.code} — {section.name}
        </p>
        {isOtherSection && (
          <Badge variant="secondary" className="text-xs">
            Special
          </Badge>
        )}
      </div>
      {isOtherSection && section.exceptionCount > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {section.exceptionCount} unassigned item{section.exceptionCount !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

function DraggingPreview({ item }: { item?: ResponseItem }) {
  if (!item) {
    return null;
  }

  return (
    <div className="pointer-events-none w-64 rounded-md border bg-card p-3 shadow-lg">
      <p className="text-sm font-medium leading-tight">{item.description}</p>
      <p className="text-xs text-muted-foreground">{item.itemCode ?? "No code"}</p>
    </div>
  );
}
