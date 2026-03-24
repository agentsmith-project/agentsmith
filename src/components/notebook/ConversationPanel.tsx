'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import { formatElapsed, getConnectionBannerCopy } from '@/components/notebook/conversation-panel/utils';
import { Button } from '@/components/ui/button';

const RUN_ACTIVITY_SUMMARY_MAX_CHARS = 96;

function truncateRunActivitySummary(summary: string, maxChars: number): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

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
  agentRunning?: boolean;
  pendingQueue?: Array<{ id: string; content: string }>;
  onPendingUpdate?: (id: string, content: string) => void;
  onPendingRemove?: (id: string) => void;
  runActivity?: {
    active: boolean;
    elapsedSeconds: number;
    cancelling?: boolean;
    lastSummary?: string | null;
    lastKind?: 'command' | 'tool' | 'output' | 'artifact' | 'lifecycle' | 'error' | 'system';
    recentActions?: Array<{
      id: string;
      kind: 'command' | 'tool' | 'output' | 'artifact' | 'lifecycle' | 'error' | 'system';
      summary: string;
      ageSeconds: number;
      traceName?: string;
    }>;
  };
  onRunActionClick?: (action: { traceName?: string; summary: string }) => void;
  onCancelActiveRun?: () => void;
  focusTraceMessageId?: string | null;
  focusTraceName?: string | null;
  focusTraceToken?: number;
  disabled?: boolean;
  sending?: boolean;
  diagnosticsLinks?: {
    audit: string;
    usage: string;
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
  agentRunning = false,
  pendingQueue = [],
  onPendingUpdate,
  onPendingRemove,
  runActivity,
  onRunActionClick,
  onCancelActiveRun,
  focusTraceMessageId,
  focusTraceName,
  focusTraceToken,
  disabled = false,
  sending = false,
  diagnosticsLinks,
  sandboxStarting = false,
}: ConversationPanelProps) {
  const t = useTranslations('notebook.conversation');
  const tCommon = useTranslations('common');
  const [inputValue, setInputValue] = React.useState('');
  const { title: connectionTitle, description: connectionDescription } = getConnectionBannerCopy({
    t,
    connectionStatus,
    connectionErrorCode,
    connectionErrorMessage,
  });

  const handleSend = () => {
    if (inputValue.trim().length === 0) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const latestRunAction = runActivity?.recentActions?.[0];
  const runSummaryText = runActivity?.active
    ? truncateRunActivitySummary(
        latestRunAction?.summary ?? runActivity.lastSummary ?? t('run_active_default_action'),
        RUN_ACTIVITY_SUMMARY_MAX_CHARS,
      )
    : null;
  const runSummaryTitle = runActivity?.active
    ? latestRunAction?.summary ?? runActivity.lastSummary ?? t('run_active_default_action')
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[16px] bg-background/55">
      {(connectionStatus && connectionStatus !== 'connected') || sandboxStarting || runActivity?.active ? (
        <div className="border-b border-white/6 bg-white/[0.015] px-3.5 py-1.5">
          <div className="flex flex-wrap items-start justify-between gap-3" data-testid="notebook__execution-visibility">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {connectionStatus && connectionStatus !== 'connected' ? (
                  <span className="rounded-full border border-error/18 bg-error/8 px-1.5 py-0.5 text-[10px] font-medium text-error">
                    {connectionTitle ?? ''}
                  </span>
                ) : null}
                {sandboxStarting ? (
                  <span className="rounded-full border border-accent/18 bg-accent/8 px-1.5 py-0.5 text-[10px] font-medium text-accent" data-testid="notebook__sandbox-starting">
                    {t('sandbox_starting_title')}
                  </span>
                ) : null}
                {runActivity?.active ? (
                  <span className="rounded-full border border-white/8 bg-white/[0.035] px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                    {t('run_active_title', { duration: formatElapsed(runActivity.elapsedSeconds) })}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] text-secondary" data-testid="notebook__sse-status">
                {connectionStatus && connectionStatus !== 'connected' ? (
                  <>
                    <div>{connectionTitle}</div>
                    <div className="text-tertiary">{connectionDescription}</div>
                  </>
                ) : sandboxStarting ? (
                  <div className="text-tertiary">{t('sandbox_starting_description')}</div>
                ) : runActivity?.active ? (
                  latestRunAction ? (
                    <button
                      type="button"
                      className="block w-full truncate text-left text-tertiary hover:text-secondary"
                      onClick={() => onRunActionClick?.(latestRunAction)}
                      title={runSummaryTitle ?? undefined}
                      data-testid="notebook__run-activity-summary"
                    >
                      {runSummaryText}
                    </button>
                  ) : (
                    <div className="truncate text-tertiary" title={runSummaryTitle ?? undefined} data-testid="notebook__run-activity-summary">
                      {runSummaryText}
                    </div>
                  )
                ) : null}
              </div>
              {connectionStatus && connectionStatus !== 'connected' && diagnosticsLinks ? (
                <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                  <Link href={diagnosticsLinks.audit} data-testid="notebook__sse-status-open-audit" className="text-primary hover:underline">
                    {t('open_audit')}
                  </Link>
                  <Link href={diagnosticsLinks.usage} data-testid="notebook__sse-status-open-usage" className="text-primary hover:underline">
                    {t('open_usage')}
                  </Link>
                  {diagnosticsLinks.agent ? (
                    <Link href={diagnosticsLinks.agent} data-testid="notebook__sse-status-open-agent" className="text-primary hover:underline">
                      {t('open_agent_diagnostics')}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {runActivity?.active && onCancelActiveRun ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={onCancelActiveRun}
                  disabled={disabled || runActivity.cancelling}
                >
                  {runActivity.cancelling ? t('run_cancel_requested') : tCommon('cancel')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.012),transparent_12%)]">
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
          onTraceExpand={onTraceExpand}
          onTraceLoadMore={onTraceLoadMore}
        />
      </div>
      <div className="border-t border-white/6 bg-transparent">
        <ConversationInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          agentRunning={agentRunning}
          pendingQueue={pendingQueue}
          onPendingUpdate={onPendingUpdate}
          onPendingRemove={onPendingRemove}
          disabled={disabled}
          sending={sending}
        />
      </div>
    </div>
  );
}
