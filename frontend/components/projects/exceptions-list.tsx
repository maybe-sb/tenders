import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExceptionRecord } from "@/types/tenders";

interface ExceptionsListProps {
  exceptions: ExceptionRecord[];
}

export function ExceptionsList({ exceptions }: ExceptionsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exceptions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {exceptions.length === 0 && (
          <p className="text-sm text-muted-foreground">No exceptions recorded.</p>
        )}
        {exceptions.map((exception) => (
          <div key={exception.responseItemId} className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{exception.description}</p>
              <Badge variant="outline">{exception.contractorName}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Response item: {exception.responseItemId}</span>
              <span>
                Section: {exception.attachedSectionId ? exception.attachedSectionId : "Unassigned"}
              </span>
              {typeof exception.amount === "number" && <span>Amount: {exception.amount}</span>}
            </div>
            {exception.note && (
              <p className="mt-2 text-sm text-muted-foreground">Note: {exception.note}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
