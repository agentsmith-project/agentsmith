'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskMessage, TaskRunState, TaskTraceEvent } from '@/lib/types/task';
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
    state?: TaskRunState;
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
  activeAgentMessageId?: string | null;
  sending?: boolean;
  diagnosticsLinks?: {
    audit: string;
    usage: string;
    agent?: string | null;
  };
  sandboxStarting?: boolean;
  inputPlaceholder?: string;
  blockedState?: {
    title: string;
    description: string;
    actionLabel?: string;
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
  runActivity,
  onRunActionClick,
  onCancelActiveRun,
  focusTraceMessageId,
  focusTraceName,
  focusTraceToken,
  disabled = false,
  activeAgentMessageId = null,
  sending = false,
  diagnosticsLinks,
  sandboxStarting = false,
  inputPlaceholder,
  blockedState = null,
}: ConversationPanelProps) {
  const t = useTranslations('notebook.conversation');
  const tCommon = useTranslations('common');
  const [inputValue, setInputValue] = React.useState('');
  const runState = runActivity?.state ?? (runActivity?.active ? 'running' : 'idle');
  const runInputDisabled =
    disabled ||
    runState === 'cancelling' ||
    runState === 'terminating' ||
    runState === 'finalizing';
  const showPendingHint =
    runState === 'running' || (runState === 'idle' && agentRunning);
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
  const runSummaryText = runActivity?.active && runState === 'running'
    ? truncateRunActivitySummary(
        latestRunAction?.summary ?? runActivity.lastSummary ?? t('run_active_default_action'),
        RUN_ACTIVITY_SUMMARY_MAX_CHARS,
      )
    : null;
  const runSummaryTitle = runActivity?.active && runState === 'running'
    ? latestRunAction?.summary ?? runActivity.lastSummary ?? t('run_active_default_action')
    : null;
  const runStatusTitle =
    runState === 'cancelling'
      ? t('run_cancelling_title')
      : runState === 'terminating'
        ? t('run_terminating_title')
        : runState === 'finalizing'
          ? t('run_finalizing_title')
          : null;
  const runStatusDescription =
    runState === 'cancelling'
      ? t('run_cancelling_description')
      : runState === 'terminating'
        ? t('run_terminating_description')
        : runState === 'finalizing'
          ? t('run_finalizing_description')
          : null;

  const showEmptyOrientation =
    messages.length === 0 &&
    !streamingMessageId &&
    !streamingContent &&
    !sandboxStarting &&
    !runActivity?.active;
  const showBlockedEmptyState = showEmptyOrientation && blockedState;
  const blockedStateCardClassName = blockedState?.tone === 'critical'
    ? 'border-error/30 bg-background'
    : 'border-subtle bg-background';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-background/96">
      {(connectionStatus && connectionStatus !== 'connected') || sandboxStarting || runActivity?.active ? (
        <div className="border-b border-subtle bg-surface-low/45 px-3.5 py-2">
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
                  <span className="rounded-full border border-subtle bg-surface-low px-2 py-0.5 text-[10px] font-medium text-secondary">
                    {runState === 'running'
                      ? t('run_active_title', { duration: formatElapsed(runActivity.elapsedSeconds) })
                      : runStatusTitle}
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
                  runState === 'running' && latestRunAction ? (
                    <button
                      type="button"
                      className="block w-full truncate text-left text-secondary/85 hover:text-secondary"
                      onClick={() => onRunActionClick?.(latestRunAction)}
                      title={runSummaryTitle ?? undefined}
                      data-testid="notebook__run-activity-summary"
                    >
                      {runSummaryText}
                    </button>
                  ) : runState === 'running' ? (
                    <div className="truncate text-secondary/85" title={runSummaryTitle ?? undefined} data-testid="notebook__run-activity-summary">
                      {runSummaryText}
                    </div>
                  ) : (
                    <div
                      className="text-secondary/85"
                      data-testid="notebook__run-activity-summary"
                    >
                      {runStatusDescription}
                    </div>
                  )
                ) : null}
              </div>
              {connectionStatus && connectionStatus !== 'connected' && diagnosticsLinks ? (
                <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                  <Link href={diagnosticsLinks.audit} data-testid="notebook__sse-status-open-audit" className="text-secondary hover:text-primary hover:underline">
                    {t('open_audit')}
                  </Link>
                  <Link href={diagnosticsLinks.usage} data-testid="notebook__sse-status-open-usage" className="text-secondary hover:text-primary hover:underline">
                    {t('open_usage')}
                  </Link>
                  {diagnosticsLinks.agent ? (
                    <Link href={diagnosticsLinks.agent} data-testid="notebook__sse-status-open-agent" className="text-secondary hover:text-primary hover:underline">
                      {t('open_agent_diagnostics')}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {runState === 'running' && runActivity?.active && onCancelActiveRun ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={onCancelActiveRun}
                  disabled={runInputDisabled || runActivity.cancelling}
                >
                  {runActivity.cancelling ? t('run_cancel_submitting') : tCommon('cancel')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 bg-background">
        {showBlockedEmptyState ? (
          <div className="flex h-full items-center justify-center px-4 py-8" data-testid="notebook__conversation-blocked-state">
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
                  >
                    {blockedState.actionLabel}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : showEmptyOrientation ? (
          <div className="flex h-full items-center justify-center px-4 py-8" data-testid="notebook__conversation-empty-state">
            <div className="w-full max-w-xl rounded-md border border-subtle bg-surface-low p-5 shadow-ambient">
              <div className="text-sm font-medium text-foreground">{t('empty')}</div>
              <div className="mt-2 text-sm text-secondary">{t('empty_description')}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {diagnosticsLinks ? (
                  <>
                    <Button asChild variant="outline" size="sm" className="h-8">
                      <Link href={diagnosticsLinks.audit} data-testid="notebook__conversation-empty-open-audit">
                        {t('open_audit')}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="h-8">
                      <Link href={diagnosticsLinks.usage} data-testid="notebook__conversation-empty-open-usage">
                        {t('open_usage')}
                      </Link>
                    </Button>
                    {diagnosticsLinks.agent ? (
                      <Button asChild variant="outline" size="sm" className="h-8">
                        <Link href={diagnosticsLinks.agent} data-testid="notebook__conversation-empty-open-agent">
                          {t('open_agent_diagnostics')}
                        </Link>
                      </Button>
                    ) : null}
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
            activeAgentMessageId={activeAgentMessageId}
            onTraceExpand={onTraceExpand}
            onTraceLoadMore={onTraceLoadMore}
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
