'use client';

import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Bot, Pencil, Power, PowerOff, Trash2, Activity, MoreHorizontal } from 'lucide-react';

import type { Endpoint, EndpointCapabilityType } from '@/lib/api/types';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { EndpointStatusBadge } from '@/components/endpoints/EndpointStatusBadge';
import { ProviderLogo } from '@/components/endpoints/ProviderLogo';
import { Badge } from '@/components/ui/badge';
import { resolveEndpointProtocolLabel } from '@/lib/endpoints/protocol-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { categorizeEndpointError } from '@/lib/endpoints/error-categorizer';

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
  onUseForAgentTasks?: (endpoint: Endpoint) => void;
  useForAgentTasksPending?: boolean;
  onTestConnection?: (endpoint: Endpoint) => void;
}

/**
 * Format price for display
 */
function formatPrice(price?: number, currency?: string): string {
  if (price === undefined) return '-';
  const symbol = currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : '$';
  return `${symbol}${price}/1M`;
}

/**
 * Get primary capability from endpoint
 */
function getPrimaryCapability(endpoint: Endpoint): EndpointCapabilityType | null {
  const capabilities = endpoint.capabilities;
  if (!capabilities || capabilities.length === 0) return null;

  // Priority order for display
  const priority: EndpointCapabilityType[] = [
    'chat_completion',
    'multimodal_completion',
    'embedding',
    'rerank',
    'image_generation',
    'video_generation',
  ];

  for (const type of priority) {
    const found = capabilities.find((c) => c.type === type && c.enabled);
    if (found) return type;
  }

  // Return first enabled capability
  const firstEnabled = capabilities.find((c) => c.enabled);
  return firstEnabled?.type ?? null;
}

function getCapabilityLabel(
  t: (key: string) => string,
  capability: EndpointCapabilityType,
): string {
  switch (capability) {
    case 'chat_completion':
      return t('create_dialog.capability_chat_completion');
    case 'multimodal_completion':
      return t('create_dialog.capability_multimodal_completion');
    case 'embedding':
      return t('create_dialog.capability_embedding');
    case 'rerank':
      return t('create_dialog.capability_rerank');
    case 'image_generation':
      return t('create_dialog.capability_image_generation');
    case 'video_generation':
      return t('create_dialog.capability_video_generation');
    default:
      return capability;
  }
}

/**
 * Map health status from API to component status
 */
