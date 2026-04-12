'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { TaskSSEDebugEvent } from '@/lib/hooks/use-task-sse';

export interface NotebookSseDebugPanelProps {
  events: TaskSSEDebugEvent[];
}

export function NotebookSseDebugPanel({ events }: NotebookSseDebugPanelProps) {
  const t = useTranslations('notebook.conversation');
  if (events.length === 0) return null;

  return (
    <div
      className="border-b border-subtle bg-white/[0.015] px-3.5 py-1.5 text-[11px] text-tertiary"
      data-testid="notebook__sse-debug-panel"
    >
      <div className="mb-1 font-medium text-primary">{t('sse_debug_title')}</div>
      <div className="space-y-0.5">
        {events.map((evt, index) => (
          <div key={`${evt.at}-${evt.phase}-${index}`} className="font-mono truncate">
            [{new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] {evt.phase} {evt.summary}
          </div>
        ))}
      </div>
    </div>
  );
}
