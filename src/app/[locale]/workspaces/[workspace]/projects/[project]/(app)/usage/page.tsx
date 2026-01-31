/**
 * Usage Page
 *
 * View usage statistics for the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, Activity } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const { data: kpiData, isLoading: kpiLoading } = useQuery({
    queryKey: ['usage', 'kpi', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/usage/kpi`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const kpi = kpiData || {};

  const stats = [
    { label: 'Total Requests', value: kpi.total_requests || 0, icon: Activity, color: 'text-blue-500' },
    { label: 'Total Errors', value: kpi.total_errors || 0, icon: TrendingUp, color: 'text-red-500' },
    { label: 'Total Tokens', value: (kpi.total_tokens || 0).toLocaleString(), icon: BarChart3, color: 'text-green-500' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Usage Statistics</h1>
        <p className="text-muted-foreground">Monitor API usage and performance metrics</p>
      </div>

      {kpiLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading statistics...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {stats.map((stat) => (
              <div key={stat.label} className="p-6 rounded-lg border bg-card">
                <div className="flex items-center gap-3 mb-2">
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-lg border bg-card">
            <h2 className="font-semibold mb-4">Agent Activity</h2>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Active Agents</span>
                <span>{kpi.active_agents || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Online Agents</span>
                <span>{kpi.online_agents || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Queued Turns</span>
                <span>{kpi.queued_turns || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Running Turns</span>
                <span>{kpi.running_turns || 0}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
