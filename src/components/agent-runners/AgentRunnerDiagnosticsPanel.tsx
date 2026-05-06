import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AgentDiagnostics } from '@/lib/api/types';

export interface AgentRunnerDiagnosticsPanelProps {
  diagnostics: AgentDiagnostics | null;
  loading?: boolean;
}

type DiagnosticsIssuePresentation = {
  titleKey: string;
  descriptionKey: string;
};

const CONNECTION_ISSUE_CODES = new Set([
  'agent_runner_disconnected',
  'agent_runner_stale',
  'agent_runner_unavailable',
  'agent_runner_runtime_unavailable',
  'agent_runner_not_resolved',
  'terminal_runner_unavailable',
  'terminal_runner_not_resolved',
]);

const ACCESS_ISSUE_CODES = new Set([
  'agent_runner_forbidden',
  'permission_denied',
  'agent_runner_read_forbidden',
]);

function normalizeDiagnosticsCode(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getDiagnosticsIssuePresentation(lastError: string): DiagnosticsIssuePresentation {
  const code = normalizeDiagnosticsCode(lastError);

  if (code === 'agent_runner_spec_mismatch') {
    return {
      titleKey: 'diagnostics_runner_spec_mismatch_title',
      descriptionKey: 'diagnostics_runner_spec_mismatch_description',
    };
  }

  if (CONNECTION_ISSUE_CODES.has(code)) {
    return {
      titleKey: 'diagnostics_connection_issue_title',
      descriptionKey: 'diagnostics_connection_issue_description',
    };
  }

  if (ACCESS_ISSUE_CODES.has(code)) {
    return {
      titleKey: 'diagnostics_access_issue_title',
      descriptionKey: 'diagnostics_access_issue_description',
    };
  }

  return {
    titleKey: 'diagnostics_general_issue_title',
    descriptionKey: 'diagnostics_general_issue_description',
  };
}

export function AgentRunnerDiagnosticsPanel({ diagnostics, loading }: AgentRunnerDiagnosticsPanelProps) {
  const t = useTranslations('agent_runners');

  if (loading) {
    return <div className="text-sm text-tertiary">{t('detail_diagnostics_loading')}</div>;
  }

  if (!diagnostics) {
    return <div className="text-sm text-tertiary">{t('detail_diagnostics_empty')}</div>;
  }

  const issuePresentation = diagnostics.last_error
    ? getDiagnosticsIssuePresentation(diagnostics.last_error)
    : null;

  return (
    <div className="space-y-3">
      {issuePresentation && (
        <div className="rounded-md border border-subtle bg-surface-high p-3">
          <div className="space-y-1">
            <p className="text-xs text-tertiary">{t('diagnostics_status_label')}</p>
            <p className="text-sm font-medium text-foreground">{t(issuePresentation.titleKey)}</p>
            <p className="text-sm text-tertiary">{t(issuePresentation.descriptionKey)}</p>
          </div>
          {diagnostics.last_error_at && (
            <p className="mt-2 text-xs text-tertiary">
              {t('diagnostics_last_error_at', { value: diagnostics.last_error_at })}
            </p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 text-xs text-tertiary">
        {diagnostics.retry_backoff_sec != null && (
          <div>
            {t('diagnostics_backoff')}: {diagnostics.retry_backoff_sec}s
          </div>
        )}
        {diagnostics.queue_depth != null && (
          <div>{t('diagnostics_queue_depth')}: {diagnostics.queue_depth}</div>
        )}
        {diagnostics.restarts != null && (
          <div>{t('diagnostics_restarts')}: {diagnostics.restarts}</div>
        )}
        {diagnostics.cpu_percent != null && (
          <div>{t('diagnostics_cpu_percent')}: {diagnostics.cpu_percent}%</div>
        )}
        {diagnostics.memory_mb != null && (
          <div>{t('diagnostics_memory_mb')}: {diagnostics.memory_mb} MB</div>
        )}
      </div>
    </div>
  );
}
