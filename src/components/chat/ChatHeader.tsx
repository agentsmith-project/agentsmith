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
import { EditableSessionTitle } from '@/components/chat/chat-header/EditableSessionTitle';
import {
  findCurrentEndpoint,
  findCurrentExternalAgent,
  getStreamStatusText,
} from '@/components/chat/chat-header/utils';

function renderExecutionTargetLabel({
  session,
  currentEndpoint,
  currentAgent,
  selectExecutionTargetLabel,
  externalAgentLabel,
}: {
  session: ChatSession | null;
  currentEndpoint: Endpoint | null | undefined;
  currentAgent: Agent | null | undefined;
  selectExecutionTargetLabel: string;
  externalAgentLabel: string;
}) {
  if (!session) {
    return selectExecutionTargetLabel;
  }
  if (session.external_agent_id) {
    return currentAgent?.name ?? externalAgentLabel;
  }
  return currentEndpoint?.name || session.endpoint_id || selectExecutionTargetLabel;
}

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
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(session?.title || '');
  const [executionTargetOpen, setExecutionTargetOpen] = React.useState(false);
  const contentWidthClass = getChatContentWidthClass(layoutMode);

  React.useEffect(() => {
    setDraftTitle(session?.title || '');
    setEditing(false);
  }, [session?.id, session?.title]);

  const currentEndpoint = React.useMemo(() => {
    return findCurrentEndpoint(session, endpoints) ?? undefined;
  }, [endpoints, session]);
  const currentAgent = React.useMemo(() => {
    return findCurrentExternalAgent(session, externalAgents ?? []) ?? undefined;
  }, [externalAgents, session]);
  const usingExternalAgent = !!session?.external_agent_id;

  const statusText = React.useMemo(() => {
    return getStreamStatusText(streamStatus, t);
  }, [streamStatus, t]);

  const commitRename = () => {
    const title = draftTitle.trim();
    setEditing(false);
    if (!title) {
      setDraftTitle(session?.title || '');
      return;
    }
    if (!session) return;
    if (title === session.title) return;
    onRename(title);
  };

  return (
    <div className="border-b border-white/6 bg-transparent px-3 py-1.5 md:px-4">
      <div className={cn('mx-auto flex w-full items-start justify-between gap-2', contentWidthClass)}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <EditableSessionTitle
            draftTitle={draftTitle}
            editing={editing}
            layoutMode={layoutMode}
            placeholderTitle={t('header.default_title')}
            renameTitle={t('header.rename_thread')}
            sessionTitle={session?.title || ''}
            statusText={statusText}
            onCancel={() => {
              setEditing(false);
              setDraftTitle(session?.title || '');
            }}
            onChange={setDraftTitle}
            onCommit={commitRename}
            onStartEditing={() => setEditing(true)}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-tertiary">
            {session ? (
              usingExternalAgent ? (
                <span className="truncate">
                  {currentAgent?.name ?? t('header.external_agent')}
                  <span className="text-tertiary/70"> · </span>
                  {session.external_agent_id}
                </span>
              ) : (
                <span className="truncate">
                  {currentEndpoint?.name || session.endpoint_id}
                  <span className="text-tertiary/70"> · </span>
                  {currentEndpoint?.model || session.model}
                </span>
              )
            ) : (
              <span className="truncate">{t('header.no_active_thread_hint')}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 pt-0.5">
          {session ? (
            <DropdownMenu open={executionTargetOpen} onOpenChange={setExecutionTargetOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="chat__execution-target-trigger">
                  <span className="max-w-[220px] truncate">
                    {renderExecutionTargetLabel({
                      session,
                      currentEndpoint,
                      currentAgent,
                      selectExecutionTargetLabel: t('header.select_execution_target'),
                      externalAgentLabel: t('header.external_agent'),
                    })}
                  </span>
                  <ChevronDown className="h-4 w-4 text-icon-default" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[18rem]">
                <div className="px-3 py-2 text-xs text-tertiary">{t('header.execution_target')}</div>
                <DropdownMenuSeparator />
                <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
                  {t('header.endpoints')}
                </div>
                {endpoints.length === 0 && (externalAgents ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-sm text-tertiary">{t('header.no_execution_targets')}</div>
                ) : (
                  endpoints.map((endpoint) => {
                    const disabled = endpoint.status === 'disabled';
                    const active = session.endpoint_id === endpoint.id;
                    return (
                      <DropdownMenuItem
                        key={endpoint.id}
                        data-testid={`chat__execution-target-endpoint--${endpoint.id}`}
                        data-disabled={disabled ? '' : undefined}
                        onSelect={(event) => {
                          event.preventDefault();
                          setExecutionTargetOpen(false);
                          if (disabled) return;
                          onSelectEndpoint(endpoint);
                        }}
                        className={cn(active && 'bg-hover')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className={cn('truncate text-sm', disabled ? 'text-tertiary' : 'text-primary')}>
                            {endpoint.name}
                          </div>
                          <div className="truncate text-xs text-tertiary">{endpoint.model}</div>
                        </div>
                        {disabled ? <span className="text-xs text-tertiary">{t('header.disabled')}</span> : null}
                      </DropdownMenuItem>
                    );
                  })
                )}
                {(externalAgents ?? []).length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
                      {t('header.agents')}
                    </div>
                    {(externalAgents ?? []).map((agent) => (
                      <DropdownMenuItem
                        key={agent.id}
                        data-testid={`chat__execution-target-agent--${agent.id}`}
                        onSelect={(event) => {
                          event.preventDefault();
                          setExecutionTargetOpen(false);
                          onSelectExternalAgent?.(agent);
                        }}
                        className={cn(session.external_agent_id === agent.id && 'bg-hover')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{agent.name}</div>
                          <div className="truncate text-xs text-tertiary">{t('header.agent_execution_target_hint')}</div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!canCreateThread || createPending}
              onClick={() => onCreateThread?.()}
              data-testid="chat__header-create-thread"
            >
              <Plus className="h-4 w-4" />
              {t('new_thread')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
