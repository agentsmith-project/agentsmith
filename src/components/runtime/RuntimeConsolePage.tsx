/**
 * Runtime Console Page
 *
 * Unified operations console combining runtime observability, alerts, control, and reports.
 * Part of the navigation restructure WP-02.
 *
 * **Permission Model**:
 * Each tab requires specific permission points. Tabs without permissions are hidden.
 * - Overview: project:usage:view
 * - Monitoring: project:usage:view
 * - Alerts: project:alert:view
 * - Control: project:settings:manage
 * - Reports: project:usage:view
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
import { useHasPermission } from '@/lib/hooks/use-permissions';

export type RuntimeConsoleTab = 'overview' | 'monitoring' | 'alerts' | 'control' | 'reports';

/** Tab configuration with required permissions */
interface TabConfig {
  value: RuntimeConsoleTab;
  labelKey: string;
  permission: string;
  testId: string;
}

/** Tab configurations with their required permissions */
const TAB_CONFIGS: readonly TabConfig[] = [
  { value: 'overview', labelKey: 'tabs.overview', permission: 'project:usage:view', testId: 'tabs-trigger-overview' },
  { value: 'monitoring', labelKey: 'tabs.monitoring', permission: 'project:usage:view', testId: 'tabs-trigger-monitoring' },
  { value: 'alerts', labelKey: 'tabs.alerts', permission: 'project:alert:view', testId: 'tabs-trigger-alerts' },
  { value: 'control', labelKey: 'tabs.control', permission: 'project:settings:manage', testId: 'tabs-trigger-control' },
  { value: 'reports', labelKey: 'tabs.reports', permission: 'project:usage:view', testId: 'tabs-trigger-reports' },
] as const;

export interface RuntimeConsolePageProps {
  workspaceId: string;
  projectId: string;
}

export function RuntimeConsolePage({
  workspaceId,
  projectId,
}: RuntimeConsolePageProps) {
  const t = useTranslations('runtime_console');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Check permissions for each tab - IMPORTANT: Each permission check is separate
  // to avoid hook short-circuiting (禁止 hook 短路)
  const canViewOverview = useHasPermission('project:usage:view');
  const canViewMonitoring = useHasPermission('project:usage:view');
  const canViewAlerts = useHasPermission('project:alert:view');
  const canViewControl = useHasPermission('project:settings:manage');
  const canViewReports = useHasPermission('project:usage:view');

  // Map of tab permissions
  const tabPermissions: Record<RuntimeConsoleTab, boolean> = React.useMemo(() => ({
    overview: canViewOverview,
    monitoring: canViewMonitoring,
    alerts: canViewAlerts,
    control: canViewControl,
    reports: canViewReports,
  }), [canViewOverview, canViewMonitoring, canViewAlerts, canViewControl, canViewReports]);

  // Filter tabs to only those user has permission for
  const accessibleTabs = React.useMemo(() => {
    return TAB_CONFIGS.filter(tab => tabPermissions[tab.value]);
  }, [tabPermissions]);

  // Get first accessible tab as fallback
  const firstAccessibleTab = React.useMemo(() => {
    return accessibleTabs[0]?.value ?? 'overview';
  }, [accessibleTabs]);

  // Read tab from URL query parameter, default to first accessible tab
  const [activeTab, setActiveTab] = React.useState<RuntimeConsoleTab>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'overview' || tabParam === 'monitoring' || tabParam === 'alerts' ||
        tabParam === 'control' || tabParam === 'reports') {
      const tab = tabParam as RuntimeConsoleTab;
      // Only allow if user has permission
      if (tabPermissions[tab]) {
        return tab;
      }
    }
    return firstAccessibleTab;
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
  // Also redirect to first accessible tab if current tab is not accessible
  React.useEffect(() => {
    const tabParam = searchParams.get('tab');
    let targetTab: RuntimeConsoleTab = 'overview';
    let needsUrlCorrection = false;

    if (tabParam === 'overview' || tabParam === 'monitoring' ||
        tabParam === 'alerts' || tabParam === 'control' ||
        tabParam === 'reports') {
      const requestedTab = tabParam as RuntimeConsoleTab;
      // If requested tab is accessible, use it; otherwise fall back to first accessible
      if (tabPermissions[requestedTab]) {
        targetTab = requestedTab;
        // Overview is the default tab, so we should remove the parameter
        if (targetTab === 'overview') {
          needsUrlCorrection = true;
        }
      } else {
        // User requested a tab they don't have permission for
        targetTab = firstAccessibleTab;
        needsUrlCorrection = true;
      }
    } else {
      // Invalid or unknown tab parameter - remove it and use default
      targetTab = firstAccessibleTab;
      needsUrlCorrection = true;
    }

    setActiveTab(targetTab);

    // Correct URL: remove invalid/unnecessary tab parameter
    if (needsUrlCorrection) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('tab'); // Always delete for correction (overview uses no param, others get set)
      if (targetTab !== 'overview') {
        params.set('tab', targetTab);
      }
      const correctedUrl = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      router.replace(correctedUrl, { scroll: false });
    }
  }, [searchParams, tabPermissions, firstAccessibleTab, pathname, router]);

  // If user has no accessible tabs, show permission denied
  if (accessibleTabs.length === 0) {
    return (
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
          />
        )}
      >
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
          <h2 className="text-lg font-semibold text-foreground">{t('permission_denied.title')}</h2>
          <p className="mt-2 text-sm text-tertiary">
            {t('permission_denied.message')}
          </p>
        </div>
      </PageLayout>
    );
  }

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
          {accessibleTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-testid={tab.testId}
            >
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Overview Tab - requires project:usage:view */}
        {canViewOverview && (
          <TabsContent value="overview" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <RuntimeObservabilityConsole
              workspaceId={workspaceId}
              projectId={projectId}
            />
          </TabsContent>
        )}

        {/* Monitoring Tab - requires project:usage:view */}
        {canViewMonitoring && (
          <TabsContent value="monitoring" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <RuntimeObservabilityConsole
              workspaceId={workspaceId}
              projectId={projectId}
            />
          </TabsContent>
        )}

        {/* Alerts Tab - requires project:alert:view */}
        {canViewAlerts && (
          <TabsContent value="alerts" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <AlertCenterPage
              workspaceId={workspaceId}
              projectId={projectId}
              embedded
            />
          </TabsContent>
        )}

        {/* Control Tab - requires project:settings:manage */}
        {canViewControl && (
          <TabsContent value="control" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <RuntimeControlPlanePanel
              workspaceId={workspaceId}
              projectId={projectId}
            />
          </TabsContent>
        )}

        {/* Reports Tab - requires project:usage:view */}
        {canViewReports && (
          <TabsContent value="reports" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <ReleaseOpsDashboard />
          </TabsContent>
        )}
      </Tabs>
    </PageLayout>
  );
}
