'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Mail, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { slugifyWorkspaceId } from '@/lib/system-admin/slugify-workspace-id';
import type {
  SystemWorkspaceDraft,
  SystemWorkspaceDraftAdmin,
  SystemWorkspaceIdpVerificationState,
} from './system-workspaces/types';

type CreateStep = 'basics' | 'identity' | 'administrator' | 'review';

type DirectorySearchResponse = {
  items?: SystemWorkspaceDraftAdmin[];
  error_message?: string;
};

type IdpVerifyResponse = {
  idp_ok?: boolean;
  directory_search_supported?: boolean;
  advice_code?: string;
  error_message?: string;
};

type CreateResponse = {
  id?: string;
  error_message?: string;
};

const EMPTY_DRAFT: SystemWorkspaceDraft = {
  name: '',
  adminMode: 'directory_user',
  adminEmail: '',
  adminQuery: '',
  admin: null,
  loginIdpUrl: '',
  loginIdpRealm: '',
  loginClientId: '',
  directoryClientId: '',
  directoryClientSecret: '',
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function parseJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

export function SystemWorkspaceCreatePage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const router = useRouter();
  const t = useTranslations('system');
  const [step, setStep] = useState<CreateStep>('basics');
  const [draft, setDraft] = useState<SystemWorkspaceDraft>(EMPTY_DRAFT);
  const [idpVerificationState, setIdpVerificationState] = useState<SystemWorkspaceIdpVerificationState>('idle');
  const [idpVerificationNotice, setIdpVerificationNotice] = useState<string | null>(null);
  const [adminSearchResults, setAdminSearchResults] = useState<SystemWorkspaceDraftAdmin[]>([]);
  const [adminSearchLoading, setAdminSearchLoading] = useState(false);
  const [adminSearchError, setAdminSearchError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stepIndex = ['basics', 'identity', 'administrator', 'review'].indexOf(step);
  const idpVerified = idpVerificationState === 'verified_with_directory' || idpVerificationState === 'verified_without_directory';
  const directorySearchEnabled = idpVerificationState === 'verified_with_directory';
  const canContinueIdentity = idpVerified;
  const canContinueAdmin = draft.adminMode === 'directory_user'
    ? Boolean(draft.admin?.user_id)
    : isValidEmail(draft.adminEmail);
  const reviewRows = useMemo(
    () => [
      { label: t('workspace_name'), value: draft.name || t('none') },
      { label: t('idp_title'), value: `${draft.loginIdpRealm || t('none')} · ${draft.loginClientId || t('none')}` },
      {
        label: t('workspace_admin_title'),
        value: draft.adminMode === 'directory_user'
          ? draft.admin?.email || t('none')
          : draft.adminEmail || t('none'),
      },
      { label: t('current_status_label'), value: t('provisioning_status.draft') },
    ],
    [draft, t],
  );
  const workspaceSlug = slugifyWorkspaceId(draft.name || 'workspace');
  const workspaceLoginPath = `/{locale}/workspaces/${workspaceSlug}/login`;
  const workspaceCallbackPath = `/workspaces/${workspaceSlug}/login/callback`;

  const updateDraft = (patch: Partial<SystemWorkspaceDraft>) => {
    const idpChanged = 'loginIdpUrl' in patch
      || 'loginIdpRealm' in patch
      || 'loginClientId' in patch
      || 'directoryClientId' in patch
      || 'directoryClientSecret' in patch;
    const modeChanged = 'adminMode' in patch;
    setDraft((current) => ({
      ...current,
      ...patch,
      ...(idpChanged ? { admin: null, adminQuery: '', adminEmail: current.adminMode === 'email_pending' ? current.adminEmail : '' } : {}),
      ...(modeChanged && patch.adminMode === 'email_pending'
        ? {
            admin: null,
            adminQuery: '',
            adminEmail: patch.adminEmail ?? current.adminEmail ?? current.admin?.email ?? '',
          }
        : {}),
      ...(modeChanged && patch.adminMode === 'directory_user'
        ? {
            adminQuery: patch.adminQuery ?? current.admin?.email ?? current.adminEmail,
          }
        : {}),
    }));
    if (idpChanged) {
      setIdpVerificationState('idle');
      setIdpVerificationNotice(null);
      setAdminSearchResults([]);
      setAdminSearchError(null);
    }
  };

  const verifyIdentityProvider = async () => {
    if (!draft.loginIdpUrl.trim() || !draft.loginIdpRealm.trim() || !draft.loginClientId.trim()) return;
    setIdpVerificationState('verifying');
    setIdpVerificationNotice(null);
    setAdminSearchResults([]);
    setAdminSearchError(null);
    try {
      const response = await fetch('/api/system/workspaces/idp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login_idp_url: draft.loginIdpUrl,
          login_idp_realm: draft.loginIdpRealm,
          login_client_id: draft.loginClientId,
          directory_client_id: draft.directoryClientId.trim() || undefined,
          directory_client_secret: draft.directoryClientSecret.trim() || undefined,
        }),
      });
      const data = await parseJson<IdpVerifyResponse>(response);
      if (!response.ok || !data?.idp_ok) {
        setIdpVerificationState('failed');
        setIdpVerificationNotice(data?.error_message || 'keycloak_idp_invalid');
        return;
      }
      if (data.directory_search_supported) {
        setIdpVerificationState('verified_with_directory');
        setIdpVerificationNotice('idp_directory_ready');
        if (draft.adminMode !== 'directory_user') {
          setDraft((current) => ({ ...current, adminMode: 'directory_user' }));
        }
        return;
      }
      setIdpVerificationState('verified_without_directory');
      setIdpVerificationNotice(data?.advice_code === 'DIRECTORY_PERMISSION_RECOMMENDED'
        ? 'idp_directory_recommended'
        : 'idp_directory_unavailable_but_email_pending_allowed');
      setDraft((current) => ({
        ...current,
        adminMode: 'email_pending',
        admin: null,
        adminQuery: '',
        adminEmail: current.adminEmail || current.admin?.email || '',
      }));
    } catch {
      setIdpVerificationState('failed');
      setIdpVerificationNotice('keycloak_directory_unavailable');
    }
  };

  const searchDirectory = async (query: string) => {
    if (!directorySearchEnabled || query.trim().length < 2) {
      setAdminSearchResults([]);
      setAdminSearchError(null);
      return;
    }
    setAdminSearchLoading(true);
    setAdminSearchError(null);
    try {
      const response = await fetch('/api/system/workspaces/directory/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login_idp_url: draft.loginIdpUrl,
          login_idp_realm: draft.loginIdpRealm,
          login_client_id: draft.loginClientId,
          directory_client_id: draft.directoryClientId.trim() || undefined,
          directory_client_secret: draft.directoryClientSecret.trim() || undefined,
          query: query.trim(),
        }),
      });
      const data = await parseJson<DirectorySearchResponse>(response);
      if (!response.ok) {
        setAdminSearchResults([]);
        setAdminSearchError(data?.error_message || 'keycloak_directory_unavailable');
        return;
      }
      setAdminSearchResults(Array.isArray(data?.items) ? data.items : []);
    } finally {
      setAdminSearchLoading(false);
    }
  };

  const createWorkspace = async () => {
    setIsSubmitting(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/system/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          workspace_admin_mode: draft.adminMode,
          workspace_admin_user_id: draft.adminMode === 'directory_user' ? draft.admin?.user_id : undefined,
          workspace_admin_email: draft.adminMode === 'directory_user'
            ? draft.admin?.email || draft.adminEmail
            : draft.adminEmail,
          login_idp_url: draft.loginIdpUrl,
          login_idp_realm: draft.loginIdpRealm,
          login_client_id: draft.loginClientId,
          directory_client_id: draft.directoryClientId.trim() || undefined,
          directory_client_secret: draft.directoryClientSecret.trim() || undefined,
        }),
      });
      const data = await parseJson<CreateResponse>(response);
      if (!response.ok || !data?.id) {
        setSaveError(data?.error_message || 'invalid_system_workspace_payload');
        return;
      }
      router.push(`/${locale}/system/workspaces?workspace=${encodeURIComponent(data.id)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-5xl space-y-5">
            <header className="rounded-lg border border-subtle bg-surface/95 p-6 shadow-float">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <Link href={`/${locale}/system/workspaces`} className="inline-flex items-center gap-2 text-sm text-tertiary hover:text-secondary">
                    <ChevronLeft className="h-4 w-4" />
                    {t('back_to_workspaces')}
                  </Link>
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('create_panel_title')}</p>
                  <h1 className="text-2xl font-semibold text-foreground" data-testid="system-workspace-create__heading">
                    {t('workspace_create_wizard_title')}
                  </h1>
                  <p className="text-sm leading-6 text-secondary">{t('workspace_create_wizard_subtitle')}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {(['basics', 'identity', 'administrator', 'review'] as const).map((item, index) => (
                  <div
                    key={item}
                    className={[
                      'rounded-md border px-4 py-3',
                      step === item
                        ? 'border-accent/45 bg-accent/10'
                        : index < stepIndex
                          ? 'border-success/30 bg-success/10'
                          : 'border-subtle bg-background',
                    ].join(' ')}
                    data-testid={`system-workspace-create__step--${item}`}
                  >
                    <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_create_step_label', { step: String(index + 1) })}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{t(`workspace_create_step_${item}`)}</p>
                  </div>
                ))}
              </div>
            </header>

            <section className="rounded-lg border border-border bg-surface/95 p-5 shadow-card">
              {step === 'basics' ? (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_basics_label')}</p>
                    <h2 className="text-xl font-semibold text-foreground">{t('workspace_create_step_basics')}</h2>
                    <p className="text-sm text-tertiary">{t('workspace_create_basics_body')}</p>
                  </div>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">{t('workspace_name')}</span>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                      placeholder={t('workspace_name_placeholder')}
                      className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="system-workspaces__draft-name"
                    />
                  </label>
                  <div className="rounded-md border border-subtle bg-background/70 px-4 py-4 text-sm text-secondary">
                    {t('workspace_create_basics_hint')}
                  </div>
                </div>
              ) : null}

              {step === 'identity' ? (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-base font-medium text-foreground">
                      <ShieldCheck className="h-4 w-4" />
                      {t('workspace_create_step_identity')}
                    </div>
                    <p className="text-sm text-tertiary">{t('workspace_create_identity_body')}</p>
                  </div>
                  <div className="grid gap-3">
                    <input
                      type="text"
                      value={draft.loginIdpUrl}
                      onChange={(event) => updateDraft({ loginIdpUrl: event.target.value })}
                      placeholder={t('idp_url_placeholder')}
                      className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="system-workspaces__draft-idp-url"
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        type="text"
                        value={draft.loginIdpRealm}
                        onChange={(event) => updateDraft({ loginIdpRealm: event.target.value })}
                        placeholder={t('idp_realm_placeholder')}
                        className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                        data-testid="system-workspaces__draft-idp-realm"
                      />
                        <input
                          type="text"
                          value={draft.loginClientId}
                          onChange={(event) => updateDraft({ loginClientId: event.target.value })}
                          placeholder={t('login_client_id_placeholder')}
                          className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                          data-testid="system-workspaces__draft-idp-client-id"
                        />
                    </div>
                    <div className="rounded-md border border-subtle bg-background/70 p-4">
                      <p className="text-sm font-medium text-foreground">{t('directory_client_section_title')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('directory_client_section_body')}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <input
                          type="text"
                          value={draft.directoryClientId}
                          onChange={(event) => updateDraft({ directoryClientId: event.target.value })}
                          placeholder={t('directory_client_id_placeholder')}
                          className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                          data-testid="system-workspaces__draft-directory-client-id"
                        />
                        <input
                          type="password"
                          value={draft.directoryClientSecret}
                          onChange={(event) => updateDraft({ directoryClientSecret: event.target.value })}
                          placeholder={t('directory_client_secret_placeholder')}
                          className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                          data-testid="system-workspaces__draft-idp-client-secret"
                        />
                      </div>
                    </div>
                    <div className="rounded-md border border-subtle bg-background/70 p-4 text-sm">
                      <p className="font-medium text-foreground">{t('workspace_login_preview_title')}</p>
                      <div className="mt-3 space-y-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_login_url_label')}</p>
                          <p className="mt-1 break-all text-secondary">{workspaceLoginPath}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_callback_url_label')}</p>
                          <p className="mt-1 break-all text-secondary">{workspaceCallbackPath}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={`rounded-md border px-4 py-4 ${buildVerificationToneClass(idpVerificationState)}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('idp_status_label')}</p>
                        <p className="text-sm font-medium text-foreground" data-testid="system-workspaces__idp-status">
                          {getIdpStateLabel(t, idpVerificationState)}
                        </p>
                        {idpVerificationNotice ? (
                          <p className="text-sm text-secondary" data-testid="system-workspaces__idp-notice">{t(idpVerificationNotice)}</p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void verifyIdentityProvider()}
                        disabled={isSubmitting || idpVerificationState === 'verifying'}
                        data-testid="system-workspaces__verify-idp"
                      >
                        {idpVerificationState === 'verifying' ? t('idp_verify_loading') : t('idp_validate_continue')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {step === 'administrator' ? (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-base font-medium text-foreground">
                      <UserRoundSearch className="h-4 w-4" />
                      {t('workspace_create_step_administrator')}
                    </div>
                    <p className="text-sm text-tertiary">{t('workspace_create_admin_body')}</p>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => updateDraft({ adminMode: 'directory_user' })}
                      disabled={!directorySearchEnabled}
                      className={[
                        'rounded-md border p-4 text-left transition',
                        draft.adminMode === 'directory_user'
                          ? 'border-accent/45 bg-accent/10'
                          : 'border-subtle bg-background hover:border-accent/20',
                        !directorySearchEnabled ? 'cursor-not-allowed opacity-60' : '',
                      ].join(' ')}
                      data-testid="system-workspaces__admin-mode--directory"
                    >
                      <p className="text-sm font-semibold text-foreground">{t('workspace_admin_mode_directory')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('workspace_admin_mode_directory_description')}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft({ adminMode: 'email_pending' })}
                      className={[
                        'rounded-md border p-4 text-left transition',
                        draft.adminMode === 'email_pending'
                          ? 'border-accent/45 bg-accent/10'
                          : 'border-subtle bg-background hover:border-accent/20',
                      ].join(' ')}
                      data-testid="system-workspaces__admin-mode--email"
                    >
                      <p className="text-sm font-semibold text-foreground">{t('workspace_admin_mode_email')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('workspace_admin_mode_email_description')}</p>
                    </button>
                  </div>

                  {draft.adminMode === 'directory_user' ? (
                    <div className="space-y-3 rounded-md border border-subtle bg-background p-4">
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-foreground">{t('workspace_admin')}</span>
                        <input
                          type="text"
                          value={draft.adminQuery}
                          onChange={(event) => {
                            const value = event.target.value;
                            updateDraft({ adminQuery: value, adminEmail: value, admin: null });
                            void searchDirectory(value);
                          }}
                          placeholder={t('workspace_admin_placeholder')}
                          disabled={!directorySearchEnabled}
                          className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary disabled:cursor-not-allowed disabled:opacity-70"
                          data-testid="system-workspaces__draft-admin"
                        />
                      </label>
                      {draft.admin ? (
                        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm text-foreground" data-testid="system-workspaces__selected-admin">
                          <p className="font-medium">{draft.admin.name || draft.admin.email}</p>
                          <p className="text-xs text-tertiary">{draft.admin.email}</p>
                        </div>
                      ) : null}
                      <div className="space-y-2" data-testid="system-workspaces__admin-search-results">
                        {adminSearchLoading ? <p className="text-sm text-tertiary">{t('workspace_admin_search_loading')}</p> : null}
                        {!adminSearchLoading && adminSearchError ? <p className="text-sm text-error">{t('workspace_admin_search_error')}</p> : null}
                        {!adminSearchLoading && !adminSearchError && draft.adminQuery.trim().length >= 2 ? (
                          adminSearchResults.length > 0 ? (
                            adminSearchResults.map((user) => (
                              <button
                                key={user.user_id}
                                type="button"
                                className="flex w-full items-start justify-between rounded-md border border-subtle bg-background px-3 py-3 text-left transition hover:border-accent/40"
                                onClick={() => updateDraft({
                                  admin: user,
                                  adminQuery: user.email,
                                  adminEmail: user.email,
                                })}
                                data-testid={`system-workspaces__admin-option--${user.user_id}`}
                              >
                                <span>
                                  <span className="block text-sm font-medium text-foreground">{user.name || user.email}</span>
                                  <span className="block text-xs text-tertiary">{user.email}</span>
                                </span>
                                <span className="text-xs text-tertiary">{t('workspace_admin_search_select')}</span>
                              </button>
                            ))
                          ) : (
                            <p className="text-sm text-tertiary">{t('workspace_admin_search_empty')}</p>
                          )
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-md border border-subtle bg-background p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Mail className="h-4 w-4" />
                        {t('workspace_admin_email_pending_title')}
                      </div>
                      <p className="text-sm text-secondary">{t('workspace_admin_email_pending_description')}</p>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-foreground">{t('workspace_admin_email_label')}</span>
                        <input
                          type="email"
                          value={draft.adminEmail}
                          onChange={(event) => updateDraft({ adminEmail: event.target.value })}
                          placeholder={t('workspace_admin_email_placeholder')}
                          className="h-11 w-full rounded-md border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                          data-testid="system-workspaces__draft-admin-email"
                        />
                      </label>
                      {idpVerificationState === 'verified_without_directory' ? (
                        <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-3 text-sm text-secondary">
                          {t('idp_directory_recommended')}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {step === 'review' ? (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-base font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                      {t('workspace_create_step_review')}
                    </div>
                    <p className="text-sm text-tertiary">{t('workspace_create_review_body')}</p>
                  </div>
                  <div className="space-y-3 rounded-md border border-subtle bg-background p-4">
                    {reviewRows.map((row) => (
                      <div key={row.label} className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle pb-3 last:border-b-0 last:pb-0">
                        <span className="text-sm text-tertiary">{row.label}</span>
                        <span className="max-w-[70%] text-right text-sm font-medium text-foreground">{row.value}</span>
                      </div>
                    ))}
                  </div>
                  {saveError ? (
                    <div className="rounded-md border border-error/30 bg-error/10 px-4 py-4 text-sm text-error" data-testid="system-workspaces__save-error">
                      {saveError}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(stepIndex === 0 ? 'basics' : (['basics', 'identity', 'administrator', 'review'][stepIndex - 1] as CreateStep))}
                  disabled={stepIndex === 0 || isSubmitting}
                  data-testid="system-workspace-create__back"
                >
                  {t('workspace_create_back')}
                </Button>
                {step !== 'review' ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      if (step === 'basics' && draft.name.trim()) setStep('identity');
                      if (step === 'identity' && canContinueIdentity) setStep('administrator');
                      if (step === 'administrator' && canContinueAdmin) setStep('review');
                    }}
                    disabled={
                      isSubmitting
                      || (step === 'basics' && !draft.name.trim())
                      || (step === 'identity' && !canContinueIdentity)
                      || (step === 'administrator' && !canContinueAdmin)
                    }
                    data-testid="system-workspace-create__next"
                  >
                    {step === 'identity' ? t('idp_validate_continue') : t('workspace_create_next')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void createWorkspace()}
                    disabled={isSubmitting}
                    data-testid="system-workspace-create__create"
                  >
                    {isSubmitting ? t('creating') : t('create_workspace')}
                  </Button>
                )}
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function getIdpStateLabel(
  t: (key: string, values?: Record<string, string>) => string,
  state: SystemWorkspaceIdpVerificationState,
) {
  if (state === 'verified_with_directory') return t('idp_status_verified_with_directory');
  if (state === 'verified_without_directory') return t('idp_status_verified_without_directory');
  if (state === 'verifying') return t('idp_status_verifying');
  if (state === 'failed') return t('idp_status_failed');
  return t('idp_status_idle');
}

function buildVerificationToneClass(state: SystemWorkspaceIdpVerificationState) {
  if (state === 'verified_with_directory') return 'border-success/30 bg-success/10';
  if (state === 'verified_without_directory') return 'border-warning/30 bg-warning/10';
  if (state === 'failed') return 'border-error/30 bg-error/10';
  return 'border-subtle bg-background';
}
