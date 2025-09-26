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
import { ReactNode } from "react";

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
import { ITTItem, ResponseItem } from "@/types/tenders";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DnDPanelProps {
  ittItems: ITTItem[];
  responseItems: ResponseItem[];
  onManualMatch: (ittItemId: string, responseItemId: string) => void;
  emptyState?: ReactNode;
}

export function DnDPanel({ ittItems, responseItems, onManualMatch, emptyState }: DnDPanelProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || !event.active?.id) return;
    const responseItemId = String(event.active.id);
    const ittItemId = String(event.over.id);
    onManualMatch(ittItemId, responseItemId);
  };

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
                {item.amount !== undefined && (
                  <p className="text-sm text-muted-foreground">
                    Amount: {item.amount?.toLocaleString?.() ?? "-"}
                  </p>
                )}
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
                {ittItems.map((itt) => (
                  <DroppableRow key={itt.ittItemId} id={itt.ittItemId}>
                    <TableCell className="font-medium">{itt.itemCode}</TableCell>
                    <TableCell>
                      <p>{itt.description}</p>
                      <p className="text-xs text-muted-foreground">Section: {itt.sectionId}</p>
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
