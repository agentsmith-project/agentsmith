'use client';

import * as React from 'react';
import { AlertTriangle, AlertCircle, AlertOctagon, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type AnomalySeverity = 'low' | 'medium' | 'high';
export type AnomalyType = 'requests_spike' | 'error_rate' | 'latency' | 'spending_limit_exceeded';

export interface AnomalyAlert {
  id: string;
  timestamp: string;
  severity: AnomalySeverity;
  type: AnomalyType;
  description: string;
  value: number;
  expected_range?: { min: number; max: number };
  affected_resources: Array<{ type: string; id: string; name: string }>;
}

export interface AnomalyAlertsPanelProps {
  anomalies?: AnomalyAlert[];
  onAnomalyClick?: (anomalyId: string) => void;
  loading?: boolean;
}

const anomalyIcons = {
  low: AlertTriangle,
  medium: AlertCircle,
  high: AlertOctagon,
};

const anomalyColors = {
  low: 'text-warning',
  medium: 'text-orange-500',
  high: 'text-error',
};

export function AnomalyAlertsPanel({ anomalies, onAnomalyClick, loading }: AnomalyAlertsPanelProps) {
  const t = useTranslations('dashboard');

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-anomalies">
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-surface-high rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center" data-testid="dashboard-anomalies">
        <Zap className="h-8 w-8 mx-auto mb-2 text-success" />
        <p className="text-sm text-tertiary">{t('no_anomalies')}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden" data-testid="dashboard-anomalies">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{t('anomalies')}</h3>
      </div>
      <div className="divide-y divide-border">
        {anomalies.map((anomaly) => {
          const Icon = anomalyIcons[anomaly.severity];
          const colorClass = anomalyColors[anomaly.severity];

          return (
            <div
              key={anomaly.id}
              data-testid={`dashboard-anomalies__row--${anomaly.id}`}
              className={cn(
                'px-4 py-3 hover:bg-hover cursor-pointer transition-colors',
                onAnomalyClick && 'hover:bg-hover'
              )}
              onClick={() => onAnomalyClick?.(anomaly.id)}
            >
              <div className="flex items-start gap-3">
                <Icon className={cn('h-5 w-5 mt-0.5', colorClass)} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{anomaly.description}</p>
                  <div className="mt-1 flex items-center gap-4 text-xs text-tertiary">
                    <span>{new Date(anomaly.timestamp).toLocaleString()}</span>
                    <span>Value: {anomaly.value}</span>
                  </div>
                  {anomaly.affected_resources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {anomaly.affected_resources.map((resource) => (
                        <span
                          key={`${resource.type}-${resource.id}`}
                          className="px-2 py-1 bg-surface-high rounded text-xs"
                        >
                          {resource.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
