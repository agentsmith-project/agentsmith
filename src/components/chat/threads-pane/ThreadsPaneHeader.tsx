'use client';

import { Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ThreadsPaneHeaderProps {
  canCreate: boolean;
  createPending: boolean;
  searchQuery: string;
  t: (key: string, values?: Record<string, number>) => string;
  onCreate: () => void;
  onSearchQueryChange: (value: string) => void;
}

export function ThreadsPaneHeader({
  canCreate,
  createPending,
  searchQuery,
  t,
  onCreate,
  onSearchQueryChange,
}: ThreadsPaneHeaderProps) {
  return (
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
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={t('search_threads_placeholder')}
          className="h-8 pl-9"
        />
      </div>
    </div>
  );
}
