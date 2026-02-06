'use client';

import * as React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Search } from 'lucide-react';

import type { ChatSession } from '@/lib/api/types';

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
  isLoading,
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
  isLoading: boolean;
}) {
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
      className="w-[248px] xl:w-[264px] 2xl:w-[280px] border-r border-subtle bg-panel/70 backdrop-blur-sm flex flex-col overflow-hidden"
      data-testid="chat__threads-pane"
    >
      <div className="p-3 border-b border-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-icon-default" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search threads..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="text-sm text-tertiary text-center py-6">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-tertiary text-center py-6">No threads</div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={filtered}
            itemContent={(_index, s) => (
              <div className="px-2 py-0.5">
                <ThreadItem
                  session={s}
                  isActive={s.id === activeSessionId}
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
