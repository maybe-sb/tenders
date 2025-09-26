import { Badge } from "@/components/ui/badge";
import { ProjectStatus } from "@/types/tenders";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  finalized: "Finalized",
};

const STATUS_VARIANTS: Record<ProjectStatus, string> = {
  draft: "outline",
  in_review: "default",
  finalized: "secondary",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={STATUS_VARIANTS[status] as never}>{STATUS_LABELS[status]}</Badge>;
}