function mapHealthStatus(healthStatus?: string): 'healthy' | 'degraded' | 'unavailable' | 'unknown' {
  if (!healthStatus) return 'unknown';
  switch (healthStatus) {
    case 'healthy':
      return 'healthy';
    case 'degraded':
      return 'degraded';
    case 'failed':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

export function useEndpointsTableColumns({
  t,
  canManageEndpoints,
  deleteEndpointMutation,
  updateEndpointMutation,
  onEdit,
  onDeleteRequest,
  onUseForAgentTasks,
  useForAgentTasksPending = false,
  onTestConnection,
}: UseEndpointsTableColumnsInput) {
  return useMemo(
    () => [
      // Provider column with logo
      columnHelper.accessor('provider_family', {
        header: t('table.provider') || 'Provider',
        cell: (info) => {
          const provider = info.getValue();
          return (
            <div className="flex items-center gap-2">
              <ProviderLogo provider={provider || 'custom'} size="sm" />
              <span className="text-sm capitalize">{provider || 'custom'}</span>
            </div>
          );
        },
      }),

      // Name column with description
      columnHelper.accessor('name', {
        header: t('table.name') || 'Name',
        cell: (info) => (
          <div className="flex flex-col">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              {info.getValue()}
              {info.row.original.agent_task_model_selected === true ? (
                <Badge variant="outline" className="border-accent/30 bg-accent/10 text-accent">
                  {t('agent_task_model.selected_badge')}
                </Badge>
              ) : null}
            </span>
            {info.row.original.description && (
              <span className="text-xs text-tertiary line-clamp-1 max-w-[200px]">
                {info.row.original.description}
              </span>
            )}
          </div>
        ),
      }),

      // Model column
      columnHelper.accessor('model', {
        header: t('table.model') || 'Model',
        cell: (info) => (
          <span className="text-sm text-tertiary font-mono">{info.getValue()}</span>
        ),
      }),

      // Capability column
      columnHelper.display({
        id: 'capability',
        header: t('table.capability') || 'Capability',
        cell: (info) => {
          const capability = getPrimaryCapability(info.row.original);
          if (!capability) return <span className="text-xs text-tertiary">-</span>;

          const colors: Partial<Record<EndpointCapabilityType, string>> = {
            chat_completion: 'bg-accent/15 text-accent border-accent/30',
            multimodal_completion: 'bg-purple-500/15 text-purple-500 border-purple-500/30',
            embedding: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
            rerank: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
            image_generation: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30',
            video_generation: 'bg-pink-500/15 text-pink-500 border-pink-500/30',
          };

          return (
            <Badge variant="outline" className={colors[capability] || 'bg-tertiary/15 text-tertiary border-tertiary/30'}>
              {getCapabilityLabel(t, capability)}
            </Badge>
          );
        },
      }),

      columnHelper.accessor('upstream_protocol', {
        header: t('table.upstream_protocol') || 'Upstream Protocol',
        cell: (info) => {
          const endpoint = info.row.original;
          return (
            <span className="text-xs font-medium text-tertiary">
              {resolveEndpointProtocolLabel(t, endpoint.upstream_protocol)}
            </span>
          );
        },
      }),

      // Health status column
      columnHelper.display({
        id: 'health',
        header: t('table.health') || 'Health',
        cell: (info) => {
          const health = info.row.original.health;
          const status = mapHealthStatus(health?.status);
          const lastCheck = health?.last_checked_at;

          // Map error to error category
          let errorCategory: 'auth' | 'network' | 'upstream' | 'timeout' | 'rate_limit' | 'unknown' | undefined;
          if (health?.last_error) {
            errorCategory = categorizeEndpointError({ message: health.last_error });
          }

          return (
            <EndpointStatusBadge
              status={status}
              lastCheck={lastCheck}
              errorCategory={errorCategory}
              size="sm"
            />
          );
        },
      }),

      // Pricing column
      columnHelper.display({
        id: 'pricing',
        header: t('table.pricing') || 'Pricing',
        cell: (info) => {
          // Get pricing from first model binding
          const firstModel = info.row.original.models?.[0];
          const pricing = firstModel?.pricing;

          if (!pricing) return <span className="text-xs text-tertiary">-</span>;

          return (
            <div className="text-xs text-tertiary">
              <div>{t('table.pricing_input')}: {formatPrice(pricing.input_per_million, pricing.currency)}</div>
              <div>{t('table.pricing_output')}: {formatPrice(pricing.output_per_million, pricing.currency)}</div>
            </div>
          );
        },
      }),

      // Admin status column (for management)
      columnHelper.accessor('status', {
        header: t('table.admin_status') || 'Status',
        cell: (info) => <StatusBadge status={info.getValue() === 'active' ? 'active' : 'paused'} />,
      }),

      // Actions column
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const endpoint = info.row.original;
          const isActive = endpoint.status === 'active';
          const useForAgentTasks = endpoint.actions?.use_for_agent_tasks;
          const isAgentTaskModelSelected = endpoint.agent_task_model_selected === true;
          const showUseForAgentTasks = useForAgentTasks?.visible === true && !isAgentTaskModelSelected;
          const canUseForAgentTasks = useForAgentTasks?.allowed === true && !useForAgentTasksPending;

          if (!canManageEndpoints && !showUseForAgentTasks) {
            return <span className="text-tertiary text-sm">-</span>;
          }

          return (
            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
              {/* Quick action buttons - visible on larger screens */}
              <div className="hidden md:flex items-center justify-end gap-1 whitespace-nowrap">
                {showUseForAgentTasks ? (
                  <Button
                    type="button"
                    variant="action"
                    size="sm"
                    onClick={() => {
                      if (!canUseForAgentTasks) return;
                      onUseForAgentTasks?.(endpoint);
                    }}
                    disabled={!canUseForAgentTasks}
                    className="h-8 shrink-0 gap-1.5 whitespace-nowrap px-2.5 text-[12px]"
                    aria-label={t('action_use_for_agent_tasks')}
                    title={canUseForAgentTasks ? t('action_use_for_agent_tasks') : t('action_disabled_reason')}
                    data-testid={`endpoints__action-use-for-agent-tasks--${endpoint.id}`}
                  >
                    <Bot className="h-3.5 w-3.5 shrink-0" />
                    <span>{t('action_use_for_agent_tasks')}</span>
                  </Button>
                ) : null}

                {/* Test connection button */}
                {onTestConnection && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onTestConnection(endpoint)}
                    className="h-8 w-8 p-0 text-icon-default hover:bg-hover"
                    aria-label={t('action_test_connection')}
                    title={t('action_test_connection')}
                    data-testid={`endpoints__action-test--${endpoint.id}`}
                  >
                    <Activity className="w-4 h-4" />
                  </Button>
                )}

                {canManageEndpoints ? (
                  <>
                    {/* Edit button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(endpoint)}
                      className="h-8 w-8 p-0 text-icon-default hover:bg-hover"
                      aria-label={t('action_edit')}
                      title={t('action_edit')}
                      data-testid={`endpoints__action-edit--${endpoint.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>

                    {/* Enable/Disable button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateEndpointMutation.mutate({
                          endpointId: endpoint.id,
                          data: { status: isActive ? 'disabled' : 'active' },
                        })
                      }
                      disabled={updateEndpointMutation.isPending}
                      className="h-8 w-8 p-0 hover:bg-hover"
                      aria-label={isActive ? t('action_disable') : t('action_enable')}
                      title={isActive ? t('action_disable') : t('action_enable')}
                      data-testid={`endpoints__action-toggle--${endpoint.id}`}
                    >
                      {isActive ? (
                        <PowerOff className="w-4 h-4 text-warning" />
                      ) : (
                        <Power className="w-4 h-4 text-success" />
                      )}
                    </Button>

                    {/* Delete button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteRequest(endpoint)}
                      disabled={deleteEndpointMutation.isPending}
                      className="h-8 w-8 p-0 text-error hover:bg-error/10"
                      aria-label={t('action_delete')}
                      title={t('action_delete')}
                      data-testid={`endpoints__action-delete--${endpoint.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                ) : null}
              </div>

              {/* Mobile dropdown menu - visible on smaller screens */}
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label={t('action_menu')}
                      data-testid={`endpoints__action-menu--${endpoint.id}`}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {showUseForAgentTasks ? (
                      <DropdownMenuItem
                        onClick={() => {
                          if (!canUseForAgentTasks) return;
                          onUseForAgentTasks?.(endpoint);
                        }}
                        disabled={!canUseForAgentTasks}
                        data-testid={`endpoints__action-use-for-agent-tasks-mobile--${endpoint.id}`}
                      >
                        <Bot className="w-4 h-4 mr-2" />
                        {t('action_use_for_agent_tasks')}
                      </DropdownMenuItem>
                    ) : null}
                    {onTestConnection && (
                      <DropdownMenuItem
                        onClick={() => onTestConnection(endpoint)}
                        data-testid={`endpoints__action-test-mobile--${endpoint.id}`}
                      >
                        <Activity className="w-4 h-4 mr-2" />
                        {t('action_test_connection')}
                      </DropdownMenuItem>
                    )}
                    {canManageEndpoints ? (
                      <>
                        <DropdownMenuItem
                          onClick={() => onEdit(endpoint)}
                          data-testid={`endpoints__action-edit-mobile--${endpoint.id}`}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          {t('action_edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateEndpointMutation.mutate({
                              endpointId: endpoint.id,
                              data: { status: isActive ? 'disabled' : 'active' },
                            })
                          }
                          disabled={updateEndpointMutation.isPending}
                          data-testid={`endpoints__action-toggle-mobile--${endpoint.id}`}
                        >
                          {isActive ? (
                            <>
                              <PowerOff className="w-4 h-4 mr-2 text-warning" />
                              {t('action_disable')}
                            </>
                          ) : (
                            <>
                              <Power className="w-4 h-4 mr-2 text-success" />
                              {t('action_enable')}
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onDeleteRequest(endpoint)}
                          disabled={deleteEndpointMutation.isPending}
                          className="text-error focus:text-error"
                          data-testid={`endpoints__action-delete-mobile--${endpoint.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          {t('action_delete')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        },
      }),
    ],
    [
      canManageEndpoints,
      deleteEndpointMutation,
      onDeleteRequest,
      onEdit,
      onTestConnection,
      onUseForAgentTasks,
      t,
      updateEndpointMutation,
      useForAgentTasksPending,
    ],
  );
}
