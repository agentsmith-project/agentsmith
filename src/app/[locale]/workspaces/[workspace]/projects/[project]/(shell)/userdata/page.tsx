import { PageState } from '@/components/layout/PageState';
import { UserDataPage } from '@/components/userdata/UserDataPage';

interface UserdataPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default async function UserdataPage({ params }: UserdataPageProps) {
  const { workspace, project } = await params;
  return (
    <PageState state="success">
      <UserDataPage workspaceId={workspace} projectId={project} />
    </PageState>
  );
}
