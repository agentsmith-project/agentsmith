import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AgentDiagnostics } from '@/lib/api/types';

export interface AgentDiagnosticsPanelProps {
  diagnostics: AgentDiagnostics | null;
  loading?: boolean;
}

export function AgentDiagnosticsPanel({ diagnostics, loading }: AgentDiagnosticsPanelProps) {
  const t = useTranslations('agents');

  if (loading) {
    return <div className="text-sm text-tertiary">Loading diagnostics...</div>;
  }

  if (!diagnostics) {
    return <div className="text-sm text-tertiary">{t('detail_diagnostics_empty')}</div>;
  }

  return (
    <div className="space-y-3">
      {diagnostics.last_error && (
        <div className="rounded-md border border-subtle bg-surface-high p-3">
          <p className="text-xs text-tertiary mb-1">{t('detail_diagnostics')}</p>
          <p className="text-sm text-foreground">{diagnostics.last_error}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 text-xs text-tertiary">
        {diagnostics.retry_backoff_sec != null && (
          <div>
            {t('diagnostics_backoff')}: {diagnostics.retry_backoff_sec}s
          </div>
        )}
        {diagnostics.queue_depth != null && (
          <div>Queue Depth: {diagnostics.queue_depth}</div>
        )}
        {diagnostics.restarts != null && (
          <div>Restarts: {diagnostics.restarts}</div>
        )}
        {diagnostics.cpu_percent != null && (
          <div>CPU: {diagnostics.cpu_percent}%</div>
        )}
        {diagnostics.memory_mb != null && (
          <div>Memory: {diagnostics.memory_mb} MB</div>
        )}
      </div>
    </div>
  );
}
