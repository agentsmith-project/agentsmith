'use client';

import * as React from 'react';
import { createColumnHelper, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Bot, KeyRound, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';

import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

import type { AgentRunnerPageRecord, AgentRunnerStatusUpdateInput } from '../agent-runners-page-types';

const columnHelper = createColumnHelper<AgentRunnerPageRecord>();

interface AgentRunnersTableProps {
  runners: AgentRunnerPageRecord[];
  canManageRunners: boolean;
  isUpdating: boolean;
  t: (key: string) => string;
  onDeleteRequest: (runner: AgentRunnerPageRecord) => void;
  onEditClick: (runner: AgentRunnerPageRecord) => void;
  onConnectionKeysClick: (runner: AgentRunnerPageRecord) => void;
  onRowClick: (runner: AgentRunnerPageRecord) => void;
  onStatusToggle: (input: { runnerId: string; data: AgentRunnerStatusUpdateInput }) => void;
}

function capabilitySummary(capabilities: Record<string, unknown> | null | undefined): string {
  if (!capabilities) return '-';
  const enabled = Object.entries(capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key.replace(/_/g, ' '));
  return enabled.length > 0 ? enabled.join(', ') : '-';
}

function readinessStatus(status: AgentRunnerPageRecord['status']) {
  if (status === 'ready') return 'active';
  if (status === 'degraded' || status === 'connected') return 'warning';
  return 'paused';
}

export function AgentRunnersTable({
  runners,
  canManageRunners,
  isUpdating,
  t,
  onDeleteRequest,
  onEditClick,
  onConnectionKeysClick,
  onRowClick,
  onStatusToggle,
}: AgentRunnersTableProps) {
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('name', {
        header: t('table.name'),
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-surface-high">
              <Bot className="h-4 w-4 text-icon-default" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="font-medium text-foreground">{info.getValue()}</span>
              {info.row.original.description ? (
                <span className="line-clamp-1 text-xs text-tertiary">{info.row.original.description}</span>
              ) : null}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('status', {
        header: t('table.readiness'),
        cell: (info) => <StatusBadge status={readinessStatus(info.getValue())} />,
      }),
      columnHelper.display({
        id: 'default_endpoint',
        header: t('table.default_endpoint'),
        cell: (info) => (
          <span className="text-xs text-tertiary">
            {info.row.original.default_endpoint_id ?? t('not_configured')}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'capabilities',
        header: t('table.capabilities'),
        cell: (info) => (
          <span className="text-xs capitalize text-tertiary">
            {capabilitySummary(info.row.original.capabilities)}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'diagnostics',
        header: t('table.diagnostics'),
        cell: (info) => {
          const diagnostics = info.row.original.diagnostics;
          const queueDepth = diagnostics?.queue_depth;
          const lastError = diagnostics?.last_error;
          return (
            <div className="space-y-0.5 text-xs text-tertiary">
              {queueDepth != null ? <div>{t('diagnostics_queue_depth')}: {queueDepth}</div> : null}
              {lastError ? <div>{lastError}</div> : null}
              {queueDepth == null && !lastError ? <span>-</span> : null}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'owner',
        header: t('table.owner'),
        cell: (info) => {
          const runner = info.row.original;
          const ownerLabel = runner.owner_name ?? runner.owner_id ?? '-';
          const adminLabel = runner.admin_name ?? runner.admin_id;
          return (
            <div className="space-y-0.5 text-xs text-tertiary">
              <div>{ownerLabel}</div>
              {adminLabel && adminLabel !== ownerLabel ? <div>{t('admin')}: {adminLabel}</div> : null}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const runner = info.row.original;
          const isEnabled = runner.status === 'ready';
          return (
            <div className="flex min-w-[128px] items-center justify-end gap-1.5">
              {canManageRunners ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onConnectionKeysClick(runner);
                    }}
                    className="h-8 w-8 text-icon-default hover:bg-hover"
                    title={t('connection_keys_action')}
                    aria-label={t('connection_keys_action')}
                    data-testid={`agent-runners__connection-keys-btn--${runner.id}`}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditClick(runner);
                    }}
                    className="h-8 w-8 text-icon-default hover:bg-hover"
                    title={t('edit')}
                    aria-label={t('edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteRequest(runner);
                    }}
                    className="h-8 w-8 text-error hover:bg-hover"
                    title={t('delete')}
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStatusToggle({
                        runnerId: runner.id,
                        data: { status: isEnabled ? 'offline' : 'ready' },
                      });
                    }}
                    disabled={isUpdating}
                    className="h-8 gap-1.5 px-3 text-xs"
                    title={isEnabled ? t('disable_hint') : t('enable_hint')}
                  >
                    {isEnabled ? (
                      <>
                        <PowerOff className="h-3.5 w-3.5 text-warning" />
                        {t('disable')}
                      </>
                    ) : (
                      <>
                        <Power className="h-3.5 w-3.5 text-success" />
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
    [canManageRunners, isUpdating, onConnectionKeysClick, onDeleteRequest, onEditClick, onStatusToggle, t],
  );

  const table = useReactTable({
    data: runners,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="rounded-md border border-subtle bg-surface/95 p-4 shadow-card">
      <DataTable table={table} testId="agent-runners__table" onRowClick={onRowClick} />
    </div>
  );
}
