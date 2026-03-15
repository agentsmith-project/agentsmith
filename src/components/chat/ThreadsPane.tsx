'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Virtuoso } from 'react-virtuoso';

import type { ChatSession } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { ThreadItem } from './ThreadItem';
import { ThreadsPaneHeader } from './threads-pane/ThreadsPaneHeader';
import { ThreadsPaneStatus } from './threads-pane/ThreadsPaneStatus';
import { countGeneratingSessions, filterSessions } from './threads-pane/utils';

export function ThreadsPane({
  sessions,
  activeSessionId,
  searchQuery,
  onSearchQueryChange,
  onSelect,
  onRename,
  onToggleStar,
  onTogglePin,
  onDelete,
  onCreate,
  streamingSessionIds,
  canCreate,
  createPending,
  isLoading,
  layoutMode = 'standard',
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onToggleStar: (sessionId: string, next: boolean) => void;
  onTogglePin: (sessionId: string, next: boolean) => void;
  onDelete: (sessionId: string) => void;
  onCreate: () => void;
  streamingSessionIds: string[];
  canCreate: boolean;
  createPending: boolean;
  isLoading: boolean;
  layoutMode?: 'standard' | 'ultrawide';
}) {
  const t = useTranslations('chat');

  const filtered = React.useMemo(() => {
    return filterSessions(sessions, searchQuery);
  }, [sessions, searchQuery]);
  const generatingCount = React.useMemo(
    () => countGeneratingSessions(streamingSessionIds),
    [streamingSessionIds],
  );

  return (
    <aside
      className={cn(
        'border-r border-white/6 bg-panel/45 backdrop-blur-sm flex flex-col overflow-hidden',
        layoutMode === 'ultrawide' ? 'w-[256px] xl:w-[276px] 2xl:w-[296px]' : 'w-[216px] xl:w-[228px] 2xl:w-[240px]',
      )}
      data-testid="chat__threads-pane"
    >
      <div className="border-b border-white/6 space-y-1.5">
        <ThreadsPaneHeader
          canCreate={canCreate}
          createPending={createPending}
          searchQuery={searchQuery}
          t={t}
          onCreate={onCreate}
          onSearchQueryChange={onSearchQueryChange}
        />
        <div className="px-2.5 pb-2">
          <ThreadsPaneStatus
            activeSessionId={activeSessionId}
            generatingCount={generatingCount}
            sessionsCount={sessions.length}
            t={t}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="text-sm text-tertiary text-center py-6">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-tertiary text-center py-6">{t('no_threads')}</div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={filtered}
            itemContent={(_index, s) => (
              <div className="px-2 py-px">
                <ThreadItem
                  session={s}
                  isActive={s.id === activeSessionId}
                  isStreaming={streamingSessionIds.includes(s.id)}
                  onSelect={() => onSelect(s.id)}
                  onRename={(title) => onRename(s.id, title)}
                  onToggleStar={(next) => onToggleStar(s.id, next)}
                  onTogglePin={(next) => onTogglePin(s.id, next)}
                  onDelete={() => onDelete(s.id)}
                />
              </div>
            )}
          />
        )}
      </div>
    </aside>
  );
}
