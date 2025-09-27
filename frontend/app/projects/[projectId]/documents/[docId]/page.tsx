import { DocumentDetailScreen } from "@/components/projects/document-detail-screen";

interface DocumentDetailPageProps {
  params: Promise<{
    projectId: string;
    docId: string;
  }>;
}

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { projectId, docId } = await params;
  return <DocumentDetailScreen projectId={projectId} docId={docId} />;
}