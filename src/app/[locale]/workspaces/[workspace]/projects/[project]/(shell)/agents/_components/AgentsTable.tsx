'use client';

import * as React from 'react';
import { createColumnHelper, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Bot, Key, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';

import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

import type { AgentStatusUpdateInput, AgentsPageAgent } from '../agents-page-types';
import { formatDuration } from '../agents-page-utils';

const columnHelper = createColumnHelper<AgentsPageAgent>();

interface AgentsTableProps {
  agents: AgentsPageAgent[];
  canIssueAgentKeys: boolean;
  canManageAgents: boolean;
  isUpdating: boolean;
  t: (key: string) => string;
  onDeleteRequest: (agent: AgentsPageAgent) => void;
  onEditClick: (agent: AgentsPageAgent) => void;
  onKeysClick: (agent: AgentsPageAgent) => void;
  onRowClick: (agent: AgentsPageAgent) => void;
  onStatusToggle: (input: { agentId: string; data: AgentStatusUpdateInput }) => void;
}

export function AgentsTable({
  agents,
  canIssueAgentKeys,
  canManageAgents,
  isUpdating,
  t,
  onDeleteRequest,
  onEditClick,
  onKeysClick,
  onRowClick,
  onStatusToggle,
}: AgentsTableProps) {
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
              <Bot className="w-4 h-4 text-icon-default" />
            </div>
            <div className="flex flex-col">
              <span className="text-foreground font-medium">{info.getValue()}</span>
              {info.row.original.description && (
                <span className="text-xs text-tertiary line-clamp-1">{info.row.original.description}</span>
              )}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('mode', {
        header: 'Mode',
        cell: (info) => <span className="text-tertiary text-sm capitalize">{info.getValue()}</span>,
      }),
      columnHelper.display({
        id: 'presence',
        header: 'Presence',
        cell: (info) => {
          const agent = info.row.original;
          const presence = agent.presence ?? 'offline';
          const label = agent.mode === 'internal' && presence === 'online'
            ? t('presence_running')
            : presence === 'managed'
              ? t('presence_managed')
              : presence === 'online'
                ? t('presence_online')
                : t('presence_offline');
          const dotClass = agent.mode === 'internal' && presence === 'online'
            ? 'bg-success'
            : presence === 'managed'
              ? 'bg-accent'
              : presence === 'online'
                ? 'bg-success'
                : 'bg-tertiary';

          return (
            <span className="inline-flex items-center gap-2 text-xs text-tertiary">
              <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
              {label}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'mode_stats',
        header: 'Stats',
        cell: (info) => {
          const agent = info.row.original;
          if (agent.mode === 'external') {
            const stats = agent.external_stats;
            return (
              <div className="text-xs text-tertiary space-y-0.5">
                {stats?.source_ip != null && <div>IP: {stats.source_ip}</div>}
                {stats?.connection_duration_sec != null && (
                  <div>{t('connection_duration')}: {formatDuration(stats.connection_duration_sec)}</div>
                )}
                {stats?.qpm != null && <div>QPM: {stats.qpm}</div>}
                {!stats?.source_ip && !stats?.connection_duration_sec && stats?.qpm == null && <span>—</span>}
              </div>
            );
          }

          const stats = agent.internal_stats;
          return (
            <div className="text-xs text-tertiary space-y-0.5">
              {stats?.pod_count != null && <div>{t('pods_running')}: {stats.pod_count}</div>}
              {stats?.desired_replicas != null && <div>{t('desired_replicas')}: {stats.desired_replicas}</div>}
              {stats?.pod_count == null && stats?.desired_replicas == null && <span>—</span>}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'owner',
        header: 'Owner',
        cell: (info) => {
          const agent = info.row.original;
          const ownerLabel = agent.owner_name ?? agent.owner_id ?? '—';
          const adminLabel = agent.admin_name ?? agent.admin_id;
          return (
            <div className="text-xs text-tertiary space-y-0.5">
              <div>{ownerLabel}</div>
              {adminLabel && adminLabel !== ownerLabel ? <div className="text-tertiary/80">{t('admin')}: {adminLabel}</div> : null}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'interaction',
        header: 'Interaction',
        cell: (info) => {
          const mode = info.row.original.interaction_mode;
          if (!mode) return <span className="text-tertiary text-xs">—</span>;
          return <span className="text-tertiary text-xs capitalize">{mode === 'both' ? t('interaction_both') : t(`interaction_${mode}`)}</span>;
        },
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: (info) => <StatusBadge status={info.getValue() === 'enabled' ? 'active' : 'paused'} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const agent = info.row.original;
          const isEnabled = agent.status === 'enabled';
          const isExternal = agent.mode === 'external';
          return (
            <div className="flex items-center justify-end gap-1.5 min-w-[140px]">
              {canManageAgents ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditClick(agent);
                  }}
                  className="h-8 w-8 text-icon-default hover:bg-hover"
                  title={t('edit')}
                  aria-label={t('edit')}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              ) : null}
              {isExternal && canIssueAgentKeys ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    onKeysClick(agent);
                  }}
                  className="h-8 w-8 text-icon-default hover:bg-hover"
                  title={t('keys_title')}
                  aria-label={t('keys_title')}
                >
                  <Key className="w-4 h-4" />
                </Button>
              ) : null}
              {canManageAgents ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteRequest(agent);
                    }}
                    className="h-8 w-8 text-error hover:bg-hover"
                    title={t('delete')}
                    aria-label={t('delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStatusToggle({
                        agentId: agent.id,
                        data: { status: isEnabled ? 'disabled' : 'enabled' },
                      });
                    }}
                    disabled={isUpdating}
                    className="h-8 gap-1.5 px-3 text-xs"
                    title={isEnabled ? t('disable_hint') : t('enable_hint')}
                  >
                    {isEnabled ? (
                      <>
                        <PowerOff className="w-3.5 h-3.5 text-warning" />
                        {t('disable')}
                      </>
                    ) : (
                      <>
                        <Power className="w-3.5 h-3.5 text-success" />
                        {t('enable')}
                      </>
                    )}
                  </Button>
                </>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [canIssueAgentKeys, canManageAgents, isUpdating, onDeleteRequest, onEditClick, onKeysClick, onStatusToggle, t],
  );

  const table = useReactTable({
    data: agents,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return <DataTable table={table} testId="agents__table" onRowClick={onRowClick} />;
}
