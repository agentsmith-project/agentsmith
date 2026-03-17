'use client';

import { useParams } from 'next/navigation';
import { WorkspaceProjectsEntryPage } from '@/components/workspaces/WorkspaceProjectsEntryPage';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function ProjectsPage() {
  const params = useParams<{ workspace?: string }>();
  const workspaceId = validateWorkspaceParam(params?.workspace);

  return <WorkspaceProjectsEntryPage showBackLink workspaceIdOverride={workspaceId} />;
}
