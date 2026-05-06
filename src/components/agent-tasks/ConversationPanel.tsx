'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskActivityItem, TaskTraceEvent } from '@/lib/types/task';
import type { AgentTaskTraceFailureKind } from '@/lib/build-failure-explainability';
import { getConnectionBannerCopy } from '@/components/agent-tasks/conversation-panel/utils';
import { Button } from '@/components/ui/button';
import type { ActiveRunView } from '@/components/agent-tasks/task-page/run-activity';

export interface ConversationPanelProps {
  messages: TaskActivityItem[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  connectionErrorCode?: string | null;
  connectionErrorMessage?: string | null;
  traceEventsByMessageId?: Record<string, TaskTraceEvent[]>;
  traceHasMoreByMessageId?: Record<string, boolean>;
  traceLoadingByMessageId?: Record<string, boolean>;
  traceLoadMoreLoadingByMessageId?: Record<string, boolean>;
  traceErrorByMessageId?: Record<string, { kind: AgentTaskTraceFailureKind; message: string }>;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
  onSendMessage: (content: string) => void;
  agentRunning?: boolean;
  pendingQueue?: Array<{ id: string; content: string }>;
  onPendingUpdate?: (id: string, content: string) => void;
  onPendingRemove?: (id: string) => void;
  activeRunView?: ActiveRunView | null;
  onRunActionClick?: (action: { traceName?: string; summary: string }) => void;
  focusTraceMessageId?: string | null;
  focusTraceName?: string | null;
  focusTraceToken?: number;
  disabled?: boolean;
  sending?: boolean;
  diagnosticsLinks?: {
    audit: string;
    usage: string;
  };
  diagnosticsLinksAffordance?: {
    auditUsage: boolean;
  };
  sandboxStarting?: boolean;
  inputPlaceholder?: string;
  blockedState?: {
    title: string;
    description: string;
    actionLabel?: string;
    actionTestId?: string;
    onAction?: () => void;
    tone?: 'default' | 'critical';
  } | null;
}

export function ConversationPanel({
  messages,
  streamingMessageId,
  streamingContent,
  connectionStatus,
  connectionErrorCode,
  connectionErrorMessage,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadingByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceErrorByMessageId,
  onTraceExpand,
  onTraceLoadMore,
  onSendMessage,
  agentRunning = false,
  pendingQueue = [],
  onPendingUpdate,
  onPendingRemove,
  activeRunView = null,
  onRunActionClick,
  focusTraceMessageId,
  focusTraceName,
  focusTraceToken,
  disabled = false,
  sending = false,
  diagnosticsLinks,
  diagnosticsLinksAffordance,
  sandboxStarting = false,
  inputPlaceholder,
  blockedState = null,
}: ConversationPanelProps) {
  const t = useTranslations('agent_tasks.conversation');
  const [inputValue, setInputValue] = React.useState('');
  const runState = activeRunView?.runState ?? 'idle';
  const runInputDisabled =
    disabled ||
    runState === 'cancelling' ||
    runState === 'terminating' ||
    runState === 'finalizing';
  const showPendingHint =
    runState === 'running' ||
    runState === 'reconnecting' ||
    (runState === 'idle' && agentRunning);
  const {
    connectionFailureKind,
    title: connectionTitle,
    description: connectionDescription,
  } = getConnectionBannerCopy({
    t,
    connectionStatus,
    connectionErrorCode,
    connectionErrorMessage,
  });
  const activeRunOwnsTransientConnectionStatus =
    activeRunView != null &&
    (connectionFailureKind === 'reconnecting' ||
      connectionFailureKind === 'disconnected');
  const showConnectionNotice =
    connectionStatus != null &&
    connectionStatus !== 'connected' &&
    !activeRunOwnsTransientConnectionStatus;
  const visibleDiagnosticsLinks =
    diagnosticsLinksAffordance?.auditUsage === true
      ? diagnosticsLinks
      : undefined;

  const handleSend = () => {
    if (inputValue.trim().length === 0) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const showEmptyOrientation =
    messages.length === 0 &&
    !streamingMessageId &&
    !streamingContent &&
    !sandboxStarting &&
    !activeRunView;
  const showBlockedEmptyState = showEmptyOrientation && blockedState;
  const blockedStateCardClassName = blockedState?.tone === 'critical'
    ? 'border-error/30 bg-background'
    : 'border-subtle bg-background';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-background/96">
      {showConnectionNotice || sandboxStarting ? (
        <div className="border-b border-subtle bg-surface-low/45 px-3.5 py-2">
          <div className="flex flex-wrap items-start justify-between gap-3" data-testid="agent-tasks__execution-visibility">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {showConnectionNotice ? (
                  <span className="rounded-full border border-error/18 bg-error/8 px-1.5 py-0.5 text-[10px] font-medium text-error">
                    {connectionTitle ?? ''}
                  </span>
                ) : null}
                {sandboxStarting ? (
                  <span className="rounded-full border border-accent/18 bg-accent/8 px-1.5 py-0.5 text-[10px] font-medium text-accent" data-testid="agent-tasks__sandbox-starting">
                    {t('sandbox_starting_title')}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] text-secondary" data-testid="agent-tasks__sse-status">
                {showConnectionNotice ? (
                  <>
                    <div>{connectionTitle}</div>
                    <div className="text-tertiary">{connectionDescription}</div>
                  </>
                ) : sandboxStarting ? (
                  <div className="text-tertiary">{t('sandbox_starting_description')}</div>
                ) : null}
              </div>
              {showConnectionNotice && visibleDiagnosticsLinks ? (
                <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                  <Link href={visibleDiagnosticsLinks.audit} data-testid="agent-tasks__sse-status-open-audit" className="text-secondary hover:text-primary hover:underline">
                    {t('open_audit')}
                  </Link>
                  <Link href={visibleDiagnosticsLinks.usage} data-testid="agent-tasks__sse-status-open-usage" className="text-secondary hover:text-primary hover:underline">
                    {t('open_usage')}
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 bg-background">
        {showBlockedEmptyState ? (
          <div className="flex h-full items-center justify-center px-4 py-8" data-testid="agent-tasks__conversation-blocked-state">
            <div className={`w-full max-w-xl rounded-md border p-5 shadow-ambient ${blockedStateCardClassName}`}>
              <div className="text-sm font-medium text-foreground">{blockedState.title}</div>
              <div className="mt-2 text-sm text-secondary">{blockedState.description}</div>
              {blockedState.actionLabel ? (
                <div className="mt-4">
                  <Button
                    type="button"
                    variant={blockedState.tone === 'critical' ? 'outline' : 'secondary'}
                    size="sm"
                    className="h-8"
                    onClick={() => blockedState.onAction?.()}
                    data-testid={blockedState.actionTestId}
                  >
                    {blockedState.actionLabel}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : showEmptyOrientation ? (
          <div className="flex h-full items-center justify-center px-4 py-8" data-testid="agent-tasks__conversation-empty-state">
            <div className="w-full max-w-xl rounded-md border border-subtle bg-surface-low p-5 shadow-ambient">
              <div className="text-sm font-medium text-foreground">{t('empty')}</div>
              <div className="mt-2 text-sm text-secondary">{t('empty_description')}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {visibleDiagnosticsLinks ? (
                  <>
                    <Button asChild variant="outline" size="sm" className="h-8">
                      <Link href={visibleDiagnosticsLinks.audit} data-testid="agent-tasks__conversation-empty-open-audit">
                        {t('open_audit')}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="h-8">
                      <Link href={visibleDiagnosticsLinks.usage} data-testid="agent-tasks__conversation-empty-open-usage">
                        {t('open_usage')}
                      </Link>
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            streamingMessageId={streamingMessageId}
            streamingContent={streamingContent}
            focusTraceMessageId={focusTraceMessageId}
            focusTraceName={focusTraceName}
            focusTraceToken={focusTraceToken}
            traceEventsByMessageId={traceEventsByMessageId}
            traceHasMoreByMessageId={traceHasMoreByMessageId}
            traceLoadingByMessageId={traceLoadingByMessageId}
            traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
            traceErrorByMessageId={traceErrorByMessageId}
            disabled={disabled}
            activeRunView={activeRunView}
            onTraceExpand={onTraceExpand}
            onTraceLoadMore={onTraceLoadMore}
            onRunActionClick={onRunActionClick}
          />
        )}
      </div>
      <div className="border-t border-subtle bg-background/88">
        <ConversationInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          agentRunning={showPendingHint}
          pendingQueue={pendingQueue}
          onPendingUpdate={onPendingUpdate}
          onPendingRemove={onPendingRemove}
          disabled={runInputDisabled}
          sending={sending}
          placeholder={inputPlaceholder}
        />
      </div>
    </div>
  );
}
