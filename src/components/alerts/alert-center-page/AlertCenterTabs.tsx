'use client';

import { Bell, Plus, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertNotificationsPanel } from '@/components/alerts/AlertNotificationsPanel';
import { AlertRulesList } from '@/components/alerts/AlertRulesList';

import type {
  AlertCenterNotification,
  AlertCenterRule,
  AlertCenterTabValue,
} from './types';

interface AlertCenterTabsProps {
  activeTab: AlertCenterTabValue;
  alerts: AlertCenterNotification[];
  canManageAlerts: boolean;
  rules: AlertCenterRule[];
  t: (key: string) => string;
  onAlertDismiss?: (alertId: string) => void;
  onAlertMarkAsRead?: (alertId: string) => void;
  onCreateOpen: () => void;
  onRuleDelete: (ruleId: string) => void | Promise<void>;
  onRuleEdit: (ruleId: string) => void;
  onRuleTest: (ruleId: string) => void | Promise<void>;
  onRuleToggle: (ruleId: string, enabled: boolean) => void | Promise<void>;
  onTabChange: (value: AlertCenterTabValue) => void;
}

export function AlertCenterTabs({
  activeTab,
  alerts,
  canManageAlerts,
  rules,
  t,
  onAlertDismiss,
  onAlertMarkAsRead,
  onCreateOpen,
  onRuleDelete,
  onRuleEdit,
  onRuleTest,
  onRuleToggle,
  onTabChange,
}: AlertCenterTabsProps) {
  const handleMarkAsRead = (alertId: string) => {
    onAlertMarkAsRead?.(alertId);
  };

  const handleDismiss = (alertId: string) => {
    onAlertDismiss?.(alertId);
  };

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as AlertCenterTabValue)}>
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

        {activeTab === 'rules' && canManageAlerts ? (
          <Button
            onClick={onCreateOpen}
            variant="action"
            size="sm"
            className="gap-2"
            data-testid="alert-center__create-button"
          >
            <Plus className="h-4 w-4" />
            {t('create_rule')}
          </Button>
        ) : null}
      </div>

      <TabsContent value="rules" className="mt-4">
        <AlertRulesList
          rules={rules}
          onEdit={onRuleEdit}
          onDelete={onRuleDelete}
          onToggle={onRuleToggle}
          onTest={onRuleTest}
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
  );
}
