'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Mail, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageToolbar } from '@/components/layout/PageToolbar';
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
  const directorySearchEnabled = idpVerificationState === 'verified_with_directory';
  const canContinueIdentity = Boolean(
    draft.loginIdpUrl.trim() &&
    draft.loginIdpRealm.trim() &&
    draft.loginClientId.trim(),
  );
  const canContinueAdmin = draft.adminMode === 'directory_user'
    ? Boolean(draft.admin?.user_id)
    : isValidEmail(draft.adminEmail);
  const workspaceSlug = slugifyWorkspaceId(draft.name || 'workspace');
  const workspaceLoginPath = `/${locale}/workspaces/${workspaceSlug}/login`;
  const workspaceCallbackPath = `/${locale}/workspaces/${workspaceSlug}/login/callback`;
  const adminHandoffState = draft.adminMode === 'directory_user'
    ? t('workspace_admin_bound_badge')
    : t('workspace_admin_pending_badge');
  const adminHandoffBody = draft.adminMode === 'directory_user'
    ? t('workspace_admin_binding_ready_body')
    : t('workspace_admin_binding_pending_body');
  const reviewRows = [
    { label: t('workspace_name'), value: draft.name || t('none') },
    { label: t('idp_title'), value: `${draft.loginIdpRealm || t('none')} · ${draft.loginClientId || t('none')}` },
    { label: t('workspace_login_url_label'), value: workspaceLoginPath },
    { label: t('workspace_callback_url_label'), value: workspaceCallbackPath },
    {
      label: t('workspace_admin_title'),
      value: draft.adminMode === 'directory_user'
        ? draft.admin?.email || t('none')
        : draft.adminEmail || t('none'),
    },
    { label: t('current_status_label'), value: t('provisioning_status.draft') },
  ];

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
    if (!draft.loginIdpUrl.trim() || !draft.loginIdpRealm.trim() || !draft.loginClientId.trim()) return false;
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
        return false;
      }
      if (data.directory_search_supported) {
        setIdpVerificationState('verified_with_directory');
        setIdpVerificationNotice('idp_directory_ready');
        if (draft.adminMode !== 'directory_user') {
          setDraft((current) => ({ ...current, adminMode: 'directory_user' }));
        }
        return true;
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
      return true;
    } catch {
      setIdpVerificationState('failed');
      setIdpVerificationNotice('keycloak_directory_unavailable');
      return false;
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

  const handlePrimaryAction = async () => {
    if (step === 'basics') {
      if (draft.name.trim()) setStep('identity');
      return;
    }

    if (step === 'identity') {
      const verified = await verifyIdentityProvider();
      if (verified) setStep('administrator');
      return;
    }

    if (step === 'administrator') {
      if (canContinueAdmin) setStep('review');
      return;
    }

    if (step === 'review') {
      await createWorkspace();
    }
  };

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={t('workspace_create_wizard_title')}
            subtitle={t('workspace_create_wizard_subtitle')}
            variant="compact"
            actions={(
              <Link href={`/${locale}/system/workspaces`} className="inline-flex items-center gap-2 text-sm text-tertiary hover:text-secondary">
                <ChevronLeft className="h-4 w-4" />
                {t('back_to_workspaces')}
              </Link>
            )}
          />
        )}
        toolbar={(
          <PageToolbar className="w-full">
            <div className="grid w-full gap-3 md:grid-cols-4" data-testid="system-workspace-create__step-tracker">
              {(['basics', 'identity', 'administrator', 'review'] as const).map((item, index) => {
                const isActive = step === item;
                const isComplete = index < stepIndex;

                return (
                  <div
                    key={item}
                    className="flex items-start gap-3 border-t border-subtle pt-3"
                    data-testid={`system-workspace-create__step--${item}`}
                  >
                    <span
                      className={[
                        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium',
                        isActive
                          ? 'border-border bg-surface text-foreground'
                          : isComplete
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'border-subtle bg-background text-tertiary',
                      ].join(' ')}
                    >
                      {index + 1}
                    </span>
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_create_step_label', { step: String(index + 1) })}</p>
                      <p className="text-sm font-medium text-foreground">{t(`workspace_create_step_${item}`)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </PageToolbar>
        )}
      >
        <div className="mx-auto max-w-5xl space-y-5">
            <section className="space-y-5 bg-transparent py-2" data-testid="system-workspace-create__shell">
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
                  <div className="border-t border-subtle pt-3 text-sm text-secondary">
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
                    <div className="border-t border-subtle pt-4">
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
                          ? 'border-border bg-surface'
                          : 'border-subtle bg-background hover:border-border',
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
                          ? 'border-border bg-surface'
                          : 'border-subtle bg-background hover:border-border',
                      ].join(' ')}
                      data-testid="system-workspaces__admin-mode--email"
                    >
                      <p className="text-sm font-semibold text-foreground">{t('workspace_admin_mode_email')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('workspace_admin_mode_email_description')}</p>
                    </button>
                  </div>

                  {draft.adminMode === 'directory_user' ? (
                    <div className="space-y-3 border-t border-subtle pt-4">
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
                        <div className="border-l-2 border-success/30 pl-3 text-sm text-foreground" data-testid="system-workspaces__selected-admin">
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
                    <div className="space-y-3 border-t border-subtle pt-4">
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
                        <div className="border-l-2 border-warning/25 pl-3 text-sm text-secondary">
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
                  <div className="space-y-3 border-t border-subtle pt-4 text-sm">
                    <p className="font-medium text-foreground">{t('workspace_login_preview_title')}</p>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_login_url_label')}</p>
                        <p className="mt-1 break-all text-secondary" data-testid="system-workspace-create__login-preview">{workspaceLoginPath}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_callback_url_label')}</p>
                        <p className="mt-1 break-all text-secondary" data-testid="system-workspace-create__callback-preview">{workspaceCallbackPath}</p>
                      </div>
                    </div>
                  </div>
                  <div className="border-l-2 border-border pl-3 text-sm" data-testid="system-workspace-create__handoff-summary">
                    <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_admin_handoff_label')}</p>
                    <p className="mt-1 font-medium text-foreground" data-testid="system-workspace-create__handoff-state">{adminHandoffState}</p>
                    <p className="mt-1 text-secondary" data-testid="system-workspace-create__handoff-body">{adminHandoffBody}</p>
                  </div>
                  <div className="space-y-3 border-t border-subtle pt-4">
                    {reviewRows.map((row) => (
                      <div key={row.label} className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0">
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
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void handlePrimaryAction()}
                  disabled={
                    isSubmitting
                    || (step === 'basics' && !draft.name.trim())
                    || (step === 'identity' && (!canContinueIdentity || idpVerificationState === 'verifying'))
                    || (step === 'administrator' && !canContinueAdmin)
                  }
                  data-testid={step === 'review' ? 'system-workspace-create__create' : 'system-workspace-create__next'}
                >
                  {step === 'review'
                    ? (isSubmitting ? t('creating') : t('create_workspace'))
                    : step === 'identity'
                      ? (idpVerificationState === 'verifying' ? t('idp_verify_loading') : t('idp_validate_continue'))
                      : t('workspace_create_next')}
                </Button>
              </div>
            </section>
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
