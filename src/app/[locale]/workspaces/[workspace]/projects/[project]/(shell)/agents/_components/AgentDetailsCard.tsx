'use client';

import type { AgentDiagnostics } from '@/lib/api/types';
import { AgentDiagnosticsPanel } from '@/components/agents/AgentDiagnosticsPanel';
import { Button } from '@/components/ui/button';

import type { AgentsPageAgent } from '../agents-page-types';

interface AgentDetailsCardProps {
  agent: AgentsPageAgent;
  diagnostics: AgentDiagnostics | null;
  diagnosticsLoading: boolean;
  t: (key: string) => string;
  onClose: () => void;
}

export function AgentDetailsCard({
  agent,
  diagnostics,
  diagnosticsLoading,
  t,
  onClose,
}: AgentDetailsCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('detail_title')}</h2>
          <p className="text-sm text-tertiary">{agent.name}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-sm text-tertiary" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-tertiary">{t('mode_external')}</p>
          <p className="text-foreground capitalize">{agent.mode}</p>
        </div>
        <div>
          <p className="text-xs text-tertiary">{t('interaction_kind')}</p>
          <p className="text-foreground capitalize">{agent.interaction_kind ?? '—'}</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">{t('detail_diagnostics')}</h3>
        <AgentDiagnosticsPanel diagnostics={diagnostics} loading={diagnosticsLoading} />
      </div>
    </div>
  );
}
