'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCenterPage } from '@/components/alerts/AlertCenterPage';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { buttonVariants } from '@/components/ui/button';
import { getApiClient, AlertAPI } from '@/lib/api';
import { useAlertPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { toast } from '@/components/ui/toast';
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';
import { cn } from '@/lib/utils';
import type {
  Alert,
  AlertNotification,
  AlertRule,
  AlertRuleCreateRequest,
  AlertRuleUpdateRequest,
} from '@/lib/types/alerts';

interface AlertsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

const EMPTY_ALERT_RULES: AlertRule[] = [];
const EMPTY_ALERT_NOTIFICATIONS: AlertNotification[] = [];

function defaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

function toInAppAlert(
  workspaceId: string,
  projectId: string,
  notification: AlertNotification,
): Alert {
  const delivery = notification.delivery ?? {
    in_app_sent: true,
    webhook_sent: false,
  };
  const mappedType =
    notification.metric === 'spending_limit_percent'
      ? 'spending_limit.warning'
      : notification.metric === 'error_rate'
        ? 'endpoint.error'
        : notification.metric === 'requests_per_day' || notification.metric === 'requests_per_hour'
          ? 'rate_limit.warning'
          : 'system.maintenance';

  return {
    id: notification.id,
    workspace_id: workspaceId,
    project_id: projectId,
    type: mappedType,
    severity: 'info',
    title: notification.rule_name || 'Alert',
    message:
      notification.context?.resource_name ||
      notification.context?.resource_id ||
      notification.rule_name ||
      'Alert notification',
    metadata: {
      metric: notification.metric,
      actual_value: notification.actual_value,
      threshold: notification.threshold,
      delivery,
      status: notification.status,
      webhook_sent: delivery.webhook_sent,
      webhook_status: delivery.webhook_status,
      webhook_error: delivery.webhook_error,
    },
    created_at: notification.triggered_at || new Date().toISOString(),
    status: notification.status === 'firing' ? 'unread' : 'read',
  };
}

function dedupeFiringNotifications(
  notifications: AlertNotification[],
  debounceMinutes = 5,
): AlertNotification[] {
  const sorted = [...notifications].sort(
    (a, b) => new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime(),
  );
  const deduped: AlertNotification[] = [];

  for (const item of sorted) {
    if (item.status !== 'firing') {
      deduped.push(item);
      continue;
    }
    const last = deduped[deduped.length - 1];
    const sameSeries =
      last &&
      last.status === 'firing' &&
      last.rule_id === item.rule_id &&
      last.metric === item.metric &&
      last.context?.resource_id === item.context?.resource_id;
    if (!sameSeries) {
      deduped.push(item);
      continue;
    }
    const lastAt = new Date(last.triggered_at).getTime();
    const currentAt = new Date(item.triggered_at).getTime();
    const diffMinutes = (currentAt - lastAt) / (1000 * 60);
    if (diffMinutes <= debounceMinutes) {
      deduped[deduped.length - 1] = item;
    } else {
      deduped.push(item);
    }
  }

  return deduped;
}

export default function AlertsPage({ params }: AlertsPageProps) {
  const tErrors = useTranslations('errors');
  const t = useTranslations('alerts');
  const tCommon = useTranslations('common');
  const resolvedParams = useResolvedProjectRoute(params);
  const queryClient = useQueryClient();
  const alertAPI = useMemo(() => new AlertAPI(getApiClient()), []);
  const timeRange = useMemo(() => defaultTimeRange(), []);
  const [localAlerts, setLocalAlerts] = useState<Alert[]>([]);
  const { canRead: canViewAlerts } = useAlertPageCapabilities();

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams.locale;

  const { data: rules = EMPTY_ALERT_RULES } = useQuery({
    queryKey: ['alert-rules', workspaceId, projectId],
    queryFn: () => alertAPI.listRules(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canViewAlerts,
  });

  const { data: notifications = EMPTY_ALERT_NOTIFICATIONS } = useQuery({
    queryKey: ['alert-notifications', workspaceId, projectId],
    queryFn: () => alertAPI.listNotifications(workspaceId, projectId, { page: 1, page_size: 100 }),
    enabled: !!workspaceId && !!projectId && canViewAlerts,
  });

  useEffect(() => {
    if (notifications.length > 0) {
      const normalizedNotifications = dedupeFiringNotifications(notifications);
      setLocalAlerts((previous) => {
        const nextAlerts = normalizedNotifications.map((item) => toInAppAlert(workspaceId, projectId, item));
        const previousSerialized = JSON.stringify(previous);
        const nextSerialized = JSON.stringify(nextAlerts);
        return previousSerialized === nextSerialized ? previous : nextAlerts;
      });
    } else {
      setLocalAlerts((previous) => (previous.length === 0 ? previous : []));
    }
  }, [notifications, workspaceId, projectId]);

  const refreshAlertData = useMemo(
    () => async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['alert-rules', workspaceId, projectId] }),
        queryClient.invalidateQueries({ queryKey: ['alert-notifications', workspaceId, projectId] }),
      ]);
    },
    [projectId, queryClient, workspaceId],
  );

  if (!resolvedParams.isReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.isValid || !workspaceId || !projectId) {
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

  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const auditHref = `${basePath}/audit${buildSharedOpsFilterQuery(timeRange)}`;
  const usageHref = `${basePath}/usage${buildSharedOpsFilterQuery(timeRange, { panel: 'usage' })}`;

  const handleRuleCreate = async (rule: AlertRuleCreateRequest) => {
    await alertAPI.createRule(workspaceId, projectId, rule);
    await refreshAlertData();
    toast.success(tCommon('create_success'));
  };

  const handleRuleUpdate = async (ruleId: string, updates: AlertRuleUpdateRequest) => {
    await alertAPI.updateRule(workspaceId, projectId, ruleId, updates);
    await refreshAlertData();
    toast.success(tCommon('update_success'));
  };

  const handleRuleDelete = async (ruleId: string) => {
    await alertAPI.deleteRule(workspaceId, projectId, ruleId);
    await refreshAlertData();
    toast.success(tCommon('delete_success'));
  };

  const handleRuleTest = async (ruleId: string) => {
    const result = await alertAPI.testRule(workspaceId, projectId, ruleId);
    toast.info(result.details);
  };

  const handleAlertMarkAsRead = (alertId: string) => {
    setLocalAlerts((prev) =>
      prev.map((alert) =>
        alert.id === alertId && alert.status === 'unread'
          ? { ...alert, status: 'read', read_at: new Date().toISOString() }
          : alert,
      ),
    );
  };

  const handleAlertDismiss = (alertId: string) => {
    setLocalAlerts((prev) =>
      prev.map((alert) =>
        alert.id === alertId
          ? { ...alert, status: 'dismissed', dismissed_at: new Date().toISOString() }
          : alert,
      ),
    );
  };

  return (
    <PageState state="success">
      <PageLayout density="immersive" contentWidth="wide">
        <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="alerts__surface">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('title')}</div>
              <div className="max-w-2xl text-sm text-secondary">{t('subtitle')}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={auditHref}
                className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                data-testid="alerts__open-audit"
              >
                {tCommon('open_audit')}
              </Link>
              <Link
                href={usageHref}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="alerts__open-usage"
              >
                {tCommon('open_usage')}
              </Link>
            </div>
          </div>

          <div className="min-h-0" data-testid="alerts__main-surface">
            <AlertCenterPage
              embedded
              workspaceId={workspaceId}
              projectId={projectId}
              rules={rules}
              alerts={localAlerts}
              onRuleCreate={handleRuleCreate}
              onRuleUpdate={async (ruleId, updates) => {
                await handleRuleUpdate(ruleId, updates);
              }}
              onRuleDelete={handleRuleDelete}
              onRuleTest={handleRuleTest}
              onAlertDismiss={handleAlertDismiss}
              onAlertMarkAsRead={handleAlertMarkAsRead}
            />
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
