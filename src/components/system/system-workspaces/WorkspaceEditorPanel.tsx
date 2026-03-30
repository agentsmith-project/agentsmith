import Link from 'next/link';
import {
  ArrowRight,
  Mail,
  ShieldCheck,
  UserRoundSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { slugifyWorkspaceId } from '@/lib/system-admin/slugify-workspace-id';
import type { SystemWorkspaceAction, SystemWorkspaceEditorState } from './types';
import { PreviewRow } from './PreviewRow';

type WorkspaceEditorPanelProps = {
  locale: string;
  t: (key: string, values?: Record<string, string>) => string;
  state: SystemWorkspaceEditorState;
  isSubmitting: boolean;
  activeAction: SystemWorkspaceAction;
  saveError: string | null;
  saveNotice: string | null;
  adminSearchResults: Array<{ user_id: string; email: string; name: string | null }>;
  adminSearchLoading: boolean;
  adminSearchError: string | null;
  idpVerificationNotice: string | null;
  onDraftChange: (patch: Partial<SystemWorkspaceEditorState['draft']>) => void;
  onEnableEditMode: () => void;
  onCancelEditMode: () => void;
  onVerifyIdp: () => void;
  onSubmit: () => void;
  onPublish: () => void;
  onDisable: () => void;
  onDelete: () => void;
};

export function WorkspaceEditorPanel({
  locale,
  t,
  state,
  isSubmitting,
  activeAction,
  saveError,
  saveNotice,
  adminSearchResults,
  adminSearchLoading,
  adminSearchError,
  idpVerificationNotice,
  onDraftChange,
  onEnableEditMode,
  onCancelEditMode,
  onVerifyIdp,
  onSubmit,
  onPublish,
  onDisable,
  onDelete,
}: WorkspaceEditorPanelProps) {
  const workspace = state.selectedWorkspace;
  const statusValue = t(`provisioning_status.${state.selectedStatus}`);
  const lastInitializedValue = workspace?.last_initialized_at
    ? new Date(workspace.last_initialized_at).toLocaleString(locale)
    : t('not_initialized');
  const idpStateText = (
    state.idpVerificationState === 'verified_with_directory'
      ? t('idp_status_verified_with_directory')
      : state.idpVerificationState === 'verified_without_directory'
        ? t('idp_status_verified_without_directory')
        : state.idpVerificationState === 'verifying'
          ? t('idp_status_verifying')
          : state.idpVerificationState === 'failed'
            ? t('idp_status_failed')
            : t('idp_status_idle')
  );
  const statusPrefix = saveError ? t('status_error') : saveNotice ? t('status_success') : t('status_idle');
  const statusToneClass = saveError
    ? 'border-error/30 bg-error/10 text-error'
    : saveNotice
      ? 'border-success/30 bg-success/10 text-foreground'
      : 'border-subtle bg-background/70 text-tertiary';
  const primaryActionLabel = isSubmitting && activeAction === 'update' ? t('updating') : t('save_draft');
  const disabledByProvisioning = isSubmitting || state.isProvisioning;
  const workspaceStateLabel = workspace?.workspace_admin_binding_required
    ? t('workspace_admin_pending_badge')
    : t('workspace_admin_bound_badge');
  const workspaceStateTone = workspace?.workspace_admin_binding_required
    ? 'border-warning/30 bg-warning/10 text-warning'
    : 'border-success/30 bg-success/10 text-success';
  const formLocked = !state.isEditMode;
  const workspaceSlug = slugifyWorkspaceId((workspace?.name ?? state.draft.name) || 'workspace');
  const workspaceLoginPath = `/{locale}/workspaces/${workspaceSlug}/login`;
  const workspaceCallbackPath = `/workspaces/${workspaceSlug}/login/callback`;

  return (
    <aside
      className="space-y-4 rounded-[28px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
      data-testid="system-workspaces__editor"
    >
      <div className="rounded-[22px] border border-border bg-surface-high p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_detail_label')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-foreground">{workspace?.name}</h2>
              <span className="inline-flex items-center rounded-full border border-subtle bg-background px-3 py-1 text-xs font-medium text-secondary">
                {statusValue}
              </span>
            </div>
            <p className="text-sm text-secondary">{t('workspace_edit_shell_description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${workspaceStateTone}`}>
              {workspaceStateLabel}
            </span>
            {state.isEditMode ? (
              <Button
                type="button"
                variant="outline"
                onClick={onCancelEditMode}
                disabled={isSubmitting}
                data-testid="system-workspaces__cancel-edit"
              >
                {t('cancel')}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onEnableEditMode}
                data-testid="system-workspaces__enable-edit"
              >
                {t('configure_workspace')}
              </Button>
            )}
            {workspace?.provisioning_status === 'ready' ? (
              <Link href={`/${locale}/workspaces/${workspace.id}/login`}>
                <Button type="button" variant="outline" data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}>
                  {t('open_workspace_login')}
                </Button>
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex h-9 items-center rounded-xl border border-subtle px-3 text-xs text-tertiary disabled:opacity-100"
                data-testid={`system-workspaces__open-workspace-login--${workspace?.id ?? 'selected'}`}
              >
                {t('workspace_login_unavailable')}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-subtle bg-background px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_detail_identity_label')}</p>
            <p className="mt-2 truncate text-sm font-semibold text-foreground">{workspace?.id}</p>
          </div>
          <div className="rounded-[18px] border border-subtle bg-background px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_admin_card_label')}</p>
            <p className="mt-2 truncate text-sm font-semibold text-foreground">{workspace?.workspace_admin || t('none')}</p>
          </div>
          <div className="rounded-[18px] border border-subtle bg-background px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('initialized_at_label')}</p>
            <p className="mt-2 truncate text-sm font-semibold text-foreground">{lastInitializedValue}</p>
          </div>
        </div>
        {!state.isEditMode ? (
          <div className="mt-4 rounded-[18px] border border-subtle bg-background/70 px-4 py-3 text-sm text-secondary" data-testid="system-workspaces__read-only-notice">
            {t('workspace_editor_read_only_notice')}
          </div>
        ) : null}
      </div>

      <section className="space-y-4 rounded-[22px] border border-border bg-surface-high p-5" data-testid="system-workspaces__basics">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_basics_label')}</p>
          <p className="text-base font-medium text-foreground">{t('workspace_basics_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_basics_settings_description')}</p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">{t('workspace_name')}</span>
          <input
            type="text"
            value={state.draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder={t('workspace_name_placeholder')}
            disabled={formLocked}
            className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
            data-testid="system-workspaces__draft-name"
          />
        </label>
      </section>

      <section className="space-y-4 rounded-[22px] border border-border bg-surface-high p-5" data-testid="system-workspaces__idp">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-base font-medium text-foreground">
            <ShieldCheck className="h-4 w-4" />
            {t('idp_title')}
          </div>
          <p className="text-sm text-tertiary">{t('idp_settings_description')}</p>
        </div>

        <div className="grid gap-3">
          <input
            type="text"
            value={state.draft.loginIdpUrl}
            onChange={(event) => onDraftChange({ loginIdpUrl: event.target.value })}
            placeholder={t('idp_url_placeholder')}
            disabled={formLocked}
            className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
            data-testid="system-workspaces__draft-idp-url"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <input
              type="text"
              value={state.draft.loginIdpRealm}
              onChange={(event) => onDraftChange({ loginIdpRealm: event.target.value })}
              placeholder={t('idp_realm_placeholder')}
              disabled={formLocked}
              className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
              data-testid="system-workspaces__draft-idp-realm"
            />
              <input
                type="text"
                value={state.draft.loginClientId}
                onChange={(event) => onDraftChange({ loginClientId: event.target.value })}
                placeholder={t('login_client_id_placeholder')}
                disabled={formLocked}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                data-testid="system-workspaces__draft-idp-client-id"
              />
          </div>
          <div className="rounded-[18px] border border-subtle bg-background/70 p-4">
            <p className="text-sm font-medium text-foreground">{t('directory_client_section_title')}</p>
            <p className="mt-1 text-sm text-tertiary">{t('directory_client_section_body')}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={state.draft.directoryClientId}
                onChange={(event) => onDraftChange({ directoryClientId: event.target.value })}
                placeholder={t('directory_client_id_placeholder')}
                disabled={formLocked}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                data-testid="system-workspaces__draft-directory-client-id"
              />
              <input
                type="password"
                value={state.draft.directoryClientSecret}
                onChange={(event) => onDraftChange({ directoryClientSecret: event.target.value })}
                placeholder={t('directory_client_secret_placeholder')}
                disabled={formLocked}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                data-testid="system-workspaces__draft-idp-client-secret"
              />
            </div>
          </div>

          <div className="rounded-[18px] border border-subtle bg-background/70 p-4 text-sm">
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

        <div className={`rounded-[18px] border px-4 py-4 ${buildVerificationToneClass(state.idpVerificationState)}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('idp_status_label')}</p>
              <p className="text-sm font-medium text-foreground" data-testid="system-workspaces__idp-status">{idpStateText}</p>
              {idpVerificationNotice ? (
                <p className="text-sm text-secondary" data-testid="system-workspaces__idp-notice">{t(idpVerificationNotice)}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onVerifyIdp}
              disabled={formLocked || isSubmitting || state.idpVerificationState === 'verifying'}
              data-testid="system-workspaces__verify-idp"
            >
              {state.idpVerificationState === 'verifying' ? t('idp_verify_loading') : t('idp_validate_continue')}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-[22px] border border-border bg-surface-high p-5" data-testid="system-workspaces__admin">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-base font-medium text-foreground">
            <UserRoundSearch className="h-4 w-4" />
            {t('workspace_admin_title')}
          </div>
          <p className="text-sm text-tertiary">{t('workspace_admin_settings_description')}</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <button
            type="button"
            onClick={() => onDraftChange({ adminMode: 'directory_user' })}
            disabled={formLocked || !state.directorySearchEnabled}
            className={[
              'rounded-[18px] border p-4 text-left transition',
              state.draft.adminMode === 'directory_user'
                ? 'border-accent/45 bg-accent/10'
                : 'border-subtle bg-background hover:border-accent/20',
              !state.directorySearchEnabled ? 'cursor-not-allowed opacity-60' : '',
            ].join(' ')}
            data-testid="system-workspaces__admin-mode--directory"
          >
            <p className="text-sm font-semibold text-foreground">{t('workspace_admin_mode_directory')}</p>
            <p className="mt-1 text-sm text-tertiary">{t('workspace_admin_mode_directory_description')}</p>
          </button>
          <button
            type="button"
            onClick={() => onDraftChange({ adminMode: 'email_pending' })}
            disabled={formLocked}
            className={[
              'rounded-[18px] border p-4 text-left transition',
              state.draft.adminMode === 'email_pending'
                ? 'border-accent/45 bg-accent/10'
                : 'border-subtle bg-background hover:border-accent/20',
            ].join(' ')}
            data-testid="system-workspaces__admin-mode--email"
          >
            <p className="text-sm font-semibold text-foreground">{t('workspace_admin_mode_email')}</p>
            <p className="mt-1 text-sm text-tertiary">{t('workspace_admin_mode_email_description')}</p>
          </button>
        </div>

        {state.draft.adminMode === 'directory_user' ? (
          <div className="space-y-3 rounded-[18px] border border-subtle bg-background p-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{t('workspace_admin')}</span>
              <input
                type="text"
                value={state.draft.adminQuery}
                onChange={(event) => onDraftChange({
                  adminQuery: event.target.value,
                  adminEmail: event.target.value,
                  admin: null,
                })}
                placeholder={t('workspace_admin_placeholder')}
                disabled={formLocked || !state.directorySearchEnabled}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="system-workspaces__draft-admin"
              />
            </label>
            {state.draft.admin ? (
              <div
                className="rounded-[16px] border border-success/30 bg-success/10 px-3 py-3 text-sm text-foreground"
                data-testid="system-workspaces__selected-admin"
              >
                <p className="font-medium">{state.draft.admin.name || state.draft.admin.email}</p>
                <p className="text-xs text-tertiary">{state.draft.admin.email}</p>
              </div>
            ) : null}
            <div className="space-y-2" data-testid="system-workspaces__admin-search-results">
              {adminSearchLoading ? <p className="text-sm text-tertiary">{t('workspace_admin_search_loading')}</p> : null}
              {!adminSearchLoading && adminSearchError ? <p className="text-sm text-error">{t('workspace_admin_search_error')}</p> : null}
              {!state.directorySearchEnabled ? (
                <p className="text-sm text-tertiary">{t('workspace_admin_directory_unavailable')}</p>
              ) : null}
              {!adminSearchLoading && !adminSearchError && state.directorySearchEnabled && state.draft.adminQuery.trim().length >= 2 ? (
                adminSearchResults.length > 0 ? (
                  adminSearchResults.map((user) => (
                    <button
                      key={user.user_id}
                      type="button"
                      className="flex w-full items-start justify-between rounded-[16px] border border-subtle bg-background px-3 py-3 text-left transition hover:border-accent/40"
                      onClick={() => onDraftChange({
                        admin: user,
                        adminQuery: user.email,
                        adminEmail: user.email,
                      })}
                      disabled={formLocked}
                      data-testid={`system-workspaces__admin-option--${user.user_id}`}
                    >
                      <span>
                        <span className="block text-sm font-medium text-foreground">{user.name || user.email}</span>
                        <span className="block text-xs text-tertiary">{user.email}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-tertiary">
                        {t('workspace_admin_search_select')}
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-tertiary">{t('workspace_admin_search_empty')}</p>
                )
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-[18px] border border-subtle bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Mail className="h-4 w-4" />
              {t('workspace_admin_email_pending_title')}
            </div>
            <p className="text-sm text-secondary">{t('workspace_admin_email_pending_description')}</p>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{t('workspace_admin_email_label')}</span>
              <input
                type="email"
                value={state.draft.adminEmail}
                onChange={(event) => onDraftChange({ adminEmail: event.target.value })}
                placeholder={t('workspace_admin_email_placeholder')}
                disabled={formLocked}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                data-testid="system-workspaces__draft-admin-email"
              />
            </label>
          </div>
        )}

        {(workspace?.workspace_admin_binding_required || !workspace?.workspace_admin_user_id) && state.draft.adminMode === 'email_pending' ? (
          <div className="rounded-[16px] border border-warning/25 bg-warning/10 px-3 py-3" data-testid="system-workspaces__admin-binding-warning">
            <p className="text-sm font-medium text-foreground">{t('workspace_admin_pending_badge')}</p>
            <p className="mt-1 text-sm text-secondary">{t('workspace_admin_binding_pending_body')}</p>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-[22px] border border-border bg-surface-high p-5" data-testid="system-workspaces__status">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_lifecycle_label')}</p>
          <p className="text-base font-medium text-foreground">{t('workspace_lifecycle_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_lifecycle_settings_description')}</p>
        </div>
        <PreviewRow label={t('current_status_label')} value={statusValue} />
        <PreviewRow label={t('initialized_at_label')} value={lastInitializedValue} />
        <PreviewRow label={t('last_init_error_label')} value={workspace?.last_init_error || t('none')} />
      </section>

      <div className={`rounded-[22px] border px-4 py-4 text-sm ${statusToneClass}`} data-testid="system-workspaces__notice">
        <p className="mb-1 text-[11px] uppercase tracking-[0.08em]" data-testid="system-workspaces__notice-status">
          {statusPrefix}
        </p>
        {saveError ? (
          <p className="text-error" data-testid="system-workspaces__save-error">{saveError}</p>
        ) : saveNotice ? (
          <p className="text-foreground" data-testid="system-workspaces__save-notice">{saveNotice}</p>
        ) : state.isProvisioning ? (
          t('provisioning_notice')
        ) : (
          t('workspace_editor_notice')
        )}
      </div>

      <section className="space-y-4 rounded-[22px] border border-border bg-surface-high p-5" data-testid="system-workspaces__lifecycle">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_actions_label')}</p>
          <p className="text-base font-medium text-foreground">{t('workspace_actions_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_actions_description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!state.canSubmit || disabledByProvisioning}
            data-testid="system-workspaces__save"
          >
            {primaryActionLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onPublish}
            disabled={isSubmitting || !state.canPublish}
            data-testid="system-workspaces__publish"
          >
            {isSubmitting && activeAction === 'publish' ? t('publishing') : t('publish_workspace')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDisable}
            disabled={isSubmitting || !state.canDisable}
            data-testid="system-workspaces__disable"
          >
            {isSubmitting && activeAction === 'disable' ? t('disabling') : t('disable_workspace')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={isSubmitting || !state.canDelete}
            data-testid="system-workspaces__delete"
          >
            {isSubmitting && activeAction === 'delete' ? t('deleting') : t('delete_workspace')}
          </Button>
        </div>
      </section>
    </aside>
  );
}

function buildVerificationToneClass(state: SystemWorkspaceEditorState['idpVerificationState']) {
  if (state === 'verified_with_directory') return 'border-success/30 bg-success/10';
  if (state === 'verified_without_directory') return 'border-warning/30 bg-warning/10';
  if (state === 'failed') return 'border-error/30 bg-error/10';
  return 'border-subtle bg-background';
}
