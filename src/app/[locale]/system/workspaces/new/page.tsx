import { SystemWorkspaceCreatePage } from '@/components/system/SystemWorkspaceCreatePage';
import { requireSystemAdmin } from '@/lib/system-admin/session';

interface SystemWorkspaceCreateRouteProps {
  params: Promise<{ locale: string }>;
}

export default async function SystemWorkspaceCreateRoute({ params }: SystemWorkspaceCreateRouteProps) {
  const { locale } = await params;
  await requireSystemAdmin(locale);
  return <SystemWorkspaceCreatePage />;
}
