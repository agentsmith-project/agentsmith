'use client';

import * as React from 'react';
import { Server, Database, Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/utils/dashboard';

export type ResourceType = 'endpoint' | 'agent' | 'source_library';

export interface ResourceUsageRank {
  resource_id: string;
  resource_type: ResourceType;
  resource_name: string;
  requests: number;
  tokens?: number;
  errors?: number;
  cost_usd?: number;
}

export interface TopResourcesListProps {
  resources?: ResourceUsageRank[];
  onResourceClick?: (resourceId: string) => void;
  loading?: boolean;
}

function ResourceTypeBadge({ type }: { type: string }) {
  const t = useTranslations('dashboard');

  const variants = {
    endpoint: { icon: Server, label: t('resource_type.endpoint'), color: 'bg-blue-500/10 text-blue-500' },
    agent: { icon: Bot, label: t('resource_type.agent'), color: 'bg-purple-500/10 text-purple-500' },
    source_library: { icon: Database, label: t('resource_type.source_library'), color: 'bg-green-500/10 text-green-500' },
  };

  const variant = variants[type as keyof typeof variants] || variants.endpoint;
  const Icon = variant.icon;

  return (
    <span
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', variant.color)}
      data-testid={`resource-type-badge-${type}`}
    >
      <Icon className="h-3 w-3" />
      {variant.label}
    </span>
  );
}

function LimitProgressBar({ used, limit }: { used: number; limit: number }) {
  const percentage = Math.min((used / limit) * 100, 100);
  const colorClass = percentage >= 80 ? 'bg-error' : percentage >= 50 ? 'bg-warning' : 'bg-success';

  return (
    <div className="w-full">
      <div className="h-2 bg-surface-high rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', colorClass)}
          style={{ width: `${percentage}%` }}
          data-testid={`limit-progress-${used}`}
        />
      </div>
    </div>
  );
}

export function TopResourcesList({ resources, onResourceClick, loading }: TopResourcesListProps) {
  const t = useTranslations('dashboard');

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-top-resources__loading">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-high rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!resources || resources.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center" data-testid="dashboard-top-resources">
        <p className="text-sm text-tertiary">{t('no_resources')}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden" data-testid="dashboard-top-resources">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{t('top_resources')}</h3>
      </div>
      <div className="divide-y divide-border">
        {resources.map((resource) => (
          <div
            key={resource.resource_id}
            data-testid={`dashboard-top-resources__row--${resource.resource_id}`}
            className={cn(
              'px-4 py-3 hover:bg-hover cursor-pointer transition-colors',
              onResourceClick && 'hover:bg-hover'
            )}
            onClick={() => onResourceClick?.(resource.resource_id)}
          >
            <div className="flex items-center gap-3 mb-2">
              <ResourceTypeBadge type={resource.resource_type} />
              <span className="flex-1 font-medium text-sm text-foreground">{resource.resource_name}</span>
              <span className="text-xs text-tertiary">{formatNumber(resource.requests)}</span>
            </div>
            {resource.tokens !== undefined && resource.cost_usd !== undefined && (
              <div className="grid grid-cols-2 gap-4 text-xs text-tertiary mb-2">
                <span>Tokens: {formatNumber(resource.tokens)}</span>
                <span>Cost: ${resource.cost_usd.toFixed(2)}</span>
              </div>
            )}
            {/* Limit progress bar should use actual limit data */}
            <LimitProgressBar used={resource.requests} limit={20000} />
          </div>
        ))}
      </div>
    </div>
  );
}
