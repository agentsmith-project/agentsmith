import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AgentDiagnostics } from '@/lib/api/types';

export interface AgentRunnerDiagnosticsPanelProps {
  diagnostics: AgentDiagnostics | null;
  loading?: boolean;
}

export function AgentRunnerDiagnosticsPanel({ diagnostics, loading }: AgentRunnerDiagnosticsPanelProps) {
  const t = useTranslations('agent_runners');

  if (loading) {
    return <div className="text-sm text-tertiary">Loading diagnostics...</div>;
  }

  if (!diagnostics) {
    return <div className="text-sm text-tertiary">{t('detail_diagnostics_empty')}</div>;
  }

  const runnerSpecMismatch = diagnostics.last_error === 'agent_runner_spec_mismatch';

  return (
    <div className="space-y-3">
      {diagnostics.last_error && (
        <div className="rounded-md border border-subtle bg-surface-high p-3">
          <p className="text-xs text-tertiary mb-1">{t('detail_diagnostics')}</p>
          {runnerSpecMismatch && (
            <div className="mb-3 space-y-1">
              <p className="text-sm font-medium text-foreground">{t('diagnostics_runner_spec_mismatch_title')}</p>
              <p className="text-sm text-tertiary">{t('diagnostics_runner_spec_mismatch_description')}</p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs text-tertiary">{t('diagnostics_raw_error')}</p>
            <p className="text-sm text-foreground">{diagnostics.last_error}</p>
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
