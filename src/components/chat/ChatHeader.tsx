'use client';

import * as React from 'react';
import { ChevronDown, PanelRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  layoutMode = 'standard',
  showLayoutToggle = false,
  onToggleLayoutMode,
}: {
  session: ChatSession | null;
  endpoints: Endpoint[];
  streamStatus: 'idle' | 'connecting' | 'streaming' | 'stopped' | 'error';
  onRename: (title: string) => void;
  onSelectEndpoint: (endpoint: Endpoint) => void;
  layoutMode?: 'standard' | 'ultrawide';
  showLayoutToggle?: boolean;
  onToggleLayoutMode?: () => void;
}) {
  const t = useTranslations('chat');
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
    if (streamStatus === 'connecting' || streamStatus === 'streaming') return t('header.status_generating');
    if (streamStatus === 'stopped') return t('header.status_stopped');
    if (streamStatus === 'error') return t('header.status_error');
    return '';
  }, [streamStatus, t]);

  const commitRename = () => {
    const title = draftTitle.trim();
    setEditing(false);
    if (!title) {
      // Restore the original title so the next edit starts correctly
      setDraftTitle(session?.title || '');
      return;
    }
    if (!session) return;
    if (title === session.title) return;
    onRename(title);
  };

  return (
    <div className="h-14 border-b border-subtle bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-full w-full items-center justify-between gap-3 px-3 md:px-4">
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
                title={t('header.rename_thread')}
              >
                {session?.title || t('header.default_title')}
              </button>
            )}

            {statusText && (
              <span className="text-xs text-tertiary" data-testid="chat__stream-status">{statusText}</span>
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
          {showLayoutToggle ? (
            <Button
              variant={layoutMode === 'ultrawide' ? 'primary' : 'outline'}
              size="sm"
              className="h-8 w-8 px-0"
              data-testid="chat__layout-toggle"
              data-state={layoutMode}
              onClick={onToggleLayoutMode}
              aria-label={layoutMode === 'ultrawide' ? t('header.switch_to_standard') : t('header.switch_to_ultrawide')}
              title={layoutMode === 'ultrawide' ? t('header.switch_to_standard') : t('header.switch_to_ultrawide')}
            >
              <PanelRight className="w-4 h-4" />
            </Button>
          ) : null}
          <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" data-testid="chat__model-trigger">
                <span className="max-w-[220px] truncate">
                  {currentEndpoint?.openai_model || session?.model || t('header.select_model')}
                </span>
                <ChevronDown className="w-4 h-4 text-icon-default" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[18rem]">
              <div className="px-3 py-2 text-xs text-tertiary">{t('header.models')}</div>
              <DropdownMenuSeparator />
              {endpoints.length === 0 ? (
                <div className="px-3 py-2 text-sm text-tertiary">{t('header.no_endpoints')}</div>
              ) : (
                endpoints.map((e) => {
                  const disabled = e.status === 'disabled';
                  const active = session?.endpoint_id === e.id;
                  return (
                    <DropdownMenuItem
                      key={e.id}
                      data-testid={`chat__model-item--${e.id}`}
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
                      {disabled && <span className="text-xs text-tertiary">{t('header.disabled')}</span>}
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
