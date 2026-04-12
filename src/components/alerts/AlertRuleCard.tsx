/**
 * Alert Rule Card Component
 *
 * Single alert rule display card.
 *
 * @module alerts/AlertRuleCard
 */

'use client';

import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Trash2, TestTube } from 'lucide-react';
import type { AlertRule } from '@/lib/types/alerts';

export interface AlertRuleCardProps {
  rule: AlertRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
}

/**
 * Alert rule card component
 *
 * Features:
 * - Rule name and description
 * - Trigger condition display
 * - Notification channel icons
 * - Enable/disable toggle
 * - Edit/delete/test actions
 *
 * @param props - Component props
 * @returns Alert rule card component
 */
export function AlertRuleCard(props: AlertRuleCardProps) {
  const { rule, onEdit, onDelete, onToggle, onTest } = props;
  const t = useTranslations('alerts');

  return (
    <article className="grid gap-4 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-start" data-testid={`alert-rule-row--${rule.id}`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">
            {rule.name}
          </h3>
          {!rule.enabled && (
            <span className="rounded px-2 py-0.5 text-[11px] font-medium text-tertiary bg-surface-low">
              {t('disabled')}
            </span>
          )}
        </div>
        {rule.description && (
          <p className="text-sm text-tertiary">
            {rule.description}
          </p>
        )}
      </div>

      <div className="space-y-1 text-sm">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">
          {t('trigger_condition')}
        </div>
        <div className="font-mono text-xs text-tertiary">
          {rule.trigger.metric} {rule.trigger.operator} {rule.trigger.threshold}
        </div>
        {rule.last_triggered_at && (
          <div className="text-xs text-tertiary">
            {t('last_triggered')}: {new Date(rule.last_triggered_at).toLocaleString()}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Switch
          checked={rule.enabled}
          onCheckedChange={(checked) => onToggle(checked)}
          data-testid="alert-rule-toggle"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              {t('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTest}>
              <TestTube className="mr-2 h-4 w-4" />
              {t('test')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-error">
              <Trash2 className="mr-2 h-4 w-4" />
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
