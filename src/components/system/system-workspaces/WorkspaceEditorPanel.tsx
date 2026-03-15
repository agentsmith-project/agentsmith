import { Database, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SystemWorkspaceAction, SystemWorkspaceEditorState } from './types';
import { PreviewRow } from './PreviewRow';

type WorkspaceEditorPanelProps = {
  locale: string;
  t: (key: string, values?: Record<string, string>) => string;
  state: SystemWorkspaceEditorState;
  preview: {
    workspace_id: string;
    substrate_label: string;
    database_name: string;
    collection_prefix: string;
    key_prefix: string;
  };
  isSubmitting: boolean;
  activeAction: SystemWorkspaceAction;
  saveError: string | null;
  saveNotice: string | null;
  adminSearchResults: Array<{ user_id: string; email: string; name: string | null }>;
  adminSearchLoading: boolean;
  adminSearchError: string | null;
  onDraftChange: (patch: Partial<SystemWorkspaceEditorState['draft']>) => void;
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
  preview,
  isSubmitting,
  activeAction,
  saveError,
  saveNotice,
  adminSearchResults,
  adminSearchLoading,
  adminSearchError,
  onDraftChange,
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
  const needsAdminBindingRepair = Boolean(
    state.selectedWorkspace
    && state.selectedWorkspace.workspace_admin
    && (
      state.selectedWorkspace.workspace_admin_binding_required
      || !state.selectedWorkspace.workspace_admin_user_id
    ),
  );

  return (
    <aside className="space-y-4 rounded-md border border-border bg-surface p-4" data-testid="system-workspaces__create">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('create_label')}</p>
        <h2 className="text-lg font-semibold text-foreground">{t('create_title')}</h2>
        <p className="text-sm text-tertiary">{t('create_subtitle')}</p>
      </div>

      <div className="rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__mode">
        <p className="text-xs uppercase tracking-[0.08em] text-tertiary">
          {state.isEditingWorkspace ? t('edit_mode_label') : t('create_mode_label')}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">
          {state.isEditingWorkspace
            ? t('editing_workspace', { workspaceId: state.selectedWorkspaceId ?? '' })
            : t('creating_workspace')}
        </p>
      </div>

      <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__basics">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_basics_label')}</p>
          <p className="text-sm font-medium text-foreground">{t('workspace_basics_title')}</p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">{t('workspace_name')}</span>
          <input
            type="text"
            value={state.draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder={t('workspace_name_placeholder')}
            className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
            data-testid="system-workspaces__draft-name"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__admin">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_admin_label')}</p>
          <p className="text-sm font-medium text-foreground">{t('workspace_admin_title')}</p>
          <p className="text-sm text-tertiary">{t('workspace_admin_description')}</p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">{t('workspace_admin')}</span>
          <input
            type="text"
            value={state.draft.adminQuery}
            onChange={(event) => onDraftChange({ adminQuery: event.target.value, admin: null })}
            placeholder={t('workspace_admin_placeholder')}
            className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
            data-testid="system-workspaces__draft-admin"
          />
        </label>
        {state.draft.admin ? (
          <div
            className="rounded-sm border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground"
            data-testid="system-workspaces__selected-admin"
          >
            <p className="font-medium">{state.draft.admin.name || state.draft.admin.email}</p>
            <p className="text-xs text-tertiary">{state.draft.admin.email}</p>
          </div>
        ) : null}
        {needsAdminBindingRepair ? (
          <div
            className="rounded-sm border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
            data-testid="system-workspaces__admin-binding-warning"
          >
            <p className="font-medium">{t('workspace_admin_binding_warning_title')}</p>
            <p className="mt-1 text-xs text-tertiary">{t('workspace_admin_binding_warning_body')}</p>
          </div>
        ) : null}
        <div className="space-y-2" data-testid="system-workspaces__admin-search-results">
          {adminSearchLoading ? <p className="text-sm text-tertiary">{t('workspace_admin_search_loading')}</p> : null}
          {!adminSearchLoading && adminSearchError ? (
            <p className="text-sm text-error">{t('workspace_admin_search_error')}</p>
          ) : null}
          {!adminSearchLoading && !adminSearchError && state.draft.adminQuery.trim().length >= 2 ? (
            adminSearchResults.length > 0 ? (
              adminSearchResults.map((user) => (
                <button
                  key={user.user_id}
                  type="button"
                  className="flex w-full items-start justify-between rounded-sm border border-subtle bg-surface px-3 py-2 text-left transition hover:border-accent/40"
                  onClick={() => onDraftChange({ admin: user, adminQuery: user.email })}
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

      <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__idp">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ShieldCheck className="h-4 w-4" />
          {t('idp_title')}
        </div>
        <input
          type="text"
          value={state.draft.idpUrl}
          onChange={(event) => onDraftChange({ idpUrl: event.target.value })}
          placeholder={t('idp_url_placeholder')}
          className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
          data-testid="system-workspaces__draft-idp-url"
        />
        <input
          type="text"
          value={state.draft.idpRealm}
          onChange={(event) => onDraftChange({ idpRealm: event.target.value })}
          placeholder={t('idp_realm_placeholder')}
          className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
          data-testid="system-workspaces__draft-idp-realm"
        />
        <input
          type="text"
          value={state.draft.idpClientId}
          onChange={(event) => onDraftChange({ idpClientId: event.target.value })}
          placeholder={t('idp_client_id_placeholder')}
          className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
          data-testid="system-workspaces__draft-idp-client-id"
        />
        <input
          type="password"
          value={state.draft.idpClientSecret}
          onChange={(event) => onDraftChange({ idpClientSecret: event.target.value })}
          placeholder={t('idp_client_secret_placeholder')}
          className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
          data-testid="system-workspaces__draft-idp-client-secret"
        />
      </div>

      <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__preview">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Database className="h-4 w-4" />
          {t('preview_title')}
        </div>
        <PreviewRow label={t('preview_workspace_id')} value={preview.workspace_id} />
        <PreviewRow label={t('preview_substrate')} value={preview.substrate_label} />
        <PreviewRow label={t('preview_database')} value={preview.database_name} />
        <PreviewRow label={t('preview_collection_prefix')} value={preview.collection_prefix} />
        <PreviewRow label={t('preview_key_prefix')} value={preview.key_prefix} />
      </div>

      <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__status">
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
        className={`rounded-sm border border-dashed bg-bg-base/20 p-4 text-sm ${statusToneClass}`}
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

      <div className="flex items-center gap-2">
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
    </aside>
  );
}
