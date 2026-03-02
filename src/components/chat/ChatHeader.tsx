import * as React from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Agent, ChatSession, Endpoint } from '@/lib/api/types';
import { getChatContentWidthClass, type ChatLayoutMode } from '@/lib/chat/layout';
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
  externalAgents,
  streamStatus,
  onRename,
  onSelectEndpoint,
  onSelectExternalAgent,
  onCreateThread,
  canCreateThread = true,
  createPending = false,
  layoutMode = 'standard',
}: {
  session: ChatSession | null;
  endpoints: Endpoint[];
  externalAgents?: Agent[];
  streamStatus: 'idle' | 'connecting' | 'recovering' | 'streaming' | 'stopped' | 'error';
  onRename: (title: string) => void;
  onSelectEndpoint: (endpoint: Endpoint) => void;
  onSelectExternalAgent?: (agent: Agent) => void;
  onCreateThread?: () => void;
  canCreateThread?: boolean;
  createPending?: boolean;
  layoutMode?: ChatLayoutMode;
}) {
  const t = useTranslations('chat');
  // `layoutMode` is used for content width alignment only.
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(session?.title || '');
  const [modelOpen, setModelOpen] = React.useState(false);
  const contentWidthClass = getChatContentWidthClass(layoutMode);

  React.useEffect(() => {
    setDraftTitle(session?.title || '');
    setEditing(false);
  }, [session?.id, session?.title]);

  const currentEndpoint = React.useMemo(() => {
    if (!session) return null;
    return endpoints.find((e) => e.id === session.endpoint_id) || null;
  }, [endpoints, session]);
  const currentAgent = React.useMemo(() => {
    if (!session?.external_agent_id) return null;
    return (externalAgents ?? []).find((agent) => agent.id === session.external_agent_id) ?? null;
  }, [externalAgents, session?.external_agent_id]);
  const usingExternalAgent = !!session?.external_agent_id;

  const statusText = React.useMemo(() => {
    if (streamStatus === 'connecting' || streamStatus === 'streaming') return t('header.status_generating');
    if (streamStatus === 'recovering') return t('header.status_recovering');
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
      <div className={cn('mx-auto flex h-full w-full items-center justify-between gap-3 px-3 md:px-4', contentWidthClass)}>
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
                  'w-full bg-transparent text-sm text-foreground',
                  layoutMode === 'ultrawide' ? 'max-w-[980px]' : 'max-w-[640px]',
                  'border border-subtle rounded-sm px-2 py-1',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                )}
              />
            ) : (
              session ? (
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
                  {session.title || t('header.default_title')}
                </button>
              ) : (
                <div className="text-sm font-medium text-foreground truncate">{t('header.default_title')}</div>
              )
            )}

            {statusText && (
              <span className="text-xs text-tertiary" data-testid="chat__stream-status">{statusText}</span>
            )}
          </div>
          {session ? (
            <div className="text-xs text-tertiary truncate">
              {usingExternalAgent ? (
                `${currentAgent?.name ?? t('header.external_agent')} · ${session.external_agent_id}`
              ) : (
                <>
                  {currentEndpoint?.name || session.endpoint_id}
                  <span className="text-tertiary/70"> · </span>
                  {currentEndpoint?.openai_model || session.model}
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-tertiary truncate">{t('header.no_active_thread_hint')}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {session ? (
            usingExternalAgent ? (
              <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" data-testid="chat__model-trigger">
                    <span className="max-w-[220px] truncate">
                      {currentAgent?.name ?? t('header.external_agent')}
                    </span>
                    <ChevronDown className="w-4 h-4 text-icon-default" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[18rem]">
                  <div className="px-3 py-2 text-xs text-tertiary">{t('header.models')}</div>
                  <DropdownMenuSeparator />
                  {endpoints.map((e) => {
                    const disabled = e.status === 'disabled';
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
                      >
                        <div className="min-w-0 flex-1">
                          <div className={cn('text-sm truncate', disabled ? 'text-tertiary' : 'text-primary')}>
                            {e.name}
                          </div>
                          <div className="text-xs text-tertiary truncate">{e.openai_model}</div>
                        </div>
                        {disabled && <span className="text-xs text-tertiary">{t('header.disabled')}</span>}
                      </DropdownMenuItem>
                    );
                  })}
                  {(externalAgents ?? []).length > 0 && endpoints.length > 0 && <DropdownMenuSeparator />}
                  {(externalAgents ?? []).map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onSelect={(ev) => {
                        ev.preventDefault();
                        setModelOpen(false);
                        onSelectExternalAgent?.(agent);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{agent.name}</div>
                        <div className="text-xs text-tertiary truncate">{t('header.external_agent')}</div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
            <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="chat__model-trigger">
                  <span className="max-w-[220px] truncate">
                    {currentEndpoint?.name || session?.endpoint_id || t('header.select_model')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-icon-default" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[18rem]">
                <div className="px-3 py-2 text-xs text-tertiary">{t('header.models')}</div>
                <DropdownMenuSeparator />
                {endpoints.length === 0 && (externalAgents ?? []).length === 0 ? (
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
                            {e.name}
                          </div>
                          <div className="text-xs text-tertiary truncate">{e.openai_model}</div>
                        </div>
                        {disabled && <span className="text-xs text-tertiary">{t('header.disabled')}</span>}
                      </DropdownMenuItem>
                    );
                  })
                )}
                {(externalAgents ?? []).length > 0 && <DropdownMenuSeparator />}
                {(externalAgents ?? []).map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    onSelect={(ev) => {
                      ev.preventDefault();
                      setModelOpen(false);
                      onSelectExternalAgent?.(agent);
                    }}
                    className={cn(session?.external_agent_id === agent.id && 'bg-hover')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{agent.name}</div>
                      <div className="text-xs text-tertiary truncate">{t('header.external_agent')}</div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            )
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!canCreateThread || createPending}
              onClick={() => onCreateThread?.()}
              data-testid="chat__header-create-thread"
            >
              <Plus className="w-4 h-4" />
              {t('new_thread')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
