'use client';

import type { AgentDiagnostics } from '@/lib/api/types';
import { AgentRunnerDiagnosticsPanel } from '@/components/agent-runners/AgentRunnerDiagnosticsPanel';
import { Button } from '@/components/ui/button';

import type { AgentRunnerPageRecord } from '../agent-runners-page-types';

interface AgentRunnerDetailsCardProps {
  runner: AgentRunnerPageRecord;
  diagnostics: AgentDiagnostics | null;
  diagnosticsLoading: boolean;
  t: (key: string) => string;
  onClose: () => void;
}

function sourceLabel(runner: AgentRunnerPageRecord, t: (key: string) => string) {
  return runner.kind === 'system_managed' ? t('source_system_managed') : t('source_developer');
}

function capabilitySummary(capabilities: Record<string, unknown> | null | undefined): string {
  if (!capabilities) return '-';
  const enabled = Object.entries(capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key.replace(/_/g, ' '));
  return enabled.length > 0 ? enabled.join(', ') : '-';
}

export function AgentRunnerDetailsCard({
  runner,
  diagnostics,
  diagnosticsLoading,
  t,
  onClose,
}: AgentRunnerDetailsCardProps) {
  return (
    <div
      className="space-y-4 rounded-md border border-subtle bg-surface px-4 py-4"
      data-testid={`agent-runners__inline-details--${runner.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t('detail_title')}</h3>
          <p className="text-sm text-tertiary">{runner.name}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-sm text-tertiary" onClick={onClose}>
          {t('detail_close')}
        </Button>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-tertiary">{t('readiness')}</p>
          <p className="text-foreground capitalize">{runner.status}</p>
        </div>
        <div>
          <p className="text-xs text-tertiary">{t('source_label')}</p>
          <p className="text-foreground">{sourceLabel(runner, t)}</p>
        </div>
        <div>
          <p className="text-xs text-tertiary">{t('capabilities')}</p>
          <p className="text-foreground capitalize">{capabilitySummary(runner.capabilities)}</p>
        </div>
      </div>

      {runner.kind === 'developer' ? (
        <div className="rounded-md border border-subtle bg-surface-low px-3 py-3 text-sm text-secondary">
          <p className="font-medium text-foreground">{t('connection_instructions_title')}</p>
          <p className="mt-1 text-xs leading-5 text-tertiary">{t('connection_instructions_body')}</p>
        </div>
      ) : (
        <div className="rounded-md border border-subtle bg-surface-low px-3 py-3 text-sm text-secondary">
          <p className="font-medium text-foreground">{t('deployment_capability_title')}</p>
          <p className="mt-1 text-xs leading-5 text-tertiary">{t('deployment_capability_body')}</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">{t('detail_diagnostics')}</h3>
        <AgentRunnerDiagnosticsPanel diagnostics={diagnostics} loading={diagnosticsLoading} />
      </div>
    </div>
  );
}
