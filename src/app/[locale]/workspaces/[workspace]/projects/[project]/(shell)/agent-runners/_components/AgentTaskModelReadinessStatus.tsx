'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import type { AgentTaskModelSettingResponse } from '@/lib/api/types';

interface AgentTaskModelReadinessStatusProps {
  settingResponse?: AgentTaskModelSettingResponse;
  isLoading: boolean;
  t: (key: string) => string;
}

export function AgentTaskModelReadinessStatus({
  settingResponse,
  isLoading,
  t,
}: AgentTaskModelReadinessStatusProps) {
  const readiness = settingResponse?.readiness;
  const ready = readiness?.state === 'ready';
  const Icon = ready ? CheckCircle2 : AlertTriangle;

  return (
    <section
      className="rounded-md border border-subtle bg-surface px-4 py-4"
      data-testid="agent-runners__project-model-setup-status"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-tertiary">
            {t('project_model_setup_title')}
          </div>
          <p className="text-sm text-secondary">
            {isLoading
              ? t('project_model_setup_loading')
              : readiness?.display_summary ?? t('project_model_setup_unavailable')}
          </p>
          {!ready && !isLoading ? (
            <p className="text-xs text-tertiary">{t('project_model_setup_blocked')}</p>
          ) : null}
        </div>
        <StatusBadge status={ready ? 'ready' : 'warning'} className="shrink-0">
          <Icon className="h-3.5 w-3.5" />
          {ready ? t('project_model_setup_ready') : t('default_status_warning')}
        </StatusBadge>
      </div>
    </section>
  );
}
