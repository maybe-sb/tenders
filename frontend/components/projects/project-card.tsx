import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TenderProject } from "@/types/tenders";

interface ProjectCardProps {
  project: TenderProject;
  onDelete?: (projectId: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{project.name}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>
      </CardHeader>
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
