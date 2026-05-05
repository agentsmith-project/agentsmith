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

export function AgentRunnerDetailsCard({
  runner,
  diagnostics,
  diagnosticsLoading,
  t,
  onClose,
}: AgentRunnerDetailsCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface p-6 space-y-4" data-testid="agent-runners__details-card">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('detail_title')}</h2>
          <p className="text-sm text-tertiary">{runner.name}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-sm text-tertiary" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-tertiary">{t('readiness')}</p>
          <p className="text-foreground capitalize">{runner.status}</p>
        </div>
        <div>
          <p className="text-xs text-tertiary">{t('default_endpoint')}</p>
          <p className="text-foreground">{runner.default_endpoint_id ?? t('not_configured')}</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">{t('detail_diagnostics')}</h3>
        <AgentRunnerDiagnosticsPanel diagnostics={diagnostics} loading={diagnosticsLoading} />
      </div>
    </div>
  );
}
