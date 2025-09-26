import { notFound } from "next/navigation";

import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";

interface PageProps {
  params: { projectId: string };
}

export default function ProjectDetailPage({ params }: PageProps) {
  const projectId = params.projectId;

  if (!projectId) {
    notFound();
  }

  return <ProjectDetailScreen projectId={projectId} />;
}
