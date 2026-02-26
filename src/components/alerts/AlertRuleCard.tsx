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
    <div className="rounded-lg border bg-surface p-4 shadow-sm" data-testid="alert-rule-card">
      {/* Header: Name + Actions */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-primary">
            {rule.name}
          </h3>
          {rule.description && (
            <p className="mt-1 text-sm text-tertiary">
              {rule.description}
            </p>
          )}
        </div>

        {/* Action Menu */}
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

      {/* Trigger Condition */}
      <div className="mt-4 rounded-md bg-sidebar p-3 text-sm">
        <div className="font-medium text-primary">
          {t('trigger_condition')}
        </div>
        <div className="mt-1 font-mono text-xs text-tertiary">
          {rule.trigger.metric} {rule.trigger.operator} {rule.trigger.threshold}
        </div>
      </div>

      {/* Footer: Status + Toggle */}
      <div className="mt-4 flex items-center justify-between border-t border-subtle pt-4">
        <div className="flex items-center gap-2 text-sm">
          {!rule.enabled && (
            <span className="rounded px-2 py-0.5 text-xs font-medium text-tertiary bg-surface-high">
              {t('disabled')}
            </span>
          )}
          {rule.last_triggered_at && (
            <span className="text-xs text-tertiary">
              {t('last_triggered')}: {new Date(rule.last_triggered_at).toLocaleString()}
            </span>
          )}
        </div>

        <Switch
          checked={rule.enabled}
          onCheckedChange={(checked) => onToggle(checked)}
          data-testid="alert-rule-toggle"
        />
      </div>
    </div>
  );
}
