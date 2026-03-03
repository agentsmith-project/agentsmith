'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCenterPage } from '@/components/alerts/AlertCenterPage';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { buttonVariants } from '@/components/ui/button';
import { getApiClient, AlertAPI } from '@/lib/api';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';
import { cn } from '@/lib/utils';
import type {
  Alert,
  AlertNotification,
  AlertRuleCreateRequest,
  AlertRuleUpdateRequest,
} from '@/lib/types/alerts';

interface AlertsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

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
    notification.metric === 'quota_percent'
      ? 'quota.warning'
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
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    locale?: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const alertAPI = useMemo(() => new AlertAPI(getApiClient()), []);
  const timeRange = useMemo(() => defaultTimeRange(), []);
  const [localAlerts, setLocalAlerts] = useState<Alert[]>([]);
  const canViewAlerts = useHasPermission('project:endpoint:invoke');

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      }),
    );
  }, [params]);

  const { data: rules = [] } = useQuery({
    queryKey: ['alert-rules', workspaceId, projectId],
    queryFn: () => alertAPI.listRules(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canViewAlerts,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['alert-notifications', workspaceId, projectId],
    queryFn: () => alertAPI.listNotifications(workspaceId, projectId, { page: 1, page_size: 100 }),
    enabled: !!workspaceId && !!projectId && canViewAlerts,
  });

  useEffect(() => {
    if (notifications.length > 0) {
      const normalizedNotifications = dedupeFiringNotifications(notifications);
      setLocalAlerts(normalizedNotifications.map((item) => toInAppAlert(workspaceId, projectId, item)));
    } else {
      setLocalAlerts([]);
    }
  }, [notifications, workspaceId, projectId]);

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

  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const runtimeHref = `${basePath}/runtime-observability${buildSharedOpsFilterQuery(timeRange)}`;
  const releaseOpsHref = `${basePath}/release-ops${buildSharedOpsFilterQuery(timeRange)}`;
  const usageHref = `${basePath}/usage${buildSharedOpsFilterQuery(timeRange, { panel: 'usage' })}`;

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={releaseOpsHref}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="alerts__open-release-ops"
                >
                  {tCommon('open_release_ops')}
                </Link>
                <Link
                  href={runtimeHref}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="alerts__open-runtime"
                >
                  {tCommon('open_runtime')}
                </Link>
                <Link
                  href={usageHref}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="alerts__open-usage"
                >
                  {tCommon('open_usage')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <AlertCenterPage
          workspaceId={workspaceId}
          projectId={projectId}
          embedded
          rules={rules}
          alerts={localAlerts}
          onRuleCreate={async (rule) => {
            const payload: AlertRuleCreateRequest = {
              name: rule.name,
              description: rule.description,
              enabled: rule.enabled,
              trigger: rule.trigger,
              channels: rule.channels,
              behavior: rule.behavior,
            };
            await alertAPI.createRule(workspaceId, projectId, payload);
            await queryClient.invalidateQueries({ queryKey: ['alert-rules', workspaceId, projectId] });
            toast.success(tCommon('create_success'));
          }}
          onRuleUpdate={async (ruleId, updates) => {
            const payload: AlertRuleUpdateRequest = {
              name: updates.name,
              description: updates.description,
              enabled: updates.enabled,
              trigger: updates.trigger,
              channels: updates.channels,
              behavior: updates.behavior,
            };
            await alertAPI.updateRule(workspaceId, projectId, ruleId, payload);
            await queryClient.invalidateQueries({ queryKey: ['alert-rules', workspaceId, projectId] });
            toast.success(tCommon('update_success'));
          }}
          onRuleDelete={async (ruleId) => {
            await alertAPI.deleteRule(workspaceId, projectId, ruleId);
            await queryClient.invalidateQueries({ queryKey: ['alert-rules', workspaceId, projectId] });
            toast.success(tCommon('delete_success'));
          }}
          onRuleTest={async (ruleId) => {
            const result = await alertAPI.testRule(workspaceId, projectId, ruleId);
            toast.info(result.details);
          }}
          onAlertMarkAsRead={(alertId) => {
            setLocalAlerts((prev) =>
              prev.map((alert) =>
                alert.id === alertId && alert.status === 'unread'
                  ? { ...alert, status: 'read', read_at: new Date().toISOString() }
                  : alert
              )
            );
          }}
          onAlertDismiss={(alertId) => {
            setLocalAlerts((prev) =>
              prev.map((alert) =>
                alert.id === alertId
                  ? { ...alert, status: 'dismissed', dismissed_at: new Date().toISOString() }
                  : alert
              )
            );
          }}
        />
      </PageLayout>
    </PageState>
  );
}
