import { Mail, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  onVerifyIdp: () => void;
  onSubmit: () => void;
  onPublish: () => void;
  onDisable: () => void;
  onReset: () => void;
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
  onVerifyIdp,
  onSubmit,
  onPublish,
  onDisable,
  onReset,
  onDelete,
}: WorkspaceEditorPanelProps) {
  const primaryActionLabel = isSubmitting
    ? activeAction === 'update'
      ? t('updating')
      : activeAction === 'delete'
        ? t('deleting')
        : activeAction === 'publish'
          ? t('publishing')
          : activeAction === 'disable'
            ? t('disabling')
            : t('creating')
    : state.selectedWorkspaceId
      ? t('save_draft')
      : t('create_workspace');
  const idleNotice = state.isProvisioning ? t('provisioning_notice') : t('create_notice');
  const statusToneClass = saveError
    ? 'border-error/30 text-error'
    : saveNotice
      ? 'border-success/30 text-foreground'
      : 'border-subtle text-tertiary';
  const statusPrefix = saveError ? t('status_error') : saveNotice ? t('status_success') : t('status_idle');
  const isCreateMode = !state.selectedWorkspaceId;
  const lastInitializedValue = state.selectedWorkspace?.last_initialized_at
    ? new Date(state.selectedWorkspace.last_initialized_at).toLocaleString(locale)
    : t('not_initialized');
  const statusValue = t(`provisioning_status.${state.selectedStatus}`);
  const panelTitle = isCreateMode ? t('create_panel_title') : state.selectedWorkspace?.name || t('create_title');
  const panelSubtitle = isCreateMode ? t('create_panel_subtitle') : t('edit_panel_subtitle');
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

  return (
    <aside className="space-y-4 rounded-[28px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]" data-testid="system-workspaces__create">
      <div className="space-y-4 rounded-[22px] border border-border bg-surface-high p-5">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_detail_label')}</p>
          <h2 className="text-2xl font-semibold text-foreground">{panelTitle}</h2>
          <p className="text-sm leading-6 text-secondary">{panelSubtitle}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-subtle bg-background px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('current_status_label')}</p>
            <p className="mt-2 text-base font-semibold text-foreground">{statusValue}</p>
          </div>
          <div className="rounded-[18px] border border-subtle bg-background px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('initialized_at_label')}</p>
            <p className="mt-2 text-base font-semibold text-foreground">{lastInitializedValue}</p>
          </div>
          <div className="rounded-[18px] border border-subtle bg-background px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_admin_card_label')}</p>
            <p className="mt-2 truncate text-base font-semibold text-foreground">
              {state.draft.adminEmail || state.selectedWorkspace?.workspace_admin || t('none')}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[22px] border border-subtle bg-background/60 p-4" data-testid="system-workspaces__mode">
        <p className="text-xs uppercase tracking-[0.08em] text-tertiary">
          {state.isEditingWorkspace ? t('edit_mode_label') : t('create_mode_label')}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">
          {state.isEditingWorkspace
            ? t('editing_workspace', { workspaceId: state.selectedWorkspaceId ?? '' })
            : t('creating_workspace')}
        </p>
      </div>

      <div className="space-y-4 rounded-[22px] border border-border bg-surface-high p-4" data-testid="system-workspaces__basics">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_basics_label')}</p>
          <p className="text-sm font-medium text-foreground">{t('workspace_basics_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_basics_description')}</p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">{t('workspace_name')}</span>
          <input
            type="text"
            value={state.draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder={t('workspace_name_placeholder')}
            className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
            data-testid="system-workspaces__draft-name"
          />
        </label>
      </div>

      <div className="space-y-4 rounded-[22px] border border-border bg-surface-high p-4" data-testid="system-workspaces__identity-admin">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_identity_admin_label')}</p>
          <p className="text-sm font-medium text-foreground">{t('workspace_identity_admin_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_identity_admin_description')}</p>
        </div>

        <div className="space-y-4 rounded-[18px] border border-subtle bg-background/60 p-4" data-testid="system-workspaces__idp">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="h-4 w-4" />
            {t('idp_title')}
          </div>
          <p className="text-sm text-tertiary">{t('idp_description')}</p>
          <div className="grid gap-3">
            <input
              type="text"
              value={state.draft.idpUrl}
              onChange={(event) => onDraftChange({ idpUrl: event.target.value })}
              placeholder={t('idp_url_placeholder')}
              className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
              data-testid="system-workspaces__draft-idp-url"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={state.draft.idpRealm}
                onChange={(event) => onDraftChange({ idpRealm: event.target.value })}
                placeholder={t('idp_realm_placeholder')}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                data-testid="system-workspaces__draft-idp-realm"
              />
              <input
                type="text"
                value={state.draft.idpClientId}
                onChange={(event) => onDraftChange({ idpClientId: event.target.value })}
                placeholder={t('idp_client_id_placeholder')}
                className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                data-testid="system-workspaces__draft-idp-client-id"
              />
            </div>
            <input
              type="password"
              value={state.draft.idpClientSecret}
              onChange={(event) => onDraftChange({ idpClientSecret: event.target.value })}
              placeholder={t('idp_client_secret_placeholder')}
              className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
              data-testid="system-workspaces__draft-idp-client-secret"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-subtle bg-background px-3 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('idp_status_label')}</p>
              <p className="mt-1 text-sm font-medium text-foreground" data-testid="system-workspaces__idp-status">{idpStateText}</p>
              {idpVerificationNotice ? (
                <p className="mt-1 text-xs text-tertiary" data-testid="system-workspaces__idp-notice">{t(idpVerificationNotice)}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onVerifyIdp}
              disabled={isSubmitting || state.idpVerificationState === 'verifying'}
              data-testid="system-workspaces__verify-idp"
            >
              {state.idpVerificationState === 'verifying' ? t('idp_verify_loading') : t('idp_verify_action')}
            </Button>
          </div>
        </div>

        <div className="space-y-4 rounded-[18px] border border-subtle bg-background/60 p-4" data-testid="system-workspaces__admin">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserRoundSearch className="h-4 w-4" />
            {t('workspace_admin_title')}
          </div>
          <p className="text-sm text-tertiary">{t('workspace_admin_description')}</p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onDraftChange({ adminMode: 'directory_user' })}
              className={[
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                state.draft.adminMode === 'directory_user'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-subtle bg-background text-tertiary hover:text-secondary',
              ].join(' ')}
              data-testid="system-workspaces__admin-mode--directory"
            >
              {t('workspace_admin_mode_directory')}
            </button>
            <button
              type="button"
              onClick={() => onDraftChange({ adminMode: 'email_pending' })}
              className={[
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                state.draft.adminMode === 'email_pending'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-subtle bg-background text-tertiary hover:text-secondary',
              ].join(' ')}
              data-testid="system-workspaces__admin-mode--email"
            >
              {t('workspace_admin_mode_email')}
            </button>
          </div>

          {state.draft.adminMode === 'directory_user' ? (
            <div className="space-y-3">
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
                  disabled={!state.directorySearchEnabled}
                  className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary disabled:cursor-not-allowed disabled:opacity-70"
                  data-testid="system-workspaces__draft-admin"
                />
              </label>
              {state.draft.admin ? (
                <div
                  className="rounded-[18px] border border-success/30 bg-success/10 px-3 py-3 text-sm text-foreground"
                  data-testid="system-workspaces__selected-admin"
                >
                  <p className="font-medium">{state.draft.admin.name || state.draft.admin.email}</p>
                  <p className="text-xs text-tertiary">{state.draft.admin.email}</p>
                </div>
              ) : null}
              <div className="space-y-2" data-testid="system-workspaces__admin-search-results">
                {adminSearchLoading ? <p className="text-sm text-tertiary">{t('workspace_admin_search_loading')}</p> : null}
                {!adminSearchLoading && adminSearchError ? (
                  <p className="text-sm text-error">{t('workspace_admin_search_error')}</p>
                ) : null}
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
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Mail className="h-4 w-4" />
                {t('workspace_admin_email_pending_title')}
              </div>
              <p className="text-sm text-tertiary">{t('workspace_admin_email_pending_description')}</p>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">{t('workspace_admin_email_label')}</span>
                <input
                  type="email"
                  value={state.draft.adminEmail}
                  onChange={(event) => onDraftChange({ adminEmail: event.target.value })}
                  placeholder={t('workspace_admin_email_placeholder')}
                  className="h-10 w-full rounded-xl border border-subtle bg-background px-3 text-sm text-foreground placeholder:text-tertiary"
                  data-testid="system-workspaces__draft-admin-email"
                />
              </label>
            </div>
          )}

          {(state.selectedWorkspace?.workspace_admin_binding_required || !state.selectedWorkspace?.workspace_admin_user_id) && state.draft.adminMode === 'email_pending' ? (
            <div className="rounded-[16px] border border-warning/25 bg-warning/10 px-3 py-3" data-testid="system-workspaces__admin-binding-warning">
              <p className="text-sm font-medium text-foreground">{t('workspace_admin_pending_badge')}</p>
              <p className="mt-1 text-sm text-secondary">{t('workspace_admin_binding_pending_body')}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 rounded-[22px] border border-border bg-surface-high p-4" data-testid="system-workspaces__status">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_status_label')}</p>
          <p className="text-sm font-medium text-foreground">{t('workspace_status_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_status_description')}</p>
        </div>
        <PreviewRow label={t('current_status_label')} value={t(`provisioning_status.${state.selectedStatus}`)} />
        <PreviewRow
          label={t('initialized_at_label')}
          value={
            state.selectedWorkspace?.last_initialized_at
              ? new Date(state.selectedWorkspace.last_initialized_at).toLocaleString(locale)
              : t('not_initialized')
          }
        />
        <PreviewRow label={t('last_init_error_label')} value={state.selectedWorkspace?.last_init_error || t('none')} />
      </div>

      <div
        className={`rounded-[22px] border border-dashed bg-bg-base/20 p-4 text-sm ${statusToneClass}`}
        data-testid="system-workspaces__notice"
      >
        <p className="mb-1 text-[11px] uppercase tracking-[0.08em]" data-testid="system-workspaces__notice-status">
          {statusPrefix}
        </p>
        {saveError ? (
          <p className="text-error" data-testid="system-workspaces__save-error">{saveError}</p>
        ) : saveNotice ? (
          <p className="text-foreground" data-testid="system-workspaces__save-notice">{saveNotice}</p>
        ) : (
          idleNotice
        )}
      </div>

      <div className="space-y-3 rounded-[22px] border border-border bg-surface-high p-4" data-testid="system-workspaces__lifecycle">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_lifecycle_label')}</p>
          <p className="text-sm font-medium text-foreground">{t('workspace_lifecycle_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_lifecycle_description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!state.canSubmit || isSubmitting || state.isProvisioning}
            data-testid="system-workspaces__save"
          >
            {primaryActionLabel}
          </Button>
          {state.selectedWorkspaceId ? (
            <Button
              type="button"
              variant="outline"
              onClick={onPublish}
              disabled={isSubmitting || !state.canPublish}
              data-testid="system-workspaces__publish"
            >
              {isSubmitting && activeAction === 'publish' ? t('publishing') : t('publish_workspace')}
            </Button>
          ) : null}
          {state.selectedWorkspaceId ? (
            <Button
              type="button"
              variant="outline"
              onClick={onDisable}
              disabled={isSubmitting || !state.canDisable}
              data-testid="system-workspaces__disable"
            >
              {isSubmitting && activeAction === 'disable' ? t('disabling') : t('disable_workspace')}
            </Button>
          ) : null}
          {state.selectedWorkspaceId ? (
            <Button type="button" variant="outline" onClick={onReset} data-testid="system-workspaces__reset">
              {t('new_workspace')}
            </Button>
          ) : null}
          {state.selectedWorkspaceId ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={isSubmitting || !state.canDelete}
              data-testid="system-workspaces__delete"
            >
              {isSubmitting && activeAction === 'delete' ? t('deleting') : t('delete_workspace')}
            </Button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
