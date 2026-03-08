'use client';
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/utils/formatters';
import type { LimitSummary } from '@/lib/api/types';

export interface LimitSummaryCardProps {
  limits: LimitSummary;
  className?: string;
}

function LimitItem({
  label,
  used,
  limit,
  className,
}: {
  label: string;
  used: number;
  limit: number;
  className?: string;
}) {
  const percentage = limit > 0 ? (used / limit) * 100 : 0;
  const isExceeded = used > limit;
  const isWarning = percentage > 80;

  return (
    <Card className={cn('flex-1', className)} role="region" aria-label={`${label} limit`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-tertiary uppercase tracking-wide">
            {label}
          </span>
          {isExceeded && (
            <span className="text-xs font-semibold text-error" role="alert">
              Exceeded
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-sm font-semibold text-foreground">
            {formatBytes(used)}
          </span>
          <span className="text-xs text-tertiary">/ {formatBytes(limit)}</span>
        </div>
        <Progress
          value={Math.min(percentage, 100)}
          className={cn(
            'h-1.5',
            isExceeded && 'bg-error/20 [&>div]:bg-error',
            !isExceeded && isWarning && 'bg-warning/20 [&>div]:bg-warning',
            !isExceeded && !isWarning && 'bg-primary/20 [&>div]:bg-primary',
          )}
          aria-label={`${label} limit usage: ${percentage.toFixed(1)}%`}
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </CardContent>
    </Card>
  );
}

export function LimitSummaryCard({ limits, className }: LimitSummaryCardProps) {
  return (
    <div className={cn('flex gap-4', className)}>
      <LimitItem
        label="Storage"
        used={limits.storage.used}
        limit={limits.storage.limit}
      />
      <LimitItem
        label="DocDB"
        used={limits.docdb.used}
        limit={limits.docdb.limit}
      />
      <LimitItem
        label="VectorDB"
        used={limits.vectordb.used}
        limit={limits.vectordb.limit}
      />
    </div>
  );
}
