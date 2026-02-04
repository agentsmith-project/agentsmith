import { UserDataPage } from '@/components/userdata/UserDataPage';

interface UserdataPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default async function UserdataPage({ params }: UserdataPageProps) {
  const { workspace, project } = await params;
  return <UserDataPage workspaceId={workspace} projectId={project} />;
}
