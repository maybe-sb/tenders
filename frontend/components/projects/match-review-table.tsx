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
import { useState, useRef, useCallback, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

interface MatchReviewRow {
  matchId: string;
  ittDescription: string;
  contractorName: string;
  responseItem?: Pick<ResponseItem, "description" | "itemCode" | "amount" | "qty" | "rate" | "unit"> & {
    amount?: number;
    qty?: number;
    rate?: number;
    unit?: string;
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

type SortColumn = 'ittDescription' | 'responseDescription' | 'contractorName' | 'confidence' | 'status';
type SortDirection = 'asc' | 'desc';

export function MatchReviewTable({ rows, onAccept, onReject, onOpenManual }: MatchReviewTableProps) {
  const [columnWidths, setColumnWidths] = useState({
    ittItem: 300,
    responseItem: 300,
    contractor: 150,
    confidence: 100,
    status: 100,
    actions: 200,
  });

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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

  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  }, [sortColumn]);

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;

    return [...rows].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortColumn) {
        case 'ittDescription':
          aValue = a.ittDescription;
          bValue = b.ittDescription;
          break;
        case 'responseDescription':
          aValue = a.responseItem?.description || '';
          bValue = b.responseItem?.description || '';
          break;
        case 'contractorName':
          aValue = a.contractorName;
          bValue = b.contractorName;
          break;
        case 'confidence':
          aValue = a.confidence;
          bValue = b.confidence;
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
      }

      const stringA = String(aValue).toLowerCase();
      const stringB = String(bValue).toLowerCase();

      if (sortDirection === 'desc') {
        return stringB.localeCompare(stringA);
      } else {
        return stringA.localeCompare(stringB);
      }
    });
  }, [rows, sortColumn, sortDirection]);

  const SortableHeader = ({ column, children, className = '' }: {
    column: SortColumn;
    children: React.ReactNode;
    className?: string;
  }) => {
    const isActive = sortColumn === column;
    return (
      <button
        className={`flex items-center gap-1 hover:bg-muted/50 px-2 py-1 rounded text-left w-full ${className}`}
        onClick={() => handleSort(column)}
      >
        {children}
        {isActive && (
          sortDirection === 'desc' ?
            <ChevronDown className="h-4 w-4" /> :
            <ChevronUp className="h-4 w-4" />
        )}
      </button>
    );
  };

  const ResizeHandle = ({ column }: { column: string }) => (
    <div
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-500 hover:opacity-50 z-10"
      onMouseDown={(e) => handleMouseDown(e, column)}
    />
  );

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table ref={tableRef} style={{ tableLayout: 'fixed', width: '100%' }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: columnWidths.ittItem, position: 'relative' }}>
              <SortableHeader column="ittDescription">ITT Item</SortableHeader>
              <ResizeHandle column="ittItem" />
            </TableHead>
            <TableHead style={{ width: columnWidths.responseItem, position: 'relative' }}>
              <SortableHeader column="responseDescription">Response Item</SortableHeader>
              <ResizeHandle column="responseItem" />
            </TableHead>
            <TableHead style={{ width: columnWidths.contractor, position: 'relative' }}>
              <SortableHeader column="contractorName">Contractor</SortableHeader>
              <ResizeHandle column="contractor" />
            </TableHead>
            <TableHead
              style={{ width: columnWidths.confidence, position: 'relative' }}
              className="text-center"
            >
              <SortableHeader column="confidence" className="justify-center">Confidence</SortableHeader>
              <ResizeHandle column="confidence" />
            </TableHead>
            <TableHead
              style={{ width: columnWidths.status, position: 'relative' }}
              className="text-center"
            >
              <SortableHeader column="status" className="justify-center">Status</SortableHeader>
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
          {sortedRows.map((row) => (
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
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      {row.responseItem.qty !== undefined && (
                        <span>Qty: {row.responseItem.qty.toLocaleString()}</span>
                      )}
                      {row.responseItem.unit && (
                        <span>Unit: {row.responseItem.unit}</span>
                      )}
                      {row.responseItem.rate !== undefined && (
                        <span>Rate: {row.responseItem.rate.toLocaleString()}</span>
                      )}
                      {row.responseItem.amount !== undefined && (
                        <span>Amount: {row.responseItem.amount.toLocaleString()}</span>
                      )}
                    </div>
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
                  className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                >
                  Accept
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReject(row.matchId)}
                  disabled={row.status === "rejected"}
                  className="bg-red-600 hover:bg-red-700 text-white border-red-600"
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
