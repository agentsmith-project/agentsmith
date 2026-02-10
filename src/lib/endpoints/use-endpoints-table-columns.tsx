'use client';

import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Globe, Pencil, Power, PowerOff, Server, Trash2 } from 'lucide-react';

import type { Endpoint } from '@/lib/api/types';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

const columnHelper = createColumnHelper<Endpoint>();

export interface DeleteEndpointMutationState {
  mutate: (endpointId: string) => void;
  isPending: boolean;
}

export interface UpdateEndpointMutationState {
  mutate: (args: { endpointId: string; data: { status?: 'active' | 'disabled' } }) => void;
  isPending: boolean;
}

interface UseEndpointsTableColumnsInput {
  t: (key: string) => string;
  canManageEndpoints: boolean;
  deleteEndpointMutation: DeleteEndpointMutationState;
  updateEndpointMutation: UpdateEndpointMutationState;
  onEdit: (endpoint: Endpoint) => void;
  onDeleteRequest: (endpoint: Endpoint) => void;
}

export function useEndpointsTableColumns({
  t,
  canManageEndpoints,
  deleteEndpointMutation,
  updateEndpointMutation,
  onEdit,
  onDeleteRequest,
}: UseEndpointsTableColumnsInput) {
  return useMemo(
    () => [
      columnHelper.accessor('name', {
        header: t('table.name'),
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
              <Server className="w-4 h-4 text-icon-default" />
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
      columnHelper.accessor('base_url', {
        header: t('table.url'),
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
            <span className="text-tertiary text-sm font-mono truncate max-w-[200px]">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor('type', {
        header: t('table.type'),
        cell: (info) => <span className="text-tertiary text-sm capitalize">{info.getValue()}</span>,
      }),
      columnHelper.accessor('openai_model', {
        header: t('table.model'),
        cell: (info) => <span className="text-tertiary text-sm font-mono">{info.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.limits, {
        id: 'limits',
        header: t('table.rate_limit'),
        cell: (info) => (
          <div className="text-xs text-tertiary leading-5">
            <p>
              RPM: <span className="text-primary">{info.getValue()?.max_requests_per_minute ?? '-'}</span>
            </p>
            <p>
              Tokens/day: <span className="text-primary">{info.getValue()?.max_tokens_per_day ?? '-'}</span>
            </p>
          </div>
        ),
      }),
      columnHelper.accessor('status', {
        header: t('table.status'),
        cell: (info) => <StatusBadge status={info.getValue() === 'active' ? 'active' : 'paused'} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          if (!canManageEndpoints) {
            return <span className="text-tertiary text-sm">-</span>;
          }

          return (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEdit(info.row.original)}
                className="h-8 px-2 text-icon-default hover:bg-hover text-xs"
                aria-label={t('action_edit')}
                title={t('action_edit')}
                data-testid={`endpoints__action-edit--${info.row.original.id}`}
              >
                <Pencil className="w-4 h-4" />
                <span className="hidden lg:inline">{t('action_edit')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateEndpointMutation.mutate({
                    endpointId: info.row.original.id,
                    data: { status: info.row.original.status === 'active' ? 'disabled' : 'active' },
                  })
                }
                disabled={updateEndpointMutation.isPending}
                className="h-8 px-2 text-icon-default hover:bg-hover text-xs"
                aria-label={info.row.original.status === 'active' ? t('action_disable') : t('action_enable')}
                title={info.row.original.status === 'active' ? t('action_disable') : t('action_enable')}
              >
                {info.row.original.status === 'active' ? (
                  <PowerOff className="w-4 h-4 text-warning" />
                ) : (
                  <Power className="w-4 h-4 text-success" />
                )}
                <span className="hidden lg:inline">
                  {info.row.original.status === 'active' ? t('action_disable') : t('action_enable')}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDeleteRequest(info.row.original)}
                disabled={deleteEndpointMutation.isPending}
                className="h-8 px-2 text-error hover:bg-hover text-xs"
                aria-label={t('action_delete')}
                title={t('action_delete')}
                data-testid={`endpoints__action-delete--${info.row.original.id}`}
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden lg:inline">{t('action_delete')}</span>
              </Button>
            </div>
          );
        },
      }),
    ],
    [canManageEndpoints, deleteEndpointMutation, onDeleteRequest, onEdit, t, updateEndpointMutation],
  );
}
