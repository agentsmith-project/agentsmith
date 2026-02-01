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

export default function OverviewPage() {
  const params = useParams();
  const workspaceId = params.workspace as string;
  const projectId = params.project as string;
  const locale = (params.locale as string) || 'en-US';
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const apiClient = getApiClient();
  const usageAPI = new UsageAPI(apiClient);
  const auditAPI = new AuditAPI(apiClient);

  // Fetch KPI data
  const { data: kpiData } = useQuery({
    queryKey: ['usage', 'kpi', workspaceId, projectId],
    queryFn: () => usageAPI.getKPI(workspaceId, projectId),
  });

  // Fetch recent activity
  const { data: auditEvents } = useQuery({
    queryKey: ['audit', workspaceId, projectId],
    queryFn: () => auditAPI.list(workspaceId, projectId, { page: 1, page_size: 5 }),
  });

  // Mock KPI data if not loaded
  const kpi = kpiData || {
    total_requests: 4523,
    total_errors: 23,
    total_tokens: 2456000,
    active_agents: 4,
    online_agents: 2,
    queued_turns: 12,
    running_turns: 5,
  };

  // Format numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
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
          label="Total Turns"
          value={formatNumber(kpi.total_requests)}
          trend={{ value: '+12%', direction: 'up' }}
        />
        <KPICard
          icon={AlertCircle}
          label="Errors"
          value={kpi.total_errors.toString()}
          trend={{ value: '-5%', direction: 'down' }}
        />
        <KPICard
          icon={Clock}
          label="Queued Turns"
          value={kpi.queued_turns.toString()}
        />
        <KPICard
          icon={Wifi}
          label="Online Agents"
          value={`${kpi.online_agents}/${kpi.active_agents}`}
        />
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
