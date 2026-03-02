/**
 * Runtime Console Page
 *
 * Unified operations console combining runtime observability, alerts, control, and reports.
 * Part of the navigation restructure WP-02.
 */

'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { RuntimeObservabilityConsole } from '@/components/runtime/RuntimeObservabilityConsole';
import { AlertCenterPage } from '@/components/alerts/AlertCenterPage';
import { ReleaseOpsDashboard } from '@/components/runtime/ReleaseOpsDashboard';
import { RuntimeControlPlanePanel } from '@/components/settings/RuntimeControlPlanePanel';
import { cn } from '@/lib/utils';

export type RuntimeConsoleTab = 'overview' | 'monitoring' | 'alerts' | 'control' | 'reports';

export interface RuntimeConsolePageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
}

export function RuntimeConsolePage({
  workspaceId,
  projectId,
  locale = 'en-US',
}: RuntimeConsolePageProps) {
  const t = useTranslations('runtime_console');
  const commonT = useTranslations('common');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read tab from URL query parameter, default to 'overview'
  const [activeTab, setActiveTab] = React.useState<RuntimeConsoleTab>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'overview' || tabParam === 'monitoring' || tabParam === 'alerts' ||
        tabParam === 'control' || tabParam === 'reports') {
      return tabParam;
    }
    return 'overview';
  });

  // Update URL query parameter when tab changes
  const handleTabChange = React.useCallback((value: string) => {
    const newTab = value as RuntimeConsoleTab;
    setActiveTab(newTab);

    // Update URL without page refresh
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', newTab);
    }

    const newUrl = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    router.replace(newUrl, { scroll: false });
  }, [searchParams, pathname, router]);

  // Sync with URL changes (e.g., browser back/forward)
  React.useEffect(() => {
    const tabParam = searchParams.get('tab');
    const validTab = tabParam === 'overview' || tabParam === 'monitoring' ||
                     tabParam === 'alerts' || tabParam === 'control' ||
                     tabParam === 'reports' ? tabParam as RuntimeConsoleTab : 'overview';
    setActiveTab(validTab);
  }, [searchParams]);

  return (
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
        />
      )}
    >
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-h-0 flex flex-col min-w-0">
        <TabsList className="flex-shrink-0" data-testid="tabs">
          <TabsTrigger value="overview" data-testid="tabs-trigger-overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="monitoring" data-testid="tabs-trigger-monitoring">{t('tabs.monitoring')}</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tabs-trigger-alerts">{t('tabs.alerts')}</TabsTrigger>
          <TabsTrigger value="control" data-testid="tabs-trigger-control">{t('tabs.control')}</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tabs-trigger-reports">{t('tabs.reports')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
          <RuntimeObservabilityConsole
            workspaceId={workspaceId}
            projectId={projectId}
          />
        </TabsContent>

        <TabsContent value="monitoring" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
          <RuntimeObservabilityConsole
            workspaceId={workspaceId}
            projectId={projectId}
          />
        </TabsContent>

        <TabsContent value="alerts" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
          <AlertCenterPage
            workspaceId={workspaceId}
            projectId={projectId}
            embedded
          />
        </TabsContent>

        <TabsContent value="control" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
          <RuntimeControlPlanePanel
            workspaceId={workspaceId}
            projectId={projectId}
          />
        </TabsContent>

        <TabsContent value="reports" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
          <ReleaseOpsDashboard />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
