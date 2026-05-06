'use client';

import { AlertTriangle, CheckCircle2, Clock3, ServerCog } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';

import type { AgentRunnerPageRecord } from '../agent-runners-page-types';

interface AgentRunnerProjectDefaultStatusProps {
  runner?: AgentRunnerPageRecord;
  t: (key: string) => string;
}

type DefaultStatusView = {
  labelKey: string;
  issueKey: string;
  badgeStatus: 'ready' | 'warning' | 'error' | 'info';
  icon: typeof CheckCircle2;
};

function readDiagnosticString(runner: AgentRunnerPageRecord | undefined, key: string): string | undefined {
  const diagnostics = runner?.diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') return undefined;
  const value = (diagnostics as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function hasDiagnosticIssue(runner: AgentRunnerPageRecord | undefined): boolean {
  return Boolean(readDiagnosticString(runner, 'last_error'));
}

function classifyDefaultStatus(runner?: AgentRunnerPageRecord): DefaultStatusView {
  if (!runner) {
    return {
      labelKey: 'default_status_not_configured',
      issueKey: 'default_status_issue_not_configured',
      badgeStatus: 'info',
      icon: Clock3,
    };
  }

  if (runner.status === 'offline') {
    return {
      labelKey: 'default_status_unavailable',
      issueKey: 'default_status_issue_unavailable',
      badgeStatus: 'error',
      icon: AlertTriangle,
    };
  }

  if (runner.status === 'draft') {
    return {
      labelKey: 'default_status_not_configured',
      issueKey: 'default_status_issue_not_configured',
      badgeStatus: 'warning',
      icon: Clock3,
    };
  }

  if (hasDiagnosticIssue(runner)) {
    return {
      labelKey: 'default_status_unavailable',
      issueKey: 'default_status_issue_unavailable',
      badgeStatus: 'error',
      icon: AlertTriangle,
    };
  }

  if (runner.status === 'degraded') {
    return {
      labelKey: 'default_status_warning',
      issueKey: 'default_status_issue_warning',
      badgeStatus: 'warning',
      icon: AlertTriangle,
    };
  }

  return {
    labelKey: 'default_status_ready',
    issueKey: 'default_status_issue_ready',
    badgeStatus: 'ready',
    icon: CheckCircle2,
  };
}

function formatDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString();
}

function sourceLabel(runner: AgentRunnerPageRecord | undefined, t: (key: string) => string) {
  if (!runner) return t('not_configured');
  return runner.kind === 'system_managed' ? t('source_system_managed') : t('source_developer');
}

export function AgentRunnerProjectDefaultStatus({ runner, t }: AgentRunnerProjectDefaultStatusProps) {
  const status = classifyDefaultStatus(runner);
  const Icon = status.icon;
  const lastCheck = formatDateTime(readDiagnosticString(runner, 'last_pong_at')
    ?? readDiagnosticString(runner, 'last_error_at')
    ?? runner?.updated_at);

  return (
    <section
      className="rounded-md border border-subtle bg-surface px-4 py-4"
      data-testid="agent-runners__project-default-status"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-high">
            <ServerCog className="h-4 w-4 text-icon-default" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-tertiary">
              {t('project_default_status_title')}
            </div>
            <div className="text-base font-semibold text-foreground">
              {runner?.name ?? t('default_status_no_runner')}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tertiary">
              <span>{t('source_label')}: {sourceLabel(runner, t)}</span>
              {lastCheck ? <span>{t('last_check')}: {lastCheck}</span> : null}
            </div>
            <div className="text-xs text-tertiary">
              {t('default_status_issue_label')}: {t(status.issueKey)}
            </div>
          </div>
        </div>
        <StatusBadge status={status.badgeStatus} className="shrink-0">
          <Icon className="h-3.5 w-3.5" />
          {t(status.labelKey)}
        </StatusBadge>
      </div>
    </section>
  );
}
