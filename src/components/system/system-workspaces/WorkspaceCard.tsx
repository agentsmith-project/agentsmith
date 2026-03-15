import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, PauseCircle, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';

type WorkspaceCardProps = {
  locale: string;
  t: (key: string, values?: Record<string, string>) => string;
  workspace: PublicSystemWorkspaceRecord;
  selected: boolean;
  onSelect: (workspace: PublicSystemWorkspaceRecord) => void;
};

export function WorkspaceCard({ locale, t, workspace, selected, onSelect }: WorkspaceCardProps) {
  const summary = buildStatusSummary(workspace, locale, t);
  const loginReady = workspace.provisioning_status === 'ready';
  const statusLabel = t(`provisioning_status.${workspace.provisioning_status}`);
  const realm = workspace.idp?.realm?.trim();

  return (
    <article
      className={[
        'rounded-[20px] border p-4 transition-colors',
        selected
          ? 'border-accent/45 bg-accent/10 shadow-[0_16px_30px_rgba(76,119,255,0.14)]'
          : 'border-border bg-surface-high hover:border-white/12 hover:bg-hover',
      ].join(' ')}
      data-testid={`system-workspaces__card--${workspace.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-background text-icon-default">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-foreground">{workspace.name}</h2>
              <p className="mt-1 truncate text-sm text-tertiary">{workspace.id}</p>
            </div>
            <StatusBadge label={statusLabel} tone={workspace.provisioning_status} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_admin_card_label')}</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{workspace.workspace_admin}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_attention_label')}</p>
                <div className="mt-1 flex items-start gap-2">
                  <summary.icon className={`mt-0.5 h-4 w-4 shrink-0 ${summary.iconClassName}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{summary.title}</p>
                    <p className="line-clamp-2 text-xs leading-5 text-tertiary">{summary.body}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_idp_card_label')}</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{realm || t('none')}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('initialized_at_label')}</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{summary.timestamp}</p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-tertiary">
            {t('updated_at', { value: new Date(workspace.updated_at).toLocaleString(locale) })}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={selected ? 'primary' : 'outline'}
          onClick={() => onSelect(workspace)}
          data-testid={`system-workspaces__configure--${workspace.id}`}
        >
          {selected ? t('workspace_selected_action') : t('configure_workspace')}
        </Button>
        {loginReady ? (
          <Link
            href={`/${locale}/workspaces/${workspace.id}/login`}
            data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}
          >
            <Button type="button" variant="outline">
              {t('open_workspace_login')}
            </Button>
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center rounded-xl border border-subtle px-3 text-xs text-tertiary disabled:opacity-100"
            data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}
          >
            {t('workspace_login_unavailable')}
          </button>
        )}
      </div>
    </article>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: PublicSystemWorkspaceRecord['provisioning_status'];
}) {
  const toneClassName = (
    tone === 'ready'
      ? 'border-success/35 bg-success/10 text-success'
      : tone === 'failed'
        ? 'border-error/35 bg-error/10 text-error'
        : tone === 'disabled'
          ? 'border-warning/35 bg-warning/10 text-warning'
          : 'border-border bg-background text-secondary'
  );

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClassName}`}>
      {label}
    </span>
  );
}

function buildStatusSummary(
  workspace: PublicSystemWorkspaceRecord,
  locale: string,
  t: WorkspaceCardProps['t'],
) {
  if (workspace.provisioning_status === 'failed') {
    return {
      icon: AlertTriangle,
      iconClassName: 'text-error',
      title: t('workspace_attention_failed_title'),
      body: workspace.last_init_error || t('workspace_attention_failed_body'),
      timestamp: workspace.last_initialized_at
        ? new Date(workspace.last_initialized_at).toLocaleString(locale)
        : t('not_initialized'),
    };
  }

  if (workspace.provisioning_status === 'provisioning') {
    return {
      icon: Clock3,
      iconClassName: 'text-warning',
      title: t('workspace_attention_provisioning_title'),
      body: t('workspace_attention_provisioning_body'),
      timestamp: workspace.last_initialized_at
        ? new Date(workspace.last_initialized_at).toLocaleString(locale)
        : t('not_initialized'),
    };
  }

  if (workspace.provisioning_status === 'disabled') {
    return {
      icon: PauseCircle,
      iconClassName: 'text-warning',
      title: t('workspace_attention_disabled_title'),
      body: t('workspace_attention_disabled_body'),
      timestamp: workspace.last_initialized_at
        ? new Date(workspace.last_initialized_at).toLocaleString(locale)
        : t('not_initialized'),
    };
  }

  if (workspace.workspace_admin_binding_required || !workspace.workspace_admin_user_id) {
    return {
      icon: Wrench,
      iconClassName: 'text-warning',
      title: t('workspace_attention_binding_title'),
      body: t('workspace_attention_binding_body'),
      timestamp: workspace.last_initialized_at
        ? new Date(workspace.last_initialized_at).toLocaleString(locale)
        : t('not_initialized'),
    };
  }

  return {
    icon: CheckCircle2,
    iconClassName: 'text-success',
    title: t('workspace_attention_ready_title'),
    body: t('workspace_attention_ready_body'),
    timestamp: workspace.last_initialized_at
      ? new Date(workspace.last_initialized_at).toLocaleString(locale)
      : t('not_initialized'),
  };
}
