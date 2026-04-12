import { redirect } from 'next/navigation';

import { buildWorkspaceOverviewHref } from '@/lib/workspaces/workspace-paths';

interface WorkspacesRouteProps {
  params: Promise<{ locale: string }>;
}

export default async function WorkspacesRoute({ params }: WorkspacesRouteProps) {
  const { locale } = await params;
  redirect(buildWorkspaceOverviewHref(locale));
}
