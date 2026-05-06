'use client';

import * as React from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Bot, Eye, KeyRound, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import type { AgentDiagnostics } from '@/lib/api/types';

import { AgentRunnerDetailsCard } from './AgentRunnerDetailsCard';
import type { AgentRunnerPageRecord } from '../agent-runners-page-types';

const columnHelper = createColumnHelper<AgentRunnerPageRecord>();
type AgentRunnerItemActionOperation = keyof AgentRunnerPageRecord['actions'];
const connectionActionOperations = [
  'issue_connection_key',
  'revoke_connection_key',
  'test_connection',
  'run_test_task',
] as const satisfies readonly AgentRunnerItemActionOperation[];

interface AgentRunnersTableProps {
  runners: AgentRunnerPageRecord[];
  isUpdating: boolean;
  t: (key: string) => string;
  onDeleteRequest: (runner: AgentRunnerPageRecord) => void;
  onEditClick: (runner: AgentRunnerPageRecord) => void;
  onConnectionKeysClick: (runner: AgentRunnerPageRecord) => void;
  onViewDiagnosticsClick: (runner: AgentRunnerPageRecord) => void;
  onRowClick: (runner: AgentRunnerPageRecord) => void;
  expandedRunnerId?: string | null;
  expandedDiagnostics?: AgentDiagnostics | null;
  expandedDiagnosticsLoading?: boolean;
  onDetailsClose?: () => void;
  testId?: string;
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

function getAction(runner: AgentRunnerPageRecord, operation: AgentRunnerItemActionOperation) {
  return runner.actions?.[operation];
}

function isEditableDeveloperRunner(runner: AgentRunnerPageRecord) {
  return runner.kind === 'developer' && !runner.read_only;
}

function isManagedProjection(runner: AgentRunnerPageRecord) {
  return runner.kind === 'system_managed';
}

function canShowDeveloperAction(runner: AgentRunnerPageRecord, operation: AgentRunnerItemActionOperation) {
  return isEditableDeveloperRunner(runner) && actionVisible(runner, operation);
}

function actionAllowed(runner: AgentRunnerPageRecord, operation: AgentRunnerItemActionOperation) {
  return getAction(runner, operation)?.allowed === true;
}

function actionVisible(runner: AgentRunnerPageRecord, operation: AgentRunnerItemActionOperation) {
  return getAction(runner, operation)?.visible === true;
}

function actionEnabled(runner: AgentRunnerPageRecord, operation: AgentRunnerItemActionOperation) {
  return actionVisible(runner, operation) && actionAllowed(runner, operation);
}

function canShowConnectionActions(runner: AgentRunnerPageRecord) {
  return isEditableDeveloperRunner(runner)
    && connectionActionOperations.some((operation) => actionVisible(runner, operation));
}

function canOpenConnectionActions(runner: AgentRunnerPageRecord) {
  return isEditableDeveloperRunner(runner)
    && connectionActionOperations.some((operation) => actionEnabled(runner, operation));
}

function sourceLabel(runner: AgentRunnerPageRecord, t: (key: string) => string) {
  return runner.kind === 'system_managed' ? t('source_system_managed') : t('source_developer');
}

function ManagedRunnerInlineDetails({
  runner,
  t,
  onClose,
}: {
  runner: AgentRunnerPageRecord;
  t: (key: string) => string;
  onClose: () => void;
}) {
  return (
    <div
      className="space-y-4 rounded-md border border-subtle bg-surface px-4 py-4"
      data-testid={`agent-runners__managed-inline-details--${runner.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t('managed_projection_detail_title')}</h3>
          <p className="text-sm text-tertiary">{runner.name}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-sm text-tertiary" onClick={onClose}>
          {t('detail_close')}
        </Button>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-tertiary">{t('readiness')}</p>
          <StatusBadge status={readinessStatus(runner.status)} className="mt-1">
            {runner.status}
          </StatusBadge>
        </div>
        <div>
          <p className="text-xs text-tertiary">{t('source_label')}</p>
          <p className="mt-1 text-foreground">{sourceLabel(runner, t)}</p>
        </div>
        <div>
          <p className="text-xs text-tertiary">{t('managed_projection_not_configurable')}</p>
          <p className="mt-1 text-foreground">{t('managed_projection_not_configurable')}</p>
        </div>
      </div>

      <div className="rounded-md border border-subtle bg-surface-low px-3 py-3 text-sm text-secondary">
        {t('managed_projection_detail_description')}
      </div>
    </div>
  );
}

export function AgentRunnersTable({
  runners,
  isUpdating,
  t,
  onDeleteRequest,
  onEditClick,
  onConnectionKeysClick,
  onViewDiagnosticsClick,
  onRowClick,
  expandedRunnerId = null,
  expandedDiagnostics = null,
  expandedDiagnosticsLoading = false,
  onDetailsClose,
  testId = 'agent-runners__table',
}: AgentRunnersTableProps) {
  const managedProjectionOnly = runners.length > 0 && runners.every(isManagedProjection);
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
              <span className="text-xs text-tertiary">{sourceLabel(info.row.original, t)}</span>
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
        id: 'source',
        header: t('table.source'),
        cell: (info) => (
          <span className="text-xs text-tertiary">
            {sourceLabel(info.row.original, t)}
          </span>
        ),
      }),
      ...(managedProjectionOnly
        ? [
            columnHelper.display({
              id: 'managed-projection',
              header: t('managed_projection_not_configurable'),
              cell: () => (
                <span className="text-xs text-tertiary">
                  {t('managed_projection_not_configurable')}
                </span>
              ),
            }),
          ]
        : [
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
                const queueDepth = typeof diagnostics?.queue_depth === 'number' ? diagnostics.queue_depth : undefined;
                const lastError = typeof diagnostics?.last_error === 'string' ? diagnostics.last_error : undefined;
                const hasIssue = Boolean(lastError?.trim());
                return (
                  <div className="space-y-0.5 text-xs text-tertiary">
                    {queueDepth != null ? <div>{t('diagnostics_queue_depth')}: {queueDepth}</div> : null}
                    {hasIssue ? <div>{t('diagnostics_issue_present')}</div> : null}
                    {queueDepth == null && !hasIssue ? <span>-</span> : null}
                  </div>
                );
              },
            }),
          ]),
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
          const canViewDiagnostics = actionVisible(runner, 'view_diagnostics');
          const canOpenDiagnostics = actionEnabled(runner, 'view_diagnostics');
          const showKeys = canShowConnectionActions(runner);
          const canOpenKeys = canOpenConnectionActions(runner);
          const showEdit = canShowDeveloperAction(runner, 'edit');
          const canEdit = actionAllowed(runner, 'edit');
          const showDelete = canShowDeveloperAction(runner, 'delete');
          const canDelete = actionAllowed(runner, 'delete') && !isUpdating;
          return (
            <div className="flex min-w-[128px] items-center justify-end gap-1.5">
              {canViewDiagnostics ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!canOpenDiagnostics) return;
                    onViewDiagnosticsClick(runner);
                  }}
                  disabled={!canOpenDiagnostics}
                  className="h-8 w-8 text-icon-default hover:bg-hover"
                  title={canOpenDiagnostics ? t('view_diagnostics_action') : t('action_disabled_reason')}
                  aria-label={
                    canOpenDiagnostics
                      ? t('view_diagnostics_action')
                      : `${t('view_diagnostics_action')}: ${t('action_disabled_reason')}`
                  }
                >
                  <Eye className="h-4 w-4" />
                </Button>
              ) : null}
              {showKeys ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!canOpenKeys) return;
                      onConnectionKeysClick(runner);
                    }}
                    disabled={!canOpenKeys}
                    className="h-8 w-8 text-icon-default hover:bg-hover"
                    title={t('connection_keys_action')}
                    aria-label={t('connection_keys_action')}
                    data-testid={`agent-runners__connection-keys-btn--${runner.id}`}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
              ) : null}
              {showEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!canEdit) return;
                      onEditClick(runner);
                    }}
                    disabled={!canEdit}
                    className="h-8 w-8 text-icon-default hover:bg-hover"
                    title={t('edit')}
                    aria-label={t('edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
              ) : null}
              {showDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!canDelete) return;
                      onDeleteRequest(runner);
                    }}
                    disabled={!canDelete}
                    className="h-8 w-8 text-error hover:bg-hover"
                    title={t('delete')}
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [isUpdating, managedProjectionOnly, onConnectionKeysClick, onDeleteRequest, onEditClick, onViewDiagnosticsClick, t],
  );

  const table = useReactTable({
    data: runners,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const cellPadding = 'px-4 py-3';
  const headerPadding = 'px-4 py-3';
  const columnCount = table.getVisibleFlatColumns().length;

  return (
    <div className="rounded-md border border-subtle bg-surface/95 p-4 shadow-card">
      <div
        className="overflow-hidden rounded-md border border-border/60 bg-surface shadow-ambient"
        data-testid={testId}
      >
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="min-w-full border-collapse">
            <thead className="border-b border-subtle bg-surface-low">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary',
                        headerPadding,
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const runner = row.original;
                const expanded = expandedRunnerId === runner.id;

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        'cursor-pointer border-b border-subtle transition-colors duration-200 hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                        expanded && 'bg-surface-low',
                      )}
                      data-testid={testId ? `${testId}__row` : undefined}
                      data-row-id={runner.id}
                      onClick={() => onRowClick(runner)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn('text-sm text-primary', cellPadding)}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {expanded ? (
                      <tr
                        className="border-b border-subtle bg-surface-low/40"
                        data-testid={`agent-runners__inline-details-row--${runner.id}`}
                      >
                        <td colSpan={columnCount} className="px-4 py-4">
                          {isManagedProjection(runner) ? (
                            <ManagedRunnerInlineDetails
                              runner={runner}
                              t={t}
                              onClose={onDetailsClose ?? (() => undefined)}
                            />
                          ) : (
                            <AgentRunnerDetailsCard
                              runner={runner}
                              diagnostics={expandedDiagnostics ?? null}
                              diagnosticsLoading={expandedDiagnosticsLoading}
                              t={t}
                              onClose={onDetailsClose ?? (() => undefined)}
                            />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
