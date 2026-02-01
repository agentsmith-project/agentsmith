/**
 * Usage Page
 *
 * View usage statistics for the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';
import { BarChart3, TrendingUp, Activity, Calendar, DollarSign } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { PageLoading } from '@/components/ui/loading';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

interface UsageRecord {
  id: string;
  date: string;
  requests: number;
  tokens: number;
  cost: number;
  breakdown?: {
    agent_calls?: number;
    tool_calls?: number;
    api_calls?: number;
  };
}

const columnHelper = createColumnHelper<UsageRecord>();

const usageColumns = [
  columnHelper.accessor('date', {
    header: 'Date',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
        <span className="text-foreground text-sm">
          {new Date(info.getValue()).toLocaleDateString()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('requests', {
    header: 'Requests',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="text-foreground text-sm font-medium">
          {info.getValue().toLocaleString()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('tokens', {
    header: 'Tokens',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-green-500 flex-shrink-0" />
        <span className="text-foreground text-sm font-medium">
          {info.getValue().toLocaleString()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('cost', {
    header: 'Cost',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
        <span className="text-foreground text-sm font-medium">
          ${info.getValue().toFixed(4)}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('breakdown', {
    header: 'Breakdown',
    cell: (info) => {
      const breakdown = info.getValue();
      if (!breakdown) return <span className="text-foreground-secondary text-sm">-</span>;
      return (
        <div className="flex flex-col gap-1 text-xs">
          {breakdown.agent_calls && (
            <span className="text-foreground-secondary">Agent: {breakdown.agent_calls}</span>
          )}
          {breakdown.tool_calls && (
            <span className="text-foreground-secondary">Tool: {breakdown.tool_calls}</span>
          )}
          {breakdown.api_calls && (
            <span className="text-foreground-secondary">API: {breakdown.api_calls}</span>
          )}
        </div>
      );
    },
  }),
];

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

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['usage', 'details', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/usage`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-foreground-secondary">Loading...</div>
      </div>
    );
  }

  const kpi = kpiData || {};

  const stats = [
    { label: 'Total Requests', value: (kpi.total_requests || 0).toLocaleString(), icon: Activity, color: 'text-blue-500' },
    { label: 'Total Errors', value: (kpi.total_errors || 0).toLocaleString(), icon: TrendingUp, color: 'text-red-500' },
    { label: 'Total Tokens', value: (kpi.total_tokens || 0).toLocaleString(), icon: BarChart3, color: 'text-green-500' },
  ];

  const usageRecords = usageData?.items || [];

  const table = useReactTable({
    data: usageRecords,
    columns: usageColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Usage Statistics</h1>
        <p className="text-sm text-foreground-secondary mt-1">Monitor API usage and performance metrics</p>
      </div>

      {kpiLoading ? (
        <PageLoading />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {stats.map((stat) => (
              <div key={stat.label} className="p-6 rounded-lg border border-border bg-surface shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  <span className="text-sm text-foreground-secondary">{stat.label}</span>
                </div>
                <div className="text-2xl font-semibold text-foreground">{stat.value}</div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-lg border border-border bg-surface shadow-sm mb-8">
            <h2 className="font-semibold text-foreground mb-4">Agent Activity</h2>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-foreground-secondary">Active Agents</span>
                <span className="text-foreground">{kpi.active_agents || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground-secondary">Online Agents</span>
                <span className="text-foreground">{kpi.online_agents || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground-secondary">Queued Turns</span>
                <span className="text-foreground">{kpi.queued_turns || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground-secondary">Running Turns</span>
                <span className="text-foreground">{kpi.running_turns || 0}</span>
              </div>
            </div>
          </div>

          {usageLoading ? (
            <PageLoading />
          ) : usageRecords.length > 0 ? (
            <div className="rounded-lg overflow-hidden border border-border bg-surface shadow-sm">
              <div className="px-4 py-4 bg-surface-high border-b border-border">
                <h3 className="font-semibold text-foreground">Usage Breakdown</h3>
              </div>
              <table className="w-full border-collapse">
                <thead className="bg-surface-high">
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map(header => (
                        <th
                          key={header.id}
                          className="px-4 py-4 text-left text-sm font-medium text-foreground-secondary"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map(row => (
                    <tr
                      key={row.id}
                      className="hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 border-b border-border last:border-b-0"
                    >
                      {row.getVisibleCells().map(cell => (
                        <td
                          key={cell.id}
                          className="px-4 py-4 text-sm text-foreground"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
