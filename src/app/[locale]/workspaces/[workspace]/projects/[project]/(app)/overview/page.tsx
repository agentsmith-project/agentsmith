/**
 * Overview Page (Simplified)
 *
 * Project overview dashboard with KPI cards and navigation.
 */

'use client';

import { KPICard, ProjectNavigation, ActivityTimeline } from '@/components/dashboard';
import { useParams } from 'next/navigation';
import { Activity, AlertCircle, Clock, Wifi } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { UsageAPI, AuditAPI } from '@/lib/api';
import { getApiClient } from '@/lib/api';
import { validateUsageKPI } from '@/lib/api/validators';
import { formatNumber } from '@/lib/utils/formatters';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';

export default function OverviewPage() {
  const params = useParams();
  const workspaceId = params.workspace as string;
  const projectId = params.project as string;
  const locale = (params.locale as string) || 'en-US';
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  // Sync auth store from URL parameters
  useSyncAuthFromUrl();

  const apiClient = getApiClient();
  const usageAPI = new UsageAPI(apiClient);
  const auditAPI = new AuditAPI(apiClient);

  // Fetch KPI data with validation
  const { data: kpiData } = useQuery({
    queryKey: ['usage', 'kpi', workspaceId, projectId],
    queryFn: async () => {
      const data = await usageAPI.getKPI(workspaceId, projectId);
      return validateUsageKPI(data);
    },
  });

  // Fetch recent activity
  const { data: auditEvents } = useQuery({
    queryKey: ['audit', workspaceId, projectId],
    queryFn: () => auditAPI.list(workspaceId, projectId, { page: 1, page_size: 5 }),
  });

  // Use validated KPI data with safe defaults
  const kpi = kpiData || {
    requests_today: 0,
    errors_today: 0,
  };

  // Activity timeline items (will be replaced with real audit data)
  const activityItems = auditEvents?.items.map((event) => ({
    id: event.id,
    icon: Activity,
    title: `${event.actor_type === 'user' ? 'User' : 'Agent'} ${event.action}`,
    description: event.resource_type ? `${event.resource_type}: ${event.resource_id}` : undefined,
    timestamp: new Date(event.timestamp).toLocaleString(),
    copyableId: event.request_id,
  })) || [];

  return (
    <div className="p-6 space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-semibold text-primary">Overview</h1>
        <p className="text-secondary mt-1">Project dashboard and quick navigation</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={Activity}
          label="Requests Today"
          value={formatNumber(kpi.requests_today)}
          trend={kpi.requests_yesterday !== undefined ? {
            value: `${((kpi.requests_today - kpi.requests_yesterday) / kpi.requests_yesterday * 100).toFixed(1)}%`,
            direction: kpi.requests_today >= kpi.requests_yesterday ? 'up' : 'down',
          } : undefined}
        />
        <KPICard
          icon={AlertCircle}
          label="Errors Today"
          value={formatNumber(kpi.errors_today)}
          trend={kpi.errors_yesterday !== undefined ? {
            value: `${((kpi.errors_today - kpi.errors_yesterday) / kpi.errors_yesterday * 100).toFixed(1)}%`,
            direction: kpi.errors_today >= kpi.errors_yesterday ? 'up' : 'down',
          } : undefined}
        />
        {kpi.tokens_today !== undefined && (
          <KPICard
            icon={Clock}
            label="Tokens Today"
            value={formatNumber(kpi.tokens_today)}
          />
        )}
        {kpi.userdata_bytes !== undefined && (
          <KPICard
            icon={Wifi}
            label="UserData Storage"
            value={formatNumber(kpi.userdata_bytes)}
          />
        )}
      </div>

      {/* Project Navigation */}
      <div>
        <h2 className="text-lg font-semibold text-primary mb-4">Quick Access</h2>
        <ProjectNavigation basePath={basePath} columns={3} />
      </div>

      {/* Recent Activity */}
      <div>
        <ActivityTimeline
          items={activityItems}
          maxItems={5}
          viewAllLink={`${basePath}/audit`}
        />
      </div>
    </div>
  );
}
