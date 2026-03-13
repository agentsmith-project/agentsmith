'use client';

interface ThreadsPaneStatusProps {
  activeSessionId: string | null;
  generatingCount: number;
  sessionsCount: number;
  t: (key: string, values?: Record<string, number>) => string;
}

export function ThreadsPaneStatus({
  activeSessionId,
  generatingCount,
  sessionsCount,
  t,
}: ThreadsPaneStatusProps) {
  if (!(generatingCount > 0 || (!activeSessionId && sessionsCount > 0))) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-tertiary">
      <div className="min-w-0 truncate">
        {!activeSessionId && sessionsCount > 0 ? (
          <span data-testid="chat__threads-no-active-hint">{t('threads_no_active_hint')}</span>
        ) : ''}
      </div>
      {generatingCount > 0 ? (
        <div
          className="inline-flex shrink-0 items-center rounded-full border border-subtle bg-surface-high px-2 py-0.5 text-[10px] text-tertiary"
          data-testid="chat__threads-generating-count"
        >
          {t('threads_generating_count', { count: generatingCount })}
        </div>
      ) : null}
    </div>
  );
}
