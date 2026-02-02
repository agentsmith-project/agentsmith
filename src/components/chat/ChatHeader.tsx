'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import type { ChatSession, Endpoint } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ChatHeader({
  session,
  endpoints,
  streamStatus,
  onRename,
  onSelectEndpoint,
}: {
  session: ChatSession | null;
  endpoints: Endpoint[];
  streamStatus: 'idle' | 'connecting' | 'streaming' | 'stopped' | 'error';
  onRename: (title: string) => void;
  onSelectEndpoint: (endpoint: Endpoint) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(session?.title || '');
  const [modelOpen, setModelOpen] = React.useState(false);

  React.useEffect(() => {
    setDraftTitle(session?.title || '');
    setEditing(false);
  }, [session?.id, session?.title]);

  const currentEndpoint = React.useMemo(() => {
    if (!session) return null;
    return endpoints.find((e) => e.id === session.endpoint_id) || null;
  }, [endpoints, session]);

  const statusText = React.useMemo(() => {
    if (streamStatus === 'connecting' || streamStatus === 'streaming') return 'Generating…';
    if (streamStatus === 'stopped') return 'Stopped';
    if (streamStatus === 'error') return 'Error';
    return '';
  }, [streamStatus]);

  const commitRename = () => {
    const title = draftTitle.trim();
    setEditing(false);
    if (!title) return;
    if (!session) return;
    if (title === session.title) return;
    onRename(title);
  };

  return (
    <div className="h-14 px-4 flex items-center justify-between border-b border-subtle bg-background">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
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
                  setDraftTitle(session?.title || '');
                }
              }}
              onBlur={commitRename}
              autoFocus
              className={cn(
                'w-full max-w-[520px] bg-transparent text-sm text-foreground',
                'border border-subtle rounded-sm px-2 py-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              )}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                'text-sm font-medium text-foreground truncate',
                'hover:text-foreground/90 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm px-1 -mx-1',
              )}
              title="Rename thread"
            >
              {session?.title || 'Chat'}
            </button>
          )}

          {statusText && (
            <span className="text-xs text-tertiary">{statusText}</span>
          )}
        </div>
        {session && (
          <div className="text-xs text-tertiary truncate">
            {currentEndpoint?.openai_model || session.model}
            <span className="text-tertiary/70"> · </span>
            {currentEndpoint?.name || session.endpoint_id}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <span className="max-w-[220px] truncate">
                {currentEndpoint?.openai_model || session?.model || 'Select model'}
              </span>
              <ChevronDown className="w-4 h-4 text-icon-default" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[18rem]">
            <div className="px-3 py-2 text-xs text-tertiary">Models</div>
            <DropdownMenuSeparator />
            {endpoints.length === 0 ? (
              <div className="px-3 py-2 text-sm text-tertiary">No endpoints</div>
            ) : (
              endpoints.map((e) => {
                const disabled = e.status === 'disabled';
                const active = session?.endpoint_id === e.id;
                return (
                  <DropdownMenuItem
                    key={e.id}
                    data-disabled={disabled ? '' : undefined}
                    onSelect={(ev) => {
                      ev.preventDefault();
                      setModelOpen(false);
                      if (disabled) return;
                      onSelectEndpoint(e);
                    }}
                    className={cn(active && 'bg-hover')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm truncate', disabled ? 'text-tertiary' : 'text-primary')}>
                        {e.openai_model}
                      </div>
                      <div className="text-xs text-tertiary truncate">{e.name}</div>
                    </div>
                    {disabled && <span className="text-xs text-tertiary">Disabled</span>}
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
