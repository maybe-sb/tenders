import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MatchStatus, ResponseItem } from "@/types/tenders";
import { useState, useRef, useCallback } from "react";

interface MatchReviewRow {
  matchId: string;
  ittDescription: string;
  contractorName: string;
  responseItem?: Pick<ResponseItem, "description" | "itemCode" | "amount"> & {
    amount?: number;
  };
  status: MatchStatus;
  confidence: number;
}

interface MatchReviewTableProps {
  rows: MatchReviewRow[];
  onAccept: (matchId: string) => void;
  onReject: (matchId: string) => void;
  onOpenManual?: (matchId: string) => void;
}

const STATUS_STYLES: Record<MatchStatus, string> = {
  suggested: "secondary",
  accepted: "default",
  rejected: "destructive",
  manual: "outline",
};

export function MatchReviewTable({ rows, onAccept, onReject, onOpenManual }: MatchReviewTableProps) {
  const [columnWidths, setColumnWidths] = useState({
    ittItem: 300,
    responseItem: 300,
    contractor: 150,
    confidence: 100,
    status: 100,
    actions: 200,
  });

  const tableRef = useRef<HTMLTableElement>(null);
  const isResizing = useRef<string | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent, column: string) => {
    e.preventDefault();
    isResizing.current = column;
    startX.current = e.clientX;
    startWidth.current = columnWidths[column as keyof typeof columnWidths];

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;

    const diff = e.clientX - startX.current;
    const newWidth = Math.max(50, startWidth.current + diff);

    setColumnWidths(prev => ({
      ...prev,
      [isResizing.current!]: newWidth,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleMouseMove]);

  const ResizeHandle = ({ column }: { column: string }) => (
    <div
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-500 hover:opacity-50"
      onMouseDown={(e) => handleMouseDown(e, column)}
    />
  );

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table ref={tableRef} style={{ tableLayout: 'fixed', width: '100%' }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: columnWidths.ittItem, position: 'relative' }}>
              ITT Item
              <ResizeHandle column="ittItem" />
            </TableHead>
            <TableHead style={{ width: columnWidths.responseItem, position: 'relative' }}>
              Response Item
              <ResizeHandle column="responseItem" />
            </TableHead>
            <TableHead style={{ width: columnWidths.contractor, position: 'relative' }}>
              Contractor
              <ResizeHandle column="contractor" />
            </TableHead>
            <TableHead
              style={{ width: columnWidths.confidence, position: 'relative' }}
              className="text-center"
            >
              Confidence
              <ResizeHandle column="confidence" />
            </TableHead>
            <TableHead
              style={{ width: columnWidths.status, position: 'relative' }}
              className="text-center"
            >
              Status
              <ResizeHandle column="status" />
            </TableHead>
            <TableHead
              style={{ width: columnWidths.actions, position: 'relative' }}
              className="text-right"
            >
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.matchId}>
              <TableCell style={{ width: columnWidths.ittItem, overflow: 'hidden' }}>
                <p className="font-medium truncate" title={row.ittDescription}>
                  {row.ittDescription}
                </p>
              </TableCell>
              <TableCell style={{ width: columnWidths.responseItem, overflow: 'hidden' }}>
                {row.responseItem ? (
                  <div className="space-y-1">
                    <p className="font-medium truncate" title={row.responseItem.description}>
                      {row.responseItem.description}
                    </p>
                    <p className="text-xs text-muted-foreground truncate" title={row.responseItem.itemCode ?? "No code"}>
                      {row.responseItem.itemCode ?? "No code"}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No response item selected</p>
                )}
              </TableCell>
              <TableCell style={{ width: columnWidths.contractor, overflow: 'hidden' }}>
                <span className="truncate" title={row.contractorName}>
                  {row.contractorName}
                </span>
              </TableCell>
              <TableCell
                style={{ width: columnWidths.confidence, overflow: 'hidden' }}
                className="text-center"
              >
                {Math.round(row.confidence * 100)}%
              </TableCell>
              <TableCell
                style={{ width: columnWidths.status, overflow: 'hidden' }}
                className="text-center"
              >
                <Badge variant={STATUS_STYLES[row.status] as never}>{row.status}</Badge>
              </TableCell>
              <TableCell
                style={{ width: columnWidths.actions, overflow: 'hidden' }}
                className="space-x-2 text-right"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAccept(row.matchId)}
                  disabled={row.status === "accepted"}
                >
                  Accept
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReject(row.matchId)}
                  disabled={row.status === "rejected"}
                >
                  Reject
                </Button>
                {onOpenManual && (
                  <Button variant="ghost" size="sm" onClick={() => onOpenManual(row.matchId)}>
                    Manual
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
