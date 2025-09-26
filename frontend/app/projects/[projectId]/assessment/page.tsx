import { notFound } from "next/navigation";

import { AssessmentScreen } from "@/components/projects/assessment-screen";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function AssessmentPage({ params }: PageProps) {
  const { projectId } = await params;

  if (!projectId) {
    notFound();
  }

  return <AssessmentScreen projectId={projectId} />;
}
