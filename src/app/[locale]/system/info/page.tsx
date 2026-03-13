import { SystemInfoPage } from '@/components/system/SystemInfoPage';
import { getSystemInfoSnapshot } from '@/lib/system-admin/system-info';
import { requireSystemAdmin } from '@/lib/system-admin/session';

interface SystemInfoRouteProps {
  params: Promise<{ locale: string }>;
}

export default async function SystemInfoRoute({ params }: SystemInfoRouteProps) {
  const { locale } = await params;
  await requireSystemAdmin(locale);
  return <SystemInfoPage snapshot={await getSystemInfoSnapshot()} />;
}
