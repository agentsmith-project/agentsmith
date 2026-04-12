/**
 * Alert Rules List Component
 *
 * List of alert rules with enable/disable and edit actions.
 *
 * @module alerts/AlertRulesList
 */

'use client';

import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { AlertRuleCard } from './AlertRuleCard';
import type { AlertRule } from '@/lib/types/alerts';

export interface AlertRulesListProps {
  rules: AlertRule[];
  onEdit: (ruleId: string) => void;
  onDelete: (ruleId: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onTest: (ruleId: string) => void;
  loading?: boolean;
}

/**
 * Alert rules list component
 *
 * Features:
 * - Display all rules
 * - Enable/disable toggle
 * - Edit/delete buttons
 * - Test dry-run button
 * - Last triggered timestamp
 *
 * @param props - Component props
 * @returns Alert rules list component
 */
export function AlertRulesList({
  rules,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  loading,
}: AlertRulesListProps) {
  const t = useTranslations('alerts');

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3" data-testid="alert-rules-list__loading">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 border-y border-subtle/60 animate-pulse"
            data-testid={`alert-rules-list__skeleton-${i}`}
          />
        ))}
      </div>
    );
  }

  // Empty state
  if (rules.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center border-y border-subtle/60 py-12 px-4"
        data-testid="alert-rules-list__empty"
      >
        <Bell className="h-12 w-12 text-tertiary mb-3" />
        <h3 className="text-lg font-medium text-foreground mb-1">{t('no_rules')}</h3>
        <p className="text-sm text-tertiary text-center max-w-sm">
          {t('no_rules_description')}
        </p>
      </div>
    );
  }

  // Rules list
  return (
    <div className="divide-y divide-subtle/60 border-y border-subtle/60" data-testid="alert-rules-list__surface">
      {rules.map((rule) => (
        <AlertRuleCard
          key={rule.id}
          rule={rule}
          onEdit={() => onEdit(rule.id)}
          onDelete={() => onDelete(rule.id)}
          onToggle={(enabled) => onToggle(rule.id, enabled)}
          onTest={() => onTest(rule.id)}
        />
      ))}
    </div>
  );
}
