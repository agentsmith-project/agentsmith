'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserPlus, Layers } from 'lucide-react';

export interface BatchApplyBarProps {
  selectedCount: number;
  onApplyPermissionTemplate: () => void;
  onApplyQuotaTemplate: () => void;
  onClearSelection: () => void;
  /** Overlay mode: no border/radius, for floating bar at bottom */
  overlay?: boolean;
}

export function BatchApplyBar({
  selectedCount,
  onApplyPermissionTemplate,
  onApplyQuotaTemplate,
  onClearSelection,
  overlay = false,
}: BatchApplyBarProps) {
  const t = useTranslations('members.batch');

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-3',
        overlay ? 'bg-surface-high' : 'rounded-md border border-border bg-surface-high',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {t('selected_count', { count: selectedCount })}
        </span>
        <Button variant="ghost" size="sm" onClick={onClearSelection} className="h-auto py-1 text-xs">
          {t('clear_selection')}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onApplyPermissionTemplate}
          className="gap-2"
        >
          <Layers className="h-4 w-4" />
          {t('apply_permission_template')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onApplyQuotaTemplate}
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" />
          {t('apply_quota_template')}
        </Button>
      </div>
    </div>
  );
}
