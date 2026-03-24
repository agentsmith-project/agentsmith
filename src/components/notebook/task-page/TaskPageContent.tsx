'use client';

import * as React from 'react';
import { ArtifactsPanel } from '@/components/notebook/ArtifactsPanel';
import { ConversationPanel } from '@/components/notebook/ConversationPanel';
import { NotebookSseDebugPanel } from '@/components/notebook/NotebookSseDebugPanel';
import type { Artifact, TaskMessage } from '@/lib/types/task';

interface TaskPageContentProps {
  agentIsBusy: boolean;
  artifacts: Artifact[];
  canUpdateTask: boolean;
  connectionErrorCode: React.ComponentProps<typeof ConversationPanel>['connectionErrorCode'];
  connectionErrorMessage: React.ComponentProps<typeof ConversationPanel>['connectionErrorMessage'];
  connectionStatus: React.ComponentProps<typeof ConversationPanel>['connectionStatus'];
  diagnosticsLinks: React.ComponentProps<typeof ConversationPanel>['diagnosticsLinks'];
  disabled: boolean;
  fetchTracesForMessage: NonNullable<React.ComponentProps<typeof ConversationPanel>['onTraceExpand']>;
  focusTraceMessageId: string | null;
  focusTraceName: string | null;
  focusTraceToken: number;
  handleCancelActiveRun: () => void;
  handleDownloadArtifact: (artifact: Artifact) => Promise<void>;
  handlePendingRemove: (id: string) => void;
  handlePendingUpdate: (id: string, content: string) => void;
  handleSendMessage: (content: string) => Promise<void>;
  handleViewArtifact: (artifact: Artifact) => void;
  isDisabled: boolean;
  loadMoreTracesForMessage: (messageId: string) => void;
  messages: TaskMessage[];
  pendingMessages: Array<{ id: string; content: string }>;
  runActivity: NonNullable<React.ComponentProps<typeof ConversationPanel>['runActivity']>;
  sandboxStarting: boolean;
  sending: boolean;
  showSseDebugPanel: boolean;
  sseDebugEvents: React.ComponentProps<typeof NotebookSseDebugPanel>['events'];
  streamingContent: string;
  streamingMessageId: string | null;
  traceErrorByMessageId: React.ComponentProps<typeof ConversationPanel>['traceErrorByMessageId'];
  traceEventsByMessageId: React.ComponentProps<typeof ConversationPanel>['traceEventsByMessageId'];
  traceHasMoreByMessageId: React.ComponentProps<typeof ConversationPanel>['traceHasMoreByMessageId'];
  traceLoadMoreLoadingByMessageId: React.ComponentProps<typeof ConversationPanel>['traceLoadMoreLoadingByMessageId'];
  traceLoadingByMessageId: React.ComponentProps<typeof ConversationPanel>['traceLoadingByMessageId'];
  onRunActionClick: NonNullable<React.ComponentProps<typeof ConversationPanel>['onRunActionClick']>;
  workspaceId: string;
  projectId: string;
  taskId: string;
}

export function TaskPageContent({
  agentIsBusy,
  artifacts,
  canUpdateTask,
  connectionErrorCode,
  connectionErrorMessage,
  connectionStatus,
  diagnosticsLinks,
  disabled,
  fetchTracesForMessage,
  focusTraceMessageId,
  focusTraceName,
  focusTraceToken,
  handleCancelActiveRun,
  handleDownloadArtifact,
  handlePendingRemove,
  handlePendingUpdate,
  handleSendMessage,
  handleViewArtifact,
  isDisabled,
  loadMoreTracesForMessage,
  messages,
  onRunActionClick,
  pendingMessages,
  projectId,
  runActivity,
  sandboxStarting,
  sending,
  showSseDebugPanel,
  sseDebugEvents,
  streamingContent,
  streamingMessageId,
  taskId,
  traceErrorByMessageId,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceLoadingByMessageId,
  workspaceId,
}: TaskPageContentProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.03),_transparent_40%)]">
      <div className="min-w-0 flex-1 rounded-[18px] border border-white/5 bg-surface/70 p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
        {showSseDebugPanel ? <NotebookSseDebugPanel events={sseDebugEvents} /> : null}
        <ConversationPanel
          messages={messages}
          streamingMessageId={streamingMessageId}
          streamingContent={streamingContent}
          connectionStatus={connectionStatus}
          connectionErrorCode={connectionErrorCode}
          connectionErrorMessage={connectionErrorMessage}
          traceEventsByMessageId={traceEventsByMessageId}
          traceHasMoreByMessageId={traceHasMoreByMessageId}
          traceLoadingByMessageId={traceLoadingByMessageId}
          traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
          traceErrorByMessageId={traceErrorByMessageId}
          diagnosticsLinks={diagnosticsLinks}
          onTraceExpand={fetchTracesForMessage}
          onTraceLoadMore={loadMoreTracesForMessage}
          onSendMessage={handleSendMessage}
          agentRunning={agentIsBusy}
          pendingQueue={pendingMessages}
          onPendingUpdate={handlePendingUpdate}
          onPendingRemove={handlePendingRemove}
          runActivity={runActivity}
          onCancelActiveRun={handleCancelActiveRun}
          onRunActionClick={onRunActionClick}
          focusTraceMessageId={focusTraceMessageId}
          focusTraceName={focusTraceName}
          focusTraceToken={focusTraceToken}
          sandboxStarting={sandboxStarting}
          disabled={disabled}
          sending={sending}
        />
      </div>
      <div className="w-[216px] flex-shrink-0 rounded-[16px] border border-white/5 bg-surface/68 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.1)]">
        <ArtifactsPanel
          artifacts={artifacts}
          onView={handleViewArtifact}
          onDownload={handleDownloadArtifact}
          disabled={isDisabled || !canUpdateTask}
        />
      </div>
    </div>
  );
}
