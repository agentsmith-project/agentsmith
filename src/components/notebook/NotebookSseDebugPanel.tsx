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
      className="border-b border-subtle bg-surface px-4 py-2 text-xs text-tertiary"
      data-testid="notebook__sse-debug-panel"
    >
      <div className="font-medium text-primary mb-1">{t('sse_debug_title')}</div>
      <div className="space-y-1">
        {events.map((evt, index) => (
          <div key={`${evt.at}-${evt.phase}-${index}`} className="font-mono truncate">
            [{new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] {evt.phase} {evt.summary}
          </div>
        ))}
      </div>
    </div>
  );
}
