'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Virtuoso } from 'react-virtuoso';
import { Plus, Search } from 'lucide-react';

import type { ChatSession } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThreadItem } from './ThreadItem';

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
    const q = searchQuery.trim().toLowerCase();
    const base = sessions;
    const sorted = [...base].sort((a, b) => {
      if ((a.starred ? 1 : 0) !== (b.starred ? 1 : 0)) return (b.starred ? 1 : 0) - (a.starred ? 1 : 0);
      if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    if (!q) return sorted;
    return sorted.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  return (
    <aside
      className={cn(
        'border-r border-subtle bg-panel/70 backdrop-blur-sm flex flex-col overflow-hidden',
        layoutMode === 'ultrawide' ? 'w-[256px] xl:w-[276px] 2xl:w-[296px]' : 'w-[216px] xl:w-[228px] 2xl:w-[240px]',
      )}
      data-testid="chat__threads-pane"
    >
      <div className="p-2.5 border-b border-subtle space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-tertiary">{t('threads_title')}</div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5"
            onClick={onCreate}
            disabled={!canCreate || createPending}
            data-testid="chat__new-thread-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('new_thread')}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-icon-default" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t('search_threads_placeholder')}
            className="h-8 pl-9"
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
              <div className="px-2 py-0.5">
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
