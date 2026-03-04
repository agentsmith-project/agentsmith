'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import { buttonVariants } from '@/components/ui/button';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import { classifyNotebookRealtimeFailure } from '@/lib/build-failure-explainability';

export interface ConversationPanelProps {
  messages: TaskMessage[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  connectionErrorCode?: string | null;
  connectionErrorMessage?: string | null;
  traceEventsByMessageId?: Record<string, TaskTraceEvent[]>;
  traceHasMoreByMessageId?: Record<string, boolean>;
  traceLoadingByMessageId?: Record<string, boolean>;
  traceLoadMoreLoadingByMessageId?: Record<string, boolean>;
  traceErrorByMessageId?: Record<string, { kind: NotebookTraceFailureKind; message: string }>;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  sending?: boolean;
  diagnosticsLinks?: {
    runtime: string;
    releaseOps: string;
    agent?: string | null;
  };
  sandboxStarting?: boolean;
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
  disabled = false,
  sending = false,
  diagnosticsLinks,
  sandboxStarting = false,
}: ConversationPanelProps) {
  const t = useTranslations('notebook.conversation');
  const [inputValue, setInputValue] = React.useState('');
  const connectionFailureKind = connectionStatus
    ? classifyNotebookRealtimeFailure(connectionStatus, connectionErrorCode)
    : null;

  const connectionTitle = connectionFailureKind === 'connecting'
    ? t('realtime_status_connecting_title')
    : connectionFailureKind === 'reconnecting'
      ? t('realtime_status_reconnecting_title')
      : connectionFailureKind === 'disconnected'
        ? t('realtime_status_disconnected_title')
        : connectionFailureKind === 'ticket_unavailable'
          ? t('realtime_status_ticket_unavailable_title')
        : connectionFailureKind === 'ticket_unauthorized'
          ? t('realtime_status_ticket_unauthorized_title')
        : connectionFailureKind === 'ticket_rate_limited'
          ? t('realtime_status_ticket_rate_limited_title')
        : connectionFailureKind === 'stream_unavailable'
          ? t('realtime_status_stream_unavailable_title')
        : connectionFailureKind === 'stream_interrupted'
          ? t('realtime_status_stream_interrupted_title')
        : connectionFailureKind === 'stream_recovery_exhausted'
          ? t('realtime_status_stream_recovery_exhausted_title')
        : connectionFailureKind === 'ticket_network'
          ? t('realtime_status_ticket_network_title')
                : connectionFailureKind === 'reconcile_failed'
                  ? t('realtime_status_reconcile_failed_title')
                  : connectionFailureKind === 'error'
                    ? t('realtime_status_error_title')
                    : null;

  const connectionDescription = connectionFailureKind === 'connecting'
    ? t('realtime_status_connecting_description')
    : connectionFailureKind === 'reconnecting'
      ? t('realtime_status_reconnecting_description')
      : connectionFailureKind === 'disconnected'
        ? t('realtime_status_disconnected_description')
        : connectionFailureKind === 'ticket_unavailable'
          ? t('realtime_status_ticket_unavailable_description')
        : connectionFailureKind === 'ticket_unauthorized'
          ? t('realtime_status_ticket_unauthorized_description')
        : connectionFailureKind === 'ticket_rate_limited'
          ? t('realtime_status_ticket_rate_limited_description')
        : connectionFailureKind === 'stream_unavailable'
          ? connectionErrorMessage || t('realtime_status_stream_unavailable_description')
        : connectionFailureKind === 'stream_interrupted'
          ? connectionErrorMessage || t('realtime_status_stream_interrupted_description')
        : connectionFailureKind === 'stream_recovery_exhausted'
          ? connectionErrorMessage || t('realtime_status_stream_recovery_exhausted_description')
        : connectionFailureKind === 'ticket_network'
          ? t('realtime_status_ticket_network_description')
                : connectionFailureKind === 'reconcile_failed'
                  ? connectionErrorMessage || t('realtime_status_reconcile_failed_description')
                  : connectionFailureKind === 'error'
                    ? connectionErrorMessage || t('realtime_status_error_description')
                    : null;

  const handleSend = () => {
    if (inputValue.trim().length === 0) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {connectionStatus && connectionStatus !== 'connected' && (
        <div className="border-b border-subtle px-4 py-2" data-testid="notebook__sse-status">
          <div className="text-xs font-medium text-primary">{connectionTitle}</div>
          <div className="mt-0.5 text-xs text-tertiary">{connectionDescription}</div>
          {diagnosticsLinks ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href={diagnosticsLinks.runtime}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="notebook__sse-status-open-runtime"
              >
                {t('open_runtime_observability')}
              </Link>
              <Link
                href={diagnosticsLinks.releaseOps}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="notebook__sse-status-open-release-ops"
              >
                {t('open_release_ops')}
              </Link>
              {diagnosticsLinks.agent ? (
                <Link
                  href={diagnosticsLinks.agent}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-testid="notebook__sse-status-open-agent"
                >
                  {t('open_agent_diagnostics')}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {sandboxStarting ? (
        <div className="border-b border-subtle px-4 py-2" data-testid="notebook__sandbox-starting">
          <div className="text-xs font-medium text-primary">{t('sandbox_starting_title')}</div>
          <div className="mt-0.5 text-xs text-tertiary">{t('sandbox_starting_description')}</div>
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <MessageList
          messages={messages}
          streamingMessageId={streamingMessageId}
          streamingContent={streamingContent}
          traceEventsByMessageId={traceEventsByMessageId}
          traceHasMoreByMessageId={traceHasMoreByMessageId}
          traceLoadingByMessageId={traceLoadingByMessageId}
          traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
          traceErrorByMessageId={traceErrorByMessageId}
          disabled={disabled}
          onTraceExpand={onTraceExpand}
          onTraceLoadMore={onTraceLoadMore}
        />
      </div>
      <ConversationInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        disabled={disabled}
        sending={sending}
      />
    </div>
  );
}
