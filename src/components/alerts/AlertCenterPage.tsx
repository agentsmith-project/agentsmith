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
import { Plus, Bell, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageState } from '@/components/layout/PageState';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { AlertRulesList } from './AlertRulesList';
import { AlertNotificationsPanel } from './AlertNotificationsPanel';
import { AlertRuleFormDialog } from './AlertRuleFormDialog';
import type { AlertRuleFormData } from './AlertRuleFormDialog';
import type { AlertRule } from '@/lib/types/alerts';
import type { Alert } from '@/lib/types/alerts';

export interface AlertCenterPageProps {
  workspaceId: string;
  projectId: string;
  rules?: AlertRule[];
  alerts?: Alert[];
  onRuleCreate?: (rule: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onRuleUpdate?: (ruleId: string, updates: Partial<AlertRule>) => Promise<void>;
  onRuleDelete?: (ruleId: string) => Promise<void>;
  onRuleTest?: (ruleId: string) => Promise<void>;
  onAlertMarkAsRead?: (alertId: string) => void;
  onAlertDismiss?: (alertId: string) => void;
}

type TabValue = 'rules' | 'notifications';

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
  const [activeTab, setActiveTab] = useState<TabValue>('rules');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Authorization checks
  const canViewAlerts = useHasPermission('project:alert:view');
  const canManageAlerts = useHasPermission('project:alert:manage');

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

  // Convert AlertRule to AlertRuleFormData for the dialog
  const ruleToFormData = (rule: AlertRule): AlertRuleFormData => ({
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    trigger: rule.trigger,
    channels: rule.channels,
    behavior: rule.behavior,
  });

  return (
    <div className="w-full space-y-4" data-testid="alert-center-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-tertiary mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="rules">
              <Settings className="h-4 w-4 mr-2" />
              {t('rules')}
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-4 w-4 mr-2" />
              {t('notifications')}
            </TabsTrigger>
          </TabsList>

          {activeTab === 'rules' && canManageAlerts && (
            <button
              onClick={() => setIsCreateDialogOpen(true)}
              className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 flex items-center gap-2"
              data-testid="alert-center__create-button"
            >
              <Plus className="h-4 w-4" />
              {t('create_rule')}
            </button>
          )}
        </div>

        <TabsContent value="rules" className="mt-4">
          <AlertRulesList
            rules={rules}
            onEdit={handleEditRule}
            onDelete={handleDeleteRule}
            onToggle={handleToggleRule}
            onTest={handleTestRule}
          />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <AlertNotificationsPanel
            alerts={alerts}
            onMarkAsRead={handleMarkAsRead}
            onDismiss={handleDismiss}
          />
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <AlertRuleFormDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSubmit={handleCreateRule}
        mode="create"
      />

      {/* Edit Dialog */}
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
