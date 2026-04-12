/**
 * Alert Center Page Component
 *
 * Main page for managing alert rules and viewing notifications.
 *
 * @module alerts/AlertCenterPage
 */

'use client';

import * as React from 'react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/layout/PageState';
import { useAlertPageCapabilities } from '@/lib/hooks/use-permissions';
import { AlertRuleFormDialog } from './AlertRuleFormDialog';
import type { AlertRuleFormData } from './AlertRuleFormDialog';
import type { AlertRule } from '@/lib/types/alerts';
import type { Alert } from '@/lib/types/alerts';
import { AlertCenterHeader } from './alert-center-page/AlertCenterHeader';
import { AlertCenterTabs } from './alert-center-page/AlertCenterTabs';
import type { AlertCenterTabValue } from './alert-center-page/types';
import { ruleToFormData } from './alert-center-page/utils';

export interface AlertCenterPageProps {
  workspaceId: string;
  projectId: string;
  embedded?: boolean;
  rules?: AlertRule[];
  alerts?: Alert[];
  onRuleCreate?: (rule: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onRuleUpdate?: (ruleId: string, updates: Partial<AlertRule>) => Promise<void>;
  onRuleDelete?: (ruleId: string) => Promise<void>;
  onRuleTest?: (ruleId: string) => Promise<void>;
  onAlertMarkAsRead?: (alertId: string) => void;
  onAlertDismiss?: (alertId: string) => void;
}

/**
 * Alert center page component
 *
 * Features:
 * - Alert rules list with CRUD operations
 * - Notifications panel
 * - Create/edit/delete rules
 * - View alert history
 * - Tab-based navigation
 *
 * @param props - Component props
 * @returns Alert center page component
 */
export function AlertCenterPage({
  workspaceId,
  projectId,
  embedded = false,
  rules = [],
  alerts = [],
  onRuleCreate,
  onRuleUpdate,
  onRuleDelete,
  onRuleTest,
  onAlertMarkAsRead,
  onAlertDismiss,
}: AlertCenterPageProps) {
  const t = useTranslations('alerts');
  const tErrors = useTranslations('errors');
  const [activeTab, setActiveTab] = useState<AlertCenterTabValue>('rules');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Authorization checks
  const { canRead: canViewAlerts, canManage: canManageAlerts } = useAlertPageCapabilities();

  // Permission denied
  if (!canViewAlerts) {
    return (
      <PageState state="error" data-testid="permission-denied">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  // Rule handlers
  const handleEditRule = (ruleId: string) => {
    setEditingRuleId(ruleId);
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (onRuleDelete) {
      await onRuleDelete(ruleId);
    }
  };

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    if (onRuleUpdate) {
      const rule = rules.find((r) => r.id === ruleId);
      if (rule) {
        await onRuleUpdate(ruleId, { enabled });
      }
    }
  };

  const handleTestRule = async (ruleId: string) => {
    if (onRuleTest) {
      await onRuleTest(ruleId);
    }
  };

  const handleCreateRule = async (data: AlertRuleFormData) => {
    if (onRuleCreate) {
      await onRuleCreate({
        ...data,
        workspace_id: workspaceId,
        project_id: projectId,
      } as Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>);
    }
    setIsCreateDialogOpen(false);
  };

  const handleUpdateRule = async (data: AlertRuleFormData) => {
    if (onRuleUpdate && editingRuleId) {
      await onRuleUpdate(editingRuleId, data);
    }
    setEditingRuleId(null);
  };

  // Alert handlers
  const handleMarkAsRead = (alertId: string) => {
    if (onAlertMarkAsRead) {
      onAlertMarkAsRead(alertId);
    }
  };

  const handleDismiss = (alertId: string) => {
    if (onAlertDismiss) {
      onAlertDismiss(alertId);
    }
  };

  const editingRule = editingRuleId ? rules.find((r) => r.id === editingRuleId) : null;
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const unreadAlertCount = alerts.filter((alert) => alert.status === 'unread').length;

  return (
    <div className="w-full space-y-4" data-testid="alert-center-page">
      <AlertCenterHeader embedded={embedded} t={t} />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-tertiary" data-testid="alert-center__summary-meta">
        <span>{t('rules')} {rules.length}</span>
        <span aria-hidden="true">·</span>
        <span>{t('create_rule')} {enabledRuleCount}</span>
        <span aria-hidden="true">·</span>
        <span>{t('notifications')} {unreadAlertCount}</span>
      </div>

      <div className="min-h-0" data-testid="alert-center__main-surface">
        <AlertCenterTabs
          activeTab={activeTab}
          alerts={alerts}
          canManageAlerts={canManageAlerts}
          rules={rules}
          t={t}
          onAlertDismiss={handleDismiss}
          onAlertMarkAsRead={handleMarkAsRead}
          onCreateOpen={() => setIsCreateDialogOpen(true)}
          onRuleDelete={handleDeleteRule}
          onRuleEdit={handleEditRule}
          onRuleTest={handleTestRule}
          onRuleToggle={handleToggleRule}
          onTabChange={setActiveTab}
        />
      </div>

      <AlertRuleFormDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSubmit={handleCreateRule}
        mode="create"
      />

      {editingRule && (
        <AlertRuleFormDialog
          open={!!editingRule}
          onClose={() => setEditingRuleId(null)}
          onSubmit={handleUpdateRule}
          initialData={ruleToFormData(editingRule)}
          mode="edit"
        />
      )}
    </div>
  );
}
