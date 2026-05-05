import * as React from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ChatSession, Endpoint } from '@/lib/api/types';
import { getChatContentWidthClass, type ChatLayoutMode } from '@/lib/chat/layout';
import {
  CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT,
  CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT,
  type ChatStreamEscalationConfirmationRequestDetail,
  type SessionStreamStatus,
} from '@/lib/chat/stream-state';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  getStreamStatusText,
} from '@/components/chat/chat-header/utils';

function renderModelLabel({
  session,
  currentEndpoint,
  selectModelLabel,
}: {
  session: ChatSession | null;
  currentEndpoint: Endpoint | null | undefined;
  selectModelLabel: string;
}) {
  if (!session) {
    return selectModelLabel;
  }
  return currentEndpoint?.name || session.endpoint_id || selectModelLabel;
}

function isStopEscalationUnavailable(session: ChatSession | null) {
  return (
    session?.execution_status === 'stopping'
    && session.can_escalate === false
    && session.escalation_reason === 'STOP_ESCALATION_UNAVAILABLE'
  );
}

function isModelSelectorLocked(streamStatus: SessionStreamStatus) {
  return (
    streamStatus === 'connecting'
    || streamStatus === 'recovering'
    || streamStatus === 'streaming'
    || streamStatus === 'stopping'
    || streamStatus === 'terminating'
  );
}

export function ChatHeader({
  session,
  endpoints,
  streamStatus,
  onRename,
  onSelectEndpoint,
  onCreateThread,
  canCreateThread = true,
  createPending = false,
  layoutMode = 'standard',
}: {
  session: ChatSession | null;
  endpoints: Endpoint[];
  streamStatus: SessionStreamStatus;
  onRename: (title: string) => void;
  onSelectEndpoint: (endpoint: Endpoint) => void;
  onCreateThread?: () => void;
  canCreateThread?: boolean;
  createPending?: boolean;
  layoutMode?: ChatLayoutMode;
}) {
  const t = useTranslations('chat');
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(session?.title || '');
  const [modelSelectorOpen, setModelSelectorOpen] = React.useState(false);
  const [escalationRequest, setEscalationRequest] =
    React.useState<ChatStreamEscalationConfirmationRequestDetail | null>(null);
  const contentWidthClass = getChatContentWidthClass(layoutMode);

  React.useEffect(() => {
    setDraftTitle(session?.title || '');
    setEditing(false);
  }, [session?.id, session?.title]);

  const currentEndpoint = React.useMemo(() => {
    return findCurrentEndpoint(session, endpoints) ?? undefined;
  }, [endpoints, session]);
  const stopEscalationUnavailable = React.useMemo(() => isStopEscalationUnavailable(session), [session]);
  const modelSelectorLocked = React.useMemo(
    () => isModelSelectorLocked(streamStatus),
    [streamStatus],
  );

  const respondToEscalationRequest = React.useCallback((confirmed: boolean) => {
    if (!escalationRequest) return;
    window.dispatchEvent(
      new CustomEvent(CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT, {
        detail: {
          requestId: escalationRequest.requestId,
          confirmed,
        },
      }),
    );
    setEscalationRequest(null);
  }, [escalationRequest]);

  React.useEffect(() => {
    const handleEscalationRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChatStreamEscalationConfirmationRequestDetail>).detail;
      if (!detail || detail.sessionId !== session?.id) return;
      if (stopEscalationUnavailable) return;
      setEscalationRequest(detail);
    };
    window.addEventListener(
      CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT,
      handleEscalationRequest,
    );
    return () => {
      window.removeEventListener(
        CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT,
        handleEscalationRequest,
      );
    };
  }, [session?.id, stopEscalationUnavailable]);

  React.useEffect(() => {
    if (!stopEscalationUnavailable) return;
    setEscalationRequest(null);
  }, [stopEscalationUnavailable]);

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
    <div data-testid="chat__header" className="border-b border-subtle/60 bg-background/40 px-3 py-1.5 md:px-4">
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
              <span className="truncate">
                {currentEndpoint?.name || session.endpoint_id}
                <span className="text-tertiary/70"> · </span>
                {currentEndpoint?.model || session.model}
              </span>
            ) : (
              <span className="truncate">{t('header.no_active_thread_hint')}</span>
            )}
          </div>
          {stopEscalationUnavailable ? (
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-subtle bg-surface/80 px-2.5 py-2 text-[11px] text-secondary"
              data-testid="chat__stop-escalation-unavailable"
            >
              <span className="font-medium text-foreground">{t('stream_stop_escalation_unavailable')}</span>
              <span className="text-tertiary">{t('header.stop_escalation_unavailable_hint')}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 pt-0.5">
          {session ? (
            <DropdownMenu open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={modelSelectorLocked}
                  data-testid="chat__model-trigger"
                >
                  <span className="max-w-[220px] truncate">
                    {renderModelLabel({
                      session,
                      currentEndpoint,
                      selectModelLabel: t('header.select_model'),
                    })}
                  </span>
                  <ChevronDown className="h-4 w-4 text-icon-default" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[18rem]">
                <div className="px-3 py-2 text-xs text-tertiary">{t('header.model')}</div>
                <DropdownMenuSeparator />
                <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
                  {t('header.endpoints')}
                </div>
                {endpoints.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-tertiary">{t('header.no_models')}</div>
                ) : (
                  endpoints.map((endpoint) => {
                    const disabled = endpoint.status === 'disabled';
                    const active = session.endpoint_id === endpoint.id;
                    return (
                      <DropdownMenuItem
                        key={endpoint.id}
                        data-testid={`chat__model-endpoint--${endpoint.id}`}
                        data-disabled={disabled ? '' : undefined}
                        onSelect={(event) => {
                          event.preventDefault();
                          setModelSelectorOpen(false);
                          if (disabled || modelSelectorLocked) return;
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
      <AlertDialog
        open={Boolean(escalationRequest)}
        onOpenChange={(open) => {
          if (!open) respondToEscalationRequest(false);
        }}
      >
        <AlertDialogContent data-testid="chat__stop-escalation-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('header.stop_escalation_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('header.stop_escalation_description')}
              {escalationRequest?.reason ? (
                <span className="mt-2 block">
                  {t('header.stop_escalation_reason', {
                    reason: escalationRequest.reason,
                  })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="chat__stop-escalation-cancel">
              {t('header.stop_escalation_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="chat__stop-escalation-confirm"
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                respondToEscalationRequest(true);
              }}
            >
              {t('header.stop_escalation_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
