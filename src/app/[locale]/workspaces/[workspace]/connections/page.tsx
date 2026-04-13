'use client';

import Link from 'next/link';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button, buttonVariants } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { APIError, UserExternalConnectionsAPI, WorkspaceAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { persistFeishuOAuthFlow } from '@/lib/feishu-oauth-flow';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceConnectionsPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const t = useTranslations('third_party_accounts');
  const commonT = useTranslations('common');
  const settingsT = useTranslations('settings');
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canManageWorkspace = useHasWorkspacePermission('workspace:governance:update');
  const workspaceApi = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const connectionsApi = React.useMemo(() => new UserExternalConnectionsAPI(getApiClient()), []);
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace(workspaceId ?? '');

  const { data: integration, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', workspaceId, 'feishu-integration'],
    queryFn: () => workspaceApi.getFeishuIntegration(workspaceId ?? ''),
    enabled: Boolean(workspaceId && canReadWorkspace),
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['me', 'external-connections'],
    queryFn: () => connectionsApi.list(),
    enabled: Boolean(workspaceId && canReadWorkspace),
  });
  const { data: feishuConfig } = useQuery({
    queryKey: ['me', 'external-connections', 'providers', 'feishu'],
    queryFn: () => connectionsApi.getProviderConfig('feishu'),
    enabled: Boolean(workspaceId && canReadWorkspace),
  });

  const workspaceListHref = `/${locale}/workspaces`;
  const personalConnectionsHref = `/${locale}/user/third-party-accounts`;

  const feishuConnection = React.useMemo(
    () => connections.find((item) => item.provider === 'feishu' && item.workspace_id === workspaceId) ?? null,
    [connections, workspaceId],
  );
  const missingFeishuScopes = feishuConnection?.missing_scopes ?? [];
  const feishuReauthReason = feishuConnection?.reauth_reason ?? null;
  const feishuNeedsScopeReauth = feishuConnection?.status === 'reauth_required' && feishuReauthReason === 'missing_scopes';
  const requestedScopes = feishuConfig?.requested_scopes ?? [];

  const startMutation = useMutation({
    mutationFn: async () => workspaceApi.startWorkspaceFeishuAuth(
      workspaceId ?? '',
      `/${locale}/workspaces/${workspaceId}/connections?provider=feishu&connected=1`,
    ),
    onSuccess: (result) => {
      if (workspaceId) {
        persistFeishuOAuthFlow({
          workspaceId,
          intent: 'user_connect',
          redirectPath: `/${locale}/workspaces/${workspaceId}/connections?provider=feishu&connected=1`,
        });
      }
      window.location.assign(result.authorization_url);
    },
    onError: (mutationError) => handleErrorForToast(mutationError),
  });

  const refreshMutation = useMutation({
    mutationFn: async (connectionId: string) => connectionsApi.refresh(connectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'external-connections'] });
    },
    onError: (mutationError) => handleErrorForToast(mutationError),
  });
  const refreshDisabled = refreshMutation.isPending
    || feishuReauthReason === 'missing_scopes'
    || feishuReauthReason === 'refresh_token_missing'
    || feishuReauthReason === 'oauth_not_configured';
  const isEnabled = integration?.status === 'enabled';
  const workspaceStateLabel = isEnabled
    ? t('workspace_connections_workspace_state_enabled')
    : t('workspace_connections_workspace_state_disabled');
  const personalStateLabel = feishuConnection
    ? t('workspace_connections_personal_state_connected')
    : t('workspace_connections_personal_state_not_connected');
  const nextStepLabel = !isEnabled
    ? (canManageWorkspace
      ? t('workspace_connections_next_step_enable_workspace')
      : t('workspace_connections_next_step_wait_for_workspace'))
    : !feishuConnection
      ? t('workspace_connections_next_step_connect_personal')
      : feishuConnection.status === 'reauth_required'
        ? t('workspace_connections_next_step_refresh_personal')
        : t('workspace_connections_next_step_ready');

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-lg font-semibold">{settingsT('feishu_invalid_workspace_title')}</h2>
          <p className="text-sm text-tertiary">{settingsT('feishu_invalid_workspace_description')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild type="button" variant="outline">
              <Link href={workspaceListHref}>{t('workspace_connections_back_to_workspaces')}</Link>
            </Button>
          </div>
        </div>
      </PageState>
    );
  }

  if (!canReadWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-lg font-semibold">{t('workspace_connections_forbidden_title')}</h2>
          <p className="text-sm text-tertiary">{t('workspace_connections_forbidden_description')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild type="button" variant="outline">
              <Link href={workspaceListHref}>{t('workspace_connections_back_to_workspaces')}</Link>
            </Button>
            <Button asChild type="button" variant="primary">
              <Link href={personalConnectionsHref}>{t('workspace_connections_open_personal_connections')}</Link>
            </Button>
          </div>
        </div>
      </PageState>
    );
  }

  if (isError) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-lg font-semibold">{t('workspace_connections_load_failed_title')}</h2>
          <p className="text-sm text-tertiary">
            {error instanceof APIError ? error.message : t('workspace_connections_load_failed_description')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => void refetch()}>{commonT('retry')}</Button>
            <Button asChild type="button" variant="primary">
              <Link href={workspaceListHref}>{t('workspace_connections_back_to_workspaces')}</Link>
            </Button>
          </div>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state={isLoading ? 'loading' : 'success'}>
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 md:px-5 md:py-5 space-y-5">
            <section className="rounded-lg border border-border bg-surface/95 px-5 py-5 shadow-float md:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    <Link2 className="h-3.5 w-3.5" />
                    {settingsT('workspace_integrations_title')}
                  </div>
                  <SectionHeading
                    title={settingsT('workspace_integrations_title')}
                    subtitle={t('workspace_connections_description', { workspace: workspace?.name ?? workspaceId })}
                  />
                  <p className="max-w-3xl text-sm leading-6 text-tertiary">{t('workspace_connections_scope_note')}</p>
                  <p
                    className="max-w-3xl text-sm leading-6 text-secondary"
                    data-testid="workspace-connections__capability-note"
                  >
                    {t('workspace_connections_capability_note')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button" variant="primary">
                    <Link
                      href={`/${locale}/workspaces/${workspaceId}/projects`}
                      data-testid="workspace-connections__open-projects"
                    >
                      {t('workspace_connections_open_projects')}
                    </Link>
                  </Button>
                  {canManageWorkspace ? (
                    <Link
                      href={`/${locale}/workspaces/${workspaceId}/settings/feishu`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {t('workspace_connections_manage_feishu')}
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-subtle bg-background/70 p-4" data-testid="workspace-connections__workspace-state">
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_connections_workspace_state_title')}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{workspaceStateLabel}</p>
                  <p className="mt-2 text-sm leading-6 text-secondary">{isEnabled ? t('workspace_feishu_enabled_description') : t('workspace_feishu_disabled_description')}</p>
                </div>
                <div className="rounded-md border border-subtle bg-background/70 p-4" data-testid="workspace-connections__personal-state">
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_connections_personal_state_title')}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{personalStateLabel}</p>
                  <p className="mt-2 text-sm leading-6 text-secondary">
                    {feishuConnection?.account_identity?.external_email
                      || feishuConnection?.account_identity?.external_name
                      || t('workspace_feishu_not_connected')}
                  </p>
                </div>
                <div className="rounded-md border border-subtle bg-background/70 p-4" data-testid="workspace-connections__next-step">
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_connections_next_step_title')}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{nextStepLabel}</p>
                  <p className="mt-2 text-sm leading-6 text-secondary">
                    {canManageWorkspace ? t('workspace_connections_next_step_admin_detail') : t('workspace_connections_next_step_member_detail')}
                  </p>
                </div>
              </div>
              <div
                className="mt-4 rounded-md border border-subtle bg-background/70 px-4 py-3 text-sm leading-6 text-tertiary"
                data-testid="workspace-connections__resolver-note"
              >
                <p className="font-medium text-foreground">{t('workspace_connections_resolver_note_title')}</p>
                <p className="mt-1">{t('workspace_connections_resolver_note_body')}</p>
              </div>
              {!canManageWorkspace ? (
                <div className="mt-4 rounded-md border border-subtle bg-background/70 px-4 py-3 text-sm leading-6 text-tertiary" data-testid="workspace-connections__read-only-hint">
                  {t('workspace_connections_read_only_hint')}
                </div>
              ) : null}
            </section>

            <section className="rounded-md border border-border bg-surface/95 p-5 shadow-card">
              <div className={cn(
                'rounded-md border p-5 transition-colors',
                isEnabled ? 'border-subtle bg-bg-base/20' : 'border-subtle/60 bg-bg-base/10 opacity-70',
              )}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('provider_feishu')}</div>
                    <div className="text-xl font-semibold text-foreground">{t('workspace_feishu_card_title')}</div>
                    <p className="max-w-2xl text-sm text-secondary">
                      {isEnabled ? t('workspace_feishu_enabled_description') : t('workspace_feishu_disabled_description')}
                    </p>
                  </div>
                  <div className="rounded-full border border-subtle bg-background px-3 py-1 text-xs font-medium text-tertiary">
                    {t(`workspace_feishu_status_${integration?.status ?? 'not_configured'}`)}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-subtle bg-background/70 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_feishu_connection_label')}</div>
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {feishuConnection?.account_identity?.external_email
                        || feishuConnection?.account_identity?.external_name
                        || (feishuConnection ? t('workspace_feishu_connected') : t('workspace_feishu_not_connected'))}
                    </div>
                  </div>
                  <div className="rounded-md border border-subtle bg-background/70 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_feishu_last_refresh_label')}</div>
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {feishuConnection?.last_refreshed_at ?? t('workspace_feishu_never_refreshed')}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => startMutation.mutate()}
                    disabled={!isEnabled || startMutation.isPending}
                    data-testid="workspace-connections__feishu-connect"
                  >
                    {feishuConnection ? t('workspace_feishu_reconnect') : t('workspace_feishu_connect')}
                  </Button>
                  {feishuConnection ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => refreshMutation.mutate(feishuConnection.id)}
                      disabled={refreshDisabled}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {t('refresh_connection')}
                    </Button>
                  ) : null}
                </div>

                {feishuConfig ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-subtle bg-background/70 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_feishu_scope_policy_label')}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {feishuConfig.scope_policy === 'custom'
                          ? t('workspace_feishu_scope_policy_custom')
                          : t('workspace_feishu_scope_policy_full')}
                      </div>
                    </div>
                    <div className="rounded-md border border-subtle bg-background/70 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_feishu_requested_scope_count_label')}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {t('workspace_feishu_requested_scope_count_value', { count: requestedScopes.length })}
                      </div>
                    </div>
                  </div>
                ) : null}

                {requestedScopes.length > 0 ? (
                  <details className="mt-4 rounded-md border border-subtle bg-background/70 p-4 text-sm">
                    <summary className="cursor-pointer font-medium text-foreground">
                      {t('workspace_feishu_requested_scopes_label')}
                    </summary>
                    <p className="mt-2 break-all text-tertiary">{requestedScopes.join(', ')}</p>
                  </details>
                ) : null}

                {feishuConnection?.status === 'reauth_required' ? (
                  <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                    <div className="font-medium text-foreground">
                      {feishuReauthReason === 'missing_scopes'
                        ? t('workspace_feishu_reauth_required_title')
                        : feishuReauthReason === 'refresh_failed'
                          ? t('workspace_feishu_refresh_failed_title')
                          : feishuReauthReason === 'refresh_token_missing'
                            ? t('workspace_feishu_refresh_token_missing_title')
                            : feishuReauthReason === 'oauth_not_configured'
                              ? t('workspace_feishu_oauth_not_configured_title')
                              : t('workspace_feishu_generic_reauth_title')}
                    </div>
                    <p className="mt-1 text-secondary">
                      {feishuReauthReason === 'missing_scopes'
                        ? t('workspace_feishu_reauth_required_description')
                        : feishuReauthReason === 'refresh_failed'
                          ? t('workspace_feishu_refresh_failed_description')
                          : feishuReauthReason === 'refresh_token_missing'
                            ? t('workspace_feishu_refresh_token_missing_description')
                            : feishuReauthReason === 'oauth_not_configured'
                              ? t('workspace_feishu_oauth_not_configured_description')
                              : t('workspace_feishu_generic_reauth_description')}
                    </p>
                    {feishuNeedsScopeReauth && missingFeishuScopes.length > 0 ? (
                      <p className="mt-2 break-all text-tertiary">
                        {t('workspace_feishu_missing_scopes_label')}: {missingFeishuScopes.join(', ')}
                      </p>
                    ) : null}
                    {!feishuNeedsScopeReauth && feishuConnection.last_error ? (
                      <p className="mt-2 break-all text-tertiary">{feishuConnection.last_error}</p>
                    ) : null}
                  </div>
                ) : null}

                {!isEnabled ? (
                  <p className="mt-4 text-sm text-tertiary">{t('workspace_feishu_disabled_hint')}</p>
                ) : null}
              </div>
            </section>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
