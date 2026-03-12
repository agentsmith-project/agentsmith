import { SystemWorkspacesPage } from '@/components/system/SystemWorkspacesPage';
import { requireSystemAdmin } from '@/lib/system-admin/session';

interface SystemWorkspacesRouteProps {
  params: Promise<{ locale: string }>;
}

export default async function SystemWorkspacesRoute({ params }: SystemWorkspacesRouteProps) {
  const { locale } = await params;
  await requireSystemAdmin(locale);
  return <SystemWorkspacesPage />;
}
