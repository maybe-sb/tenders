import { ITTItem } from "@/types/tenders";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ItemTableProps {
  items: ITTItem[];
}

export function ItemTable({ items }: ItemTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-24">Unit</TableHead>
            <TableHead className="w-24 text-right">Qty</TableHead>
            <TableHead className="w-24 text-right">Rate</TableHead>
            <TableHead className="w-32 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.ittItemId}>
              <TableCell className="font-medium">{item.itemCode}</TableCell>
              <TableCell>{item.description}</TableCell>
              <TableCell>{item.unit}</TableCell>
              <TableCell className="text-right">{item.qty.toLocaleString()}</TableCell>
              <TableCell className="text-right">{item.rate.toLocaleString()}</TableCell>
              <TableCell className="text-right">{item.amount.toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
