'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import type { AgentTaskModelSettingResponse } from '@/lib/api/types';

interface AgentTaskModelSummaryProps {
  settingResponse?: AgentTaskModelSettingResponse;
  isLoading: boolean;
  showSetupNextStep: boolean;
  t: (key: string) => string;
}

function isReady(state: string | undefined) {
  return state === 'ready';
}

export function AgentTaskModelSummary({
  settingResponse,
  isLoading,
  showSetupNextStep,
  t,
}: AgentTaskModelSummaryProps) {
  const readiness = settingResponse?.readiness;
  const setting = settingResponse?.setting;
  const ready = isReady(readiness?.state);
  const Icon = ready ? CheckCircle2 : AlertTriangle;

  return (
    <section
      className="rounded-md border border-subtle bg-surface px-4 py-4"
      data-testid="endpoints__agent-task-model-summary"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-tertiary">
            {t('agent_task_model.title')}
          </div>
          {isLoading ? (
            <p className="text-sm text-tertiary">{t('agent_task_model.loading')}</p>
          ) : (
            <>
              <p className="text-sm text-secondary">
                {readiness?.display_summary ?? t('agent_task_model.unavailable')}
              </p>
              {setting ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tertiary">
                  <span className="text-foreground">{setting.endpoint_display_name}</span>
                  {setting.default_model ? (
                    <span>{t('agent_task_model.default_model_label')}: {setting.default_model}</span>
                  ) : null}
                  {setting.updated_at ? (
                    <span>{t('agent_task_model.updated_label')}: {new Date(setting.updated_at).toLocaleString()}</span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          {showSetupNextStep ? (
            <div className="rounded-md border border-subtle bg-surface-low px-3 py-2 text-sm text-secondary">
              <div className="font-medium text-foreground">{t('agent_task_model.setup_next_step_title')}</div>
              <div className="mt-1 text-xs text-tertiary">{t('agent_task_model.setup_next_step_description')}</div>
            </div>
          ) : null}
        </div>
        <StatusBadge status={ready ? 'ready' : 'warning'} className="shrink-0">
          <Icon className="h-3.5 w-3.5" />
          {ready ? t('agent_task_model.ready') : t('agent_task_model.needs_setup')}
        </StatusBadge>
      </div>
    </section>
  );
}
