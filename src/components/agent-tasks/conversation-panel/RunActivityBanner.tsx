'use client';

import { formatElapsed } from './utils';

export function RunActivityBanner(args: {
  t: (key: string, values?: Record<string, string | number>) => string;
  runActivity: {
    active: boolean;
    elapsedSeconds: number;
    cancelling?: boolean;
    lastSummary?: string | null;
    lastKind?: 'command' | 'tool' | 'output' | 'artifact' | 'lifecycle' | 'error' | 'system';
    recentActions?: Array<{
      id: string;
      kind: 'command' | 'tool' | 'output' | 'artifact' | 'lifecycle' | 'error' | 'system';
      summary: string;
      ageSeconds: number;
      traceName?: string;
    }>;
  };
  disabled: boolean;
  onCancelActiveRun?: () => void;
  onRunActionClick?: (action: { traceName?: string; summary: string }) => void;
}) {
  const { t, runActivity, disabled, onCancelActiveRun, onRunActionClick } = args;

  if (!runActivity.active) return null;

  return (
    <div className="border-b border-blue-500/30 bg-blue-500/10 px-4 py-2" data-testid="agent-tasks__run-active">
      <div className="text-xs font-medium text-blue-300 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-300 animate-pulse" aria-hidden />
          {t('run_active_title', { duration: formatElapsed(runActivity.elapsedSeconds) })}
        </span>
        {onCancelActiveRun ? (
          <button
            type="button"
            className="rounded border border-blue-300/40 px-2 py-0.5 text-[11px] text-blue-100 hover:bg-blue-400/10 disabled:opacity-60"
            onClick={onCancelActiveRun}
            disabled={disabled || !!runActivity.cancelling}
            data-testid="agent-tasks__run-active-cancel"
          >
            {runActivity.cancelling ? t('run_cancel_submitting') : t('run_cancel')}
          </button>
        ) : null}
      </div>
      {runActivity.lastSummary ? (
        <div className="mt-1 flex items-start gap-2 text-xs text-blue-200/90">
          <span className="inline-flex shrink-0 items-center rounded border border-blue-300/30 bg-blue-400/10 px-1.5 py-0.5 text-[10px] tracking-wide text-blue-200">
            {runActivity.lastKind ? t(`run_action_kind_${runActivity.lastKind}`) : t('run_action_kind_system')}
          </span>
          <span className="truncate">{t('run_active_last_action', { summary: runActivity.lastSummary })}</span>
        </div>
      ) : null}
      {runActivity.recentActions && runActivity.recentActions.length > 0 ? (
        <div className="mt-2 space-y-1" data-testid="agent-tasks__run-active-recent">
          {runActivity.recentActions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full text-left flex items-start gap-2 text-[11px] text-blue-100/90 hover:text-blue-50"
              onClick={() => onRunActionClick?.({ traceName: item.traceName, summary: item.summary })}
              data-testid={`agent-tasks__run-active-action-${item.id}`}
            >
              <span className="inline-flex shrink-0 items-center rounded border border-blue-300/20 bg-blue-400/5 px-1.5 py-0.5 text-[10px] text-blue-200">
                {t(`run_action_kind_${item.kind}`)}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.summary}</span>
              <span className="shrink-0 text-blue-200/70">
                {t('run_action_time_ago', { duration: formatElapsed(item.ageSeconds) })}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
