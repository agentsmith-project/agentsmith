import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PauseCircle,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';
import {
  getViewerLocalDateTimePresentation,
  type ViewerLocalDateTimePresentation,
} from '@/lib/utils/date-time-format';

type WorkspaceCardProps = {
  locale: string;
  t: (key: string, values?: Record<string, string>) => string;
  workspace: PublicSystemWorkspaceRecord;
  selected: boolean;
  isEditMode: boolean;
  onSelect: (workspace: PublicSystemWorkspaceRecord) => void;
  onConfigure: (workspace: PublicSystemWorkspaceRecord) => void;
};

export function WorkspaceCard({ locale, t, workspace, selected, isEditMode, onSelect, onConfigure }: WorkspaceCardProps) {
  const summary = buildStatusSummary(workspace, locale, t);
  const loginReady = workspace.provisioning_status === 'ready';
  const statusLabel = t(`provisioning_status.${workspace.provisioning_status}`);

  return (
    <article
      role="button"
      tabIndex={0}
      className={[
        'group cursor-pointer border-b border-subtle/60 py-4 text-left transition-colors',
        selected
          ? 'bg-surface/55'
          : 'bg-transparent hover:bg-surface/35',
      ].join(' ')}
      onClick={() => onSelect(workspace)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(workspace);
        }
      }}
      data-testid={`system-workspaces__card--${workspace.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="truncate text-base font-semibold text-foreground">{workspace.name}</h2>
              <p className="truncate text-xs text-tertiary">{workspace.id}</p>
            </div>
            <StatusBadge label={statusLabel} tone={workspace.provisioning_status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-tertiary">{t('workspace_admin_card_label')}</span>
            <span className="truncate text-foreground">{workspace.workspace_admin}</span>
            <span className="text-tertiary">·</span>
            <span className="text-tertiary">{t('initialized_at_label')}</span>
            <span className="truncate text-foreground">
              {renderInitializedAt(summary.timestamp, `system-workspaces__card-initialized-at--${workspace.id}`)}
            </span>
          </div>

          <div className="flex items-start gap-2 border-t border-subtle pt-3">
            <summary.icon className={`mt-0.5 h-4 w-4 shrink-0 ${summary.iconClassName}`} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{summary.title}</p>
              <p className="line-clamp-2 text-xs leading-5 text-tertiary">{summary.body}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                onConfigure(workspace);
              }}
              data-testid={`system-workspaces__configure--${workspace.id}`}
            >
              {selected ? (isEditMode ? t('workspace_editing_action') : t('configure_workspace')) : t('configure_workspace')}
            </Button>
            {loginReady ? (
              <Link
                href={`/${locale}/workspaces/${workspace.id}/login`}
                data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}
                onClick={(event) => event.stopPropagation()}
              >
                <Button type="button" variant="ghost" size="sm">
                  {t('open_workspace_login')}
                </Button>
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex h-9 items-center rounded-md border border-subtle/70 bg-transparent px-3 text-xs text-tertiary disabled:opacity-100"
                data-testid={`system-workspaces__open-workspace-login--${workspace.id}`}
              >
                {t('workspace_login_unavailable')}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function renderInitializedAt(presentation: ViewerLocalDateTimePresentation, testId?: string) {
  if (!presentation.dateTime) {
    return <span>{presentation.text}</span>;
  }

  return (
    <time
      dateTime={presentation.dateTime}
      title={presentation.title}
      data-testid={testId}
      data-visual-datetime={presentation.visualDateTime}
      data-visual-datetime-policy={presentation.visualDateTimePolicy}
    >
      {presentation.text}
    </time>
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
      ? 'border-success/20 bg-success/8 text-foreground'
      : tone === 'failed'
        ? 'border-error/22 bg-error/10 text-foreground'
        : tone === 'disabled'
          ? 'border-warning/22 bg-warning/10 text-foreground'
          : 'border-subtle bg-background text-secondary'
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
  const timestamp = getViewerLocalDateTimePresentation(workspace.last_initialized_at, {
    locale,
    emptyText: t('not_initialized'),
    invalidText: t('not_initialized'),
  });

  if (workspace.provisioning_status === 'failed') {
    return {
      icon: AlertTriangle,
      iconClassName: 'text-error',
      title: t('workspace_attention_failed_title'),
      body: workspace.last_init_error || t('workspace_attention_failed_body'),
      timestamp,
    };
  }

  if (workspace.provisioning_status === 'provisioning') {
    return {
      icon: Clock3,
      iconClassName: 'text-warning',
      title: t('workspace_attention_provisioning_title'),
      body: t('workspace_attention_provisioning_body'),
      timestamp,
    };
  }

  if (workspace.provisioning_status === 'disabled') {
    return {
      icon: PauseCircle,
      iconClassName: 'text-warning',
      title: t('workspace_attention_disabled_title'),
      body: t('workspace_attention_disabled_body'),
      timestamp,
    };
  }

  if (workspace.workspace_admin_binding_required || !workspace.workspace_admin_user_id) {
    return {
      icon: Wrench,
      iconClassName: 'text-warning',
      title: t('workspace_attention_binding_title'),
      body: t('workspace_attention_binding_body'),
      timestamp,
    };
  }

  return {
    icon: CheckCircle2,
    iconClassName: 'text-success',
    title: t('workspace_attention_ready_title'),
    body: t('workspace_attention_ready_body'),
    timestamp,
  };
}
