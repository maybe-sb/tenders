import { notFound } from "next/navigation";

import { ProjectDetailScreen } from "@/components/projects/project-detail-screen";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { projectId } = await params;

  if (!projectId) {
    notFound();
  }

  return <ProjectDetailScreen projectId={projectId} />;
}
