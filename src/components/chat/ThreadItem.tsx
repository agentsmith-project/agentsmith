'use client';

import * as React from 'react';
import { LoaderCircle, MoreHorizontal, Pin, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ChatSession } from '@/lib/api/types';
import { getReferenceNow } from '@/lib/reference-now';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function formatCompactAge(ts?: string, referenceTimeMs = getReferenceNow().getTime()) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const deltaMs = referenceTimeMs - d.getTime();
  const deltaMin = Math.floor(deltaMs / 60000);
  if (deltaMin < 1) return 'now';
  if (deltaMin < 60) return `${deltaMin}m`;
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) return `${deltaHour}h`;
  const deltaDay = Math.floor(deltaHour / 24);
  if (deltaDay < 7) return `${deltaDay}d`;
  const deltaWeek = Math.floor(deltaDay / 7);
  if (deltaWeek < 5) return `${deltaWeek}w`;
  const deltaMonth = Math.floor(deltaDay / 30);
  if (deltaMonth < 12) return `${deltaMonth}mo`;
  return `${Math.floor(deltaDay / 365)}y`;
}

export function ThreadItem({
  session,
  isActive,
  isStreaming,
  onSelect,
  onRename,
  onToggleStar,
  onTogglePin,
  onDelete,
}: {
  session: ChatSession;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onToggleStar: (next: boolean) => void;
  onTogglePin: (next: boolean) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('chat');
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(session.title || '');
  const referenceTimeMs = getReferenceNow().getTime();

  React.useEffect(() => {
    setDraftTitle(session.title || '');
  }, [session.title]);

  const commitRename = () => {
    const title = draftTitle.trim();
    setEditing(false);
    if (!title) return;
    if (title === (session.title || '')) return;
    onRename(title);
  };

  return (
    <div
      className={cn(
        'rounded-sm transition-colors duration-200 group',
        isActive ? 'bg-hover' : 'hover:bg-hover',
      )}
      data-testid="chat__thread-item"
      data-thread-id={session.id}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className="w-full text-left min-h-9 px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditing(false);
                    setDraftTitle(session.title || '');
                  }
                }}
                onBlur={commitRename}
                autoFocus
                className={cn(
                  'w-full bg-transparent text-sm text-foreground',
                  'border border-subtle rounded-sm px-2 py-1',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                )}
              />
            ) : (
              <div
                className={cn('text-sm truncate', isActive ? 'text-foreground' : 'text-primary')}
                title={session.title || t('thread_item.untitled')}
              >
                {session.title || t('thread_item.untitled')}
              </div>
            )}
          </div>
          <div className="shrink-0 text-[11px] tabular-nums text-tertiary">
            <span title={session.updated_at}>{formatCompactAge(session.updated_at, referenceTimeMs)}</span>
            <span className="mx-1 text-tertiary/60">·</span>
            <span>{session.message_count ?? 0}</span>
          </div>
          <div className="flex items-center gap-1.5 text-icon-default">
            {isStreaming ? (
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-accent"
                data-testid="chat__thread-streaming-indicator"
                title={t('thread_generating')}
              >
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              </span>
            ) : null}
            {session.starred ? <Star className="w-3.5 h-3.5 text-accent" /> : null}
            {session.pinned ? <Pin className="w-3.5 h-3.5" /> : null}
          </div>

          <div className="flex-shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  data-testid="chat__thread-actions-btn"
                  className={cn(
                    'h-8 w-8 transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    'text-icon-default hover:text-foreground',
                  )}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t('thread_item.actions')}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem
                  data-testid="chat__thread-rename-action"
                  onSelect={(e) => {
                    e.preventDefault();
                    setEditing(true);
                  }}
                >
                  {t('thread_item.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onToggleStar(!session.starred);
                  }}
                >
                  <Star className="w-4 h-4" />
                  {session.starred ? t('thread_item.unstar') : t('thread_item.star')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onTogglePin(!session.pinned);
                  }}
                >
                  <Pin className="w-4 h-4" />
                  {session.pinned ? t('thread_item.unpin') : t('thread_item.pin')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="chat__thread-delete-action"
                  className="text-error"
                  onSelect={(e) => {
                    e.preventDefault();
                    onDelete();
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  {t('thread_item.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
