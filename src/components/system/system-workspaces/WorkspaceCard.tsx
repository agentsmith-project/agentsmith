import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';

type WorkspaceCardProps = {
  locale: string;
  t: (key: string, values?: Record<string, string>) => string;
  workspace: PublicSystemWorkspaceRecord;
  onSelect: (workspace: PublicSystemWorkspaceRecord) => void;
};

export function WorkspaceCard({ locale, t, workspace, onSelect }: WorkspaceCardProps) {
  return (
    <article
      className="rounded-sm border border-subtle bg-bg-base/20 p-4"
      data-testid={`system-workspaces__card--${workspace.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface-high text-icon-default">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{workspace.name}</h2>
          <p className="mt-1 truncate text-sm text-tertiary">{workspace.id}</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-sm border border-subtle bg-surface px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('workspace_status_card_label')}</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {t(`provisioning_status.${workspace.provisioning_status}`)}
              </p>
            </div>
            <div className="rounded-sm border border-subtle bg-surface px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('workspace_admin_card_label')}</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{workspace.workspace_admin}</p>
            </div>
            <div className="rounded-sm border border-subtle bg-surface px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('workspace_idp_card_label')}</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{workspace.idp.realm}</p>
              <p className="mt-1 truncate text-xs text-tertiary">{workspace.idp.url}</p>
            </div>
            <div className="rounded-sm border border-subtle bg-surface px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('workspace_tenant_card_label')}</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{workspace.tenant.substrate_label}</p>
              <p className="mt-1 truncate text-xs text-tertiary">{workspace.tenant.database_name}</p>
            </div>
            <div className="rounded-sm border border-subtle bg-surface px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('initialized_at_label')}</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {workspace.last_initialized_at
                  ? new Date(workspace.last_initialized_at).toLocaleString(locale)
                  : t('not_initialized')}
              </p>
              <p className="mt-1 truncate text-xs text-tertiary">
                {workspace.last_init_error || t('none')}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-tertiary">
            {t('updated_at', { value: new Date(workspace.updated_at).toLocaleString(locale) })}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onSelect(workspace)}
          data-testid={`system-workspaces__configure--${workspace.id}`}
        >
          {t('configure_workspace')}
        </Button>
        {workspace.provisioning_status === 'ready' ? (
          <Link
            href={`/${locale}/workspaces/${workspace.id}/login`}
            data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}
          >
            <Button type="button" variant="outline">
              {t('open_workspace_login')}
            </Button>
          </Link>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled
            data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}
          >
            {t('workspace_login_unavailable')}
          </Button>
        )}
      </div>
    </article>
  );
}
