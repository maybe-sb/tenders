import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/projects/status-badge";
import { TenderProject } from "@/types/tenders";

interface ProjectCardProps {
  project: TenderProject;
  onDelete?: (projectId: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-xl font-semibold">{project.name}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Updated {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6 text-sm text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">Contractors</p>
          <p>{project.stats?.contractors ?? 0}</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Matched Items</p>
          <p>
            {project.stats?.matchedItems ?? 0} / {project.stats?.ittItems ?? 0}
          </p>
        </div>
        <div>
          <p className="font-medium text-foreground">Exceptions</p>
          <p>{project.stats?.unmatchedItems ?? 0}</p>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t px-6 py-4">
        <Link href={`/projects/${project.projectId}`}>
          <Button>Open Project</Button>
        </Link>
        {onDelete && (
          <Button variant="destructive" size="sm" onClick={() => onDelete(project.projectId)}>
            Delete
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
