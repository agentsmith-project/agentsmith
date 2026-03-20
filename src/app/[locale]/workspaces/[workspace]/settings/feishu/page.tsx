'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, PencilLine, ShieldCheck } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeading } from '@/components/ui/section-heading';
import { APIError, WorkspaceAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

type WizardStep = 1 | 2 | 3 | 4;

function resolveStep(status: string, explicit: string | null): WizardStep {
  if (explicit === 'credentials') return 2;
  if (explicit === 'verify') return 3;
  if (explicit === 'enable') return 4;
  if (status === 'enabled' || status === 'verified') return 4;
  if (status === 'verification_required') return 3;
  return 1;
}

export default function WorkspaceFeishuSettingsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('settings');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const canManageWorkspace = useHasWorkspacePermission('workspace:governance:update');
  const api = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const queryClient = useQueryClient();

  const { data: workspace } = useWorkspace(workspaceId ?? '');
  const { data: integration, isLoading, isError, error } = useQuery({
    queryKey: ['workspace', workspaceId, 'feishu-integration'],
    queryFn: () => api.getFeishuIntegration(workspaceId ?? ''),
    enabled: Boolean(workspaceId && canManageWorkspace),
  });

  const [appId, setAppId] = React.useState('');
  const [appSecret, setAppSecret] = React.useState('');
  const [redirectUri, setRedirectUri] = React.useState('');
  const [step, setStep] = React.useState<WizardStep>(1);
  const [isEditing, setIsEditing] = React.useState(false);

  React.useEffect(() => {
    if (!integration) return;
    setAppId(integration.app_id ?? '');
    setRedirectUri(integration.redirect_uri ?? '');
    setStep(resolveStep(integration.status, searchParams.get('step')));
    setIsEditing(integration.status !== 'enabled');
  }, [integration, searchParams]);

  const invalidate = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'feishu-integration'] });
  }, [queryClient, workspaceId]);

  const saveMutation = useMutation({
    mutationFn: async () => api.updateFeishuIntegration(workspaceId ?? '', {
      app_id: appId.trim(),
      app_secret: appSecret.trim() || undefined,
      redirect_uri: redirectUri.trim(),
    }),
    onSuccess: async () => {
      await invalidate();
      setAppSecret('');
      setStep(3);
      setIsEditing(true);
    },
    onError: (mutationError) => handleErrorForToast(mutationError),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => api.startFeishuVerification(
      workspaceId ?? '',
      `/${locale}/workspaces/${workspaceId}/settings/feishu?step=enable&verified=1`,
    ),
    onSuccess: (result) => {
      window.location.assign(result.authorization_url);
    },
    onError: (mutationError) => handleErrorForToast(mutationError),
  });

  const enableMutation = useMutation({
    mutationFn: async () => api.enableFeishuIntegration(workspaceId ?? ''),
    onSuccess: async () => {
      await invalidate();
      setIsEditing(false);
      setStep(4);
    },
    onError: (mutationError) => handleErrorForToast(mutationError),
  });

  const recommendedCallback = React.useMemo(() => {
    if (!workspaceId) return '';
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/workspaces/${workspaceId}/feishu/callback`;
  }, [workspaceId]);

  const workspaceBasePath = workspaceId ? `/${locale}/workspaces/${workspaceId}` : `/${locale}/workspaces`;
  const status = integration?.status ?? 'not_configured';
  const showLockedView = status === 'enabled' && !isEditing;

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('feishu_invalid_workspace_title')}</h2>
          <p className="text-sm text-tertiary">{t('feishu_invalid_workspace_description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canManageWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('feishu_admin_required_title')}</h2>
          <p className="text-sm text-tertiary">{t('feishu_admin_required_description')}</p>
        </div>
      </PageState>
    );
  }

  if (isError) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('feishu_load_failed_title')}</h2>
          <p className="text-sm text-tertiary">
            {error instanceof APIError ? error.message : t('feishu_load_failed_description')}
          </p>
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
            <section className="rounded-[28px] border border-border bg-surface/95 px-5 py-5 shadow-[0_22px_50px_rgba(0,0,0,0.18)] md:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t('feishu_setup_badge')}
                  </div>
                  <SectionHeading
                    title={t('feishu_setup_title')}
                    subtitle={t('feishu_setup_description', { workspace: workspace?.name ?? workspaceId })}
                  />
                </div>
                <Link
                  href={`${workspaceBasePath}/settings`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  {t('feishu_back_to_settings')}
                </Link>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {([
                  t('feishu_step_prepare'),
                  t('feishu_step_credentials'),
                  t('feishu_step_verify'),
                  t('feishu_step_enable'),
                ] as const).map((label, index) => {
                  const isActive = step === index + 1;
                  const isComplete = step > index + 1 || (index === 3 && status === 'enabled');
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setStep((index + 1) as WizardStep)}
                      className={cn(
                        'rounded-[18px] border p-4 text-left transition-colors',
                        isActive ? 'border-accent bg-accent/10' : 'border-subtle bg-bg-base/20',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_step_label', { step: index + 1 })}</span>
                        {isComplete ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
                      </div>
                      <div className="mt-2 text-sm font-medium text-foreground">{label}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
              {showLockedView ? (
                <div className="space-y-5" data-testid="ws-feishu__locked">
                  <SectionHeading
                    title={t('feishu_locked_title')}
                    subtitle={t('feishu_locked_description')}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_status_label')}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">{t(`feishu_status_${status}`)}</div>
                    </div>
                    <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_verified_by_label')}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">{integration?.verified_by_email || t('feishu_not_verified_yet')}</div>
                    </div>
                    <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_redirect_uri_label')}</div>
                      <div className="mt-2 break-all text-sm font-medium text-foreground">{integration?.redirect_uri || t('feishu_callback_unavailable')}</div>
                    </div>
                    <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_scope_label')}</div>
                      <div className="mt-2 text-sm text-foreground">{t('feishu_scope_description')}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3">
                    <Button type="button" variant="outline" asChild>
                      <Link href={`${workspaceBasePath}/connections`}>
                        {t('feishu_open_connections')}
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        setIsEditing(true);
                        setStep(2);
                      }}
                      data-testid="ws-feishu__edit"
                    >
                      <PencilLine className="mr-2 h-4 w-4" />
                      {t('feishu_edit_cta')}
                    </Button>
                  </div>
                </div>
              ) : step === 1 ? (
                <div className="space-y-5">
                  <SectionHeading
                    title={t('feishu_prepare_title')}
                    subtitle={t('feishu_prepare_description')}
                  />
                  <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4 space-y-3 text-sm text-secondary">
                    <p>{t('feishu_prepare_item_app')}</p>
                    <p>{t('feishu_prepare_item_secret')}</p>
                    <p>{t('feishu_prepare_item_callback')}</p>
                  </div>
                  <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                    <Label className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_recommended_callback_label')}</Label>
                    <div className="mt-2 break-all rounded-xl border border-subtle bg-background px-3 py-2 text-sm text-foreground">
                      {recommendedCallback || t('feishu_callback_unavailable')}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="primary" onClick={() => setStep(2)} data-testid="ws-feishu__continue-prepare">
                      {t('feishu_continue')}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {!showLockedView && step === 2 ? (
                <div className="space-y-5">
                  <SectionHeading
                    title={t('feishu_credentials_title')}
                    subtitle={t('feishu_credentials_description')}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="feishu-app-id">{t('feishu_app_id_label')}</Label>
                      <Input id="feishu-app-id" value={appId} onChange={(event) => setAppId(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="feishu-app-secret">{t('feishu_app_secret_label')}</Label>
                      <Input
                        id="feishu-app-secret"
                        type="password"
                        value={appSecret}
                        onChange={(event) => setAppSecret(event.target.value)}
                        placeholder={integration?.has_app_secret ? t('feishu_secret_keep_placeholder') : undefined}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="feishu-redirect-uri">{t('feishu_redirect_uri_label')}</Label>
                    <Input id="feishu-redirect-uri" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} />
                  </div>
                  {integration?.status === 'enabled' ? (
                    <div className="rounded-[18px] border border-warning/30 bg-warning/10 p-4 text-sm text-secondary">
                      {t('feishu_edit_warning')}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setStep(1)}>
                      {t('feishu_back')}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => saveMutation.mutate()}
                      disabled={
                        saveMutation.isPending
                        || !appId.trim()
                        || !redirectUri.trim()
                        || (!appSecret.trim() && !integration?.has_app_secret)
                      }
                      data-testid="ws-feishu__save-draft"
                    >
                      {saveMutation.isPending ? t('feishu_saving') : t('feishu_save_and_continue')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!showLockedView && step === 3 ? (
                <div className="space-y-5">
                  <SectionHeading
                    title={t('feishu_verify_title')}
                    subtitle={t('feishu_verify_description')}
                  />
                  <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4 space-y-2 text-sm">
                    <p className="text-foreground">{t('feishu_verify_requirement')}</p>
                    <p className="text-secondary">{t('feishu_verify_result_hint')}</p>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setStep(2)}>
                      {t('feishu_back')}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => verifyMutation.mutate()}
                      disabled={verifyMutation.isPending || !integration || !integration.has_app_secret || !integration.app_id || !integration.redirect_uri}
                      data-testid="ws-feishu__verify-start"
                    >
                      {verifyMutation.isPending ? t('feishu_redirecting') : t('feishu_verify_cta')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!showLockedView && step === 4 ? (
                <div className="space-y-5">
                  <SectionHeading
                    title={t('feishu_enable_title')}
                    subtitle={t('feishu_enable_description')}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_status_label')}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">{t(`feishu_status_${status}`)}</div>
                    </div>
                    <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('feishu_verified_by_label')}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">{integration?.verified_by_email || t('feishu_not_verified_yet')}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setStep(3)}>
                      {t('feishu_back')}
                    </Button>
                    <div className="flex gap-3">
                      <Link
                        href={`${workspaceBasePath}/connections`}
                        className={cn(buttonVariants({ variant: 'outline', size: 'default' }))}
                      >
                        {t('feishu_open_connections')}
                      </Link>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => enableMutation.mutate()}
                        disabled={enableMutation.isPending || (status !== 'verified' && status !== 'enabled')}
                        data-testid="ws-feishu__enable"
                      >
                        {enableMutation.isPending ? t('feishu_enabling') : t('feishu_enable_cta')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
