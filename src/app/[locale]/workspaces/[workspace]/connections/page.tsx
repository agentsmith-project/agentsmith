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
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceConnectionsPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const t = useTranslations('third_party_accounts');
  const settingsT = useTranslations('settings');
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canManageWorkspace = useHasWorkspacePermission('workspace:governance:update');
  const workspaceApi = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const connectionsApi = React.useMemo(() => new UserExternalConnectionsAPI(getApiClient()), []);
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace(workspaceId ?? '');

  const { data: integration, isLoading, isError, error } = useQuery({
    queryKey: ['workspace', workspaceId, 'feishu-integration'],
    queryFn: () => workspaceApi.getFeishuIntegration(workspaceId ?? ''),
    enabled: Boolean(workspaceId && canReadWorkspace),
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['me', 'external-connections'],
    queryFn: () => connectionsApi.list(),
    enabled: Boolean(workspaceId && canReadWorkspace),
  });

  const feishuConnection = React.useMemo(
    () => connections.find((item) => item.provider === 'feishu' && item.workspace_id === workspaceId) ?? null,
    [connections, workspaceId],
  );

  const startMutation = useMutation({
    mutationFn: async () => workspaceApi.startWorkspaceFeishuAuth(
      workspaceId ?? '',
      `/${locale}/workspaces/${workspaceId}/connections?provider=feishu&connected=1`,
    ),
    onSuccess: (result) => {
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

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{settingsT('feishu_invalid_workspace_title')}</h2>
          <p className="text-sm text-tertiary">{settingsT('feishu_invalid_workspace_description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('workspace_connections_forbidden_title')}</h2>
          <p className="text-sm text-tertiary">{t('workspace_connections_forbidden_description')}</p>
        </div>
      </PageState>
    );
  }

  if (isError) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('workspace_connections_load_failed_title')}</h2>
          <p className="text-sm text-tertiary">
            {error instanceof APIError ? error.message : t('workspace_connections_load_failed_description')}
          </p>
        </div>
      </PageState>
    );
  }

  const isEnabled = integration?.status === 'enabled';

  return (
    <PageState state={isLoading ? 'loading' : 'success'}>
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 md:px-5 md:py-5 space-y-5">
            <section className="rounded-[28px] border border-border bg-surface/95 px-5 py-5 shadow-[0_22px_50px_rgba(0,0,0,0.18)] md:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    <Link2 className="h-3.5 w-3.5" />
                    {t('workspace_connections_badge')}
                  </div>
                  <SectionHeading
                    title={t('workspace_connections_title')}
                    subtitle={t('workspace_connections_description', { workspace: workspace?.name ?? workspaceId })}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
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
            </section>

            <section className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
              <div className={cn(
                'rounded-[22px] border p-5 transition-colors',
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
                  <div className="rounded-[18px] border border-subtle bg-background/70 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_feishu_connection_label')}</div>
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {feishuConnection?.account_identity?.external_email
                        || feishuConnection?.account_identity?.external_name
                        || (feishuConnection ? t('workspace_feishu_connected') : t('workspace_feishu_not_connected'))}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-subtle bg-background/70 p-4">
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
                      disabled={refreshMutation.isPending}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {t('refresh_connection')}
                    </Button>
                  ) : null}
                </div>

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
