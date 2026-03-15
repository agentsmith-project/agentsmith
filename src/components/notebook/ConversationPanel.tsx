'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import { ConnectionBanner } from '@/components/notebook/conversation-panel/ConnectionBanner';
import { RunActivityBanner } from '@/components/notebook/conversation-panel/RunActivityBanner';
import { formatElapsed, getConnectionBannerCopy } from '@/components/notebook/conversation-panel/utils';

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
  showExecutionDetails?: boolean;
  onToggleExecutionDetails?: () => void;
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
  showExecutionDetails = false,
  onToggleExecutionDetails,
  disabled = false,
  sending = false,
  diagnosticsLinks,
  sandboxStarting = false,
}: ConversationPanelProps) {
  const t = useTranslations('notebook.conversation');
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

  return (
      <div className="flex h-full flex-col overflow-hidden rounded-[22px] border border-white/6 bg-background bg-background/70">
      {connectionStatus && connectionStatus !== 'connected' && (
        <ConnectionBanner
          title={connectionTitle ?? ''}
          description={connectionDescription ?? ''}
          diagnosticsLinks={diagnosticsLinks}
          openAuditLabel={t('open_audit')}
          openUsageLabel={t('open_usage')}
          openAgentDiagnosticsLabel={t('open_agent_diagnostics')}
        />
      )}
      {sandboxStarting ? (
        <div className="border-b border-subtle px-4 py-3" data-testid="notebook__sandbox-starting">
          <div className="text-xs font-medium text-primary">{t('sandbox_starting_title')}</div>
          <div className="mt-0.5 text-xs text-tertiary">{t('sandbox_starting_description')}</div>
        </div>
      ) : null}
      <div
        className="flex items-center justify-between border-b border-subtle bg-white/[0.02] px-4 py-3"
        data-testid="notebook__execution-visibility"
      >
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
            {t('execution_visibility_label')}
          </div>
          <div className="text-sm text-secondary">
            {connectionStatus === 'connected' ? t('execution_visibility_show') : (connectionTitle ?? '')}
          </div>
        </div>
        <button
          type="button"
          className="text-xs text-primary hover:underline disabled:text-tertiary disabled:no-underline"
          onClick={onToggleExecutionDetails}
          disabled={disabled}
          data-testid="notebook__execution-visibility-toggle"
        >
          {showExecutionDetails
            ? t('execution_visibility_hide')
            : t('execution_visibility_show')}
        </button>
      </div>
      {runActivity?.active ? (
        <RunActivityBanner
          t={t}
          runActivity={runActivity}
          disabled={disabled}
          onCancelActiveRun={onCancelActiveRun}
          onRunActionClick={onRunActionClick}
        />
      ) : null}
      <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),transparent_16%)]">
        <MessageList
          messages={messages}
          streamingMessageId={streamingMessageId}
          streamingContent={streamingContent}
          showExecutionDetails={showExecutionDetails}
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
      <div className="border-t border-subtle bg-white/[0.02]">
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
