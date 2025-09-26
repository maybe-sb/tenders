import { notFound } from "next/navigation";

import { AssessmentScreen } from "@/components/projects/assessment-screen";

interface PageProps {
  params: { projectId: string };
}

export default function AssessmentPage({ params }: PageProps) {
  const projectId = params.projectId;

  if (!projectId) {
    notFound();
  }

  return <AssessmentScreen projectId={projectId} />;
}
