'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCenterPage } from '@/components/alerts/AlertCenterPage';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useAlertStore } from '@/lib/stores/alertStore';
import type { AlertRule } from '@/lib/types/alerts';

interface AlertsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

// Mock alert rules for E2E testing (will be replaced with API call)
const mockAlertRules: AlertRule[] = [
  {
    id: 'rule_1',
    project_id: 'proj_001',
    workspace_id: 'ws_1',
    name: 'High Requests Alert',
    description: 'Alert when daily requests exceed threshold',
    enabled: true,
    trigger: {
      metric: 'requests_per_day',
      operator: 'gt',
      threshold: 1000,
    },
    channels: {
      in_app: true,
      webhook: { url: 'https://example.com/webhook' },
    },
    behavior: {
      debounce_minutes: 10,
      notify_on_recovery: true,
    },
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
    last_triggered_at: '2026-02-27T14:30:00Z',
  },
];

// Initialize alert store with mock notifications for E2E testing
function initializeMockAlerts(store: ReturnType<typeof useAlertStore.getState>) {
  if (store.alerts.length === 0) {
    store.addAlert({
      workspace_id: 'ws_1',
      project_id: 'proj_001',
      type: 'quota.exceeded',
      severity: 'critical',
      title: 'Quota Exceeded',
      message: 'Daily quota has been exceeded',
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      resource_name: 'OpenAI Main',
      metadata: {},
    });
  }
}

export default function AlertsPage({ params }: AlertsPageProps) {
  const tErrors = useTranslations('errors');
  const t = useTranslations('alerts');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
  } | null>(null);
  const [_rules, _setRules] = useState<AlertRule[]>(mockAlertRules);

  const _currentUser = useAuthStore((s) => s.user);
  const canViewAlerts = useHasPermission('project:alert:view');
  const _canManageAlerts = useHasPermission('project:alert:manage');

  // Get alerts from store
  const alerts = useAlertStore((s) => s.alerts);
  const _unreadCount = useAlertStore((s) => s.unreadCount);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
      }),
    );
  }, [params]);

  // Initialize mock alerts for E2E testing
  useEffect(() => {
    if (workspaceId && projectId) {
      const store = useAlertStore.getState();
      initializeMockAlerts(store);
    }
  }, [workspaceId, projectId]);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canViewAlerts) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <AlertCenterPage
          workspaceId={workspaceId}
          projectId={projectId}
          rules={_rules}
          alerts={alerts}
          onRuleCreate={async () => {
            // TODO: API call
          }}
          onRuleUpdate={async () => {
            // TODO: API call
          }}
          onRuleDelete={async () => {
            // TODO: API call
          }}
          onRuleTest={async () => {
            // TODO: API call
          }}
          onAlertMarkAsRead={(alertId) => {
            const store = useAlertStore.getState();
            store.markAsRead(alertId);
          }}
          onAlertDismiss={(alertId) => {
            const store = useAlertStore.getState();
            store.dismissAlert(alertId);
          }}
        />
      </PageLayout>
    </PageState>
  );
}
