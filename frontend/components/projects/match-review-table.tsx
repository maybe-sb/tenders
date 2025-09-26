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
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ITT Item</TableHead>
            <TableHead>Response Item</TableHead>
            <TableHead className="w-32">Contractor</TableHead>
            <TableHead className="w-24 text-center">Confidence</TableHead>
            <TableHead className="w-24 text-center">Status</TableHead>
            <TableHead className="w-48 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.matchId}>
              <TableCell>
                <p className="font-medium">{row.ittDescription}</p>
              </TableCell>
              <TableCell>
                {row.responseItem ? (
                  <div className="space-y-1">
                    <p className="font-medium">{row.responseItem.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.responseItem.itemCode ?? "No code"}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No response item selected</p>
                )}
              </TableCell>
              <TableCell>{row.contractorName}</TableCell>
              <TableCell className="text-center">{Math.round(row.confidence * 100)}%</TableCell>
              <TableCell className="text-center">
                <Badge variant={STATUS_STYLES[row.status] as never}>{row.status}</Badge>
              </TableCell>
              <TableCell className="space-x-2 text-right">
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
