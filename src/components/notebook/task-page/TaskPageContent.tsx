'use client';

import * as React from 'react';

import { AttachedFilesPanel } from '@/components/notebook/AttachedFilesPanel';
import { ArtifactsPanel } from '@/components/notebook/ArtifactsPanel';
import { ConversationPanel } from '@/components/notebook/ConversationPanel';
import { NotebookSseDebugPanel } from '@/components/notebook/NotebookSseDebugPanel';
import type { Artifact, TaskMessage } from '@/lib/types/task';

interface TaskPageContentProps {
  addingInput: boolean;
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
  handleAttachArtifactAsInput?: (artifact: Artifact) => void;
  handleCancelActiveRun: () => void;
  handleDownloadArtifact: (artifact: Artifact) => Promise<void>;
  handlePendingRemove: (id: string) => void;
  handlePendingUpdate: (id: string, content: string) => void;
  handleSaveArtifact: (artifact: Artifact) => void;
  handleSendMessage: (content: string) => Promise<void>;
  handleViewArtifact: (artifact: Artifact) => void;
  isDisabled: boolean;
  loadMoreTracesForMessage: (messageId: string) => void;
  messages: TaskMessage[];
  onSetAddUrlOpen: (open: boolean) => void;
  onSetFileSelectOpen: (open: boolean) => void;
  pendingMessages: Array<{ id: string; content: string }>;
  runActivity: NonNullable<React.ComponentProps<typeof ConversationPanel>['runActivity']>;
  sandboxStarting: boolean;
  sending: boolean;
  showExecutionDetails: boolean;
  showSseDebugPanel: boolean;
  sseDebugEvents: React.ComponentProps<typeof NotebookSseDebugPanel>['events'];
  streamingContent: string;
  streamingMessageId: string | null;
  taskAttachedInputIds: string[];
  traceErrorByMessageId: React.ComponentProps<typeof ConversationPanel>['traceErrorByMessageId'];
  traceEventsByMessageId: React.ComponentProps<typeof ConversationPanel>['traceEventsByMessageId'];
  traceHasMoreByMessageId: React.ComponentProps<typeof ConversationPanel>['traceHasMoreByMessageId'];
  traceLoadMoreLoadingByMessageId: React.ComponentProps<typeof ConversationPanel>['traceLoadMoreLoadingByMessageId'];
  traceLoadingByMessageId: React.ComponentProps<typeof ConversationPanel>['traceLoadingByMessageId'];
  onRunActionClick: NonNullable<React.ComponentProps<typeof ConversationPanel>['onRunActionClick']>;
  onToggleExecutionDetails: () => void;
  workspaceId: string;
  projectId: string;
  taskId: string;
}

export function TaskPageContent({
  addingInput,
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
  handleAttachArtifactAsInput,
  handleCancelActiveRun,
  handleDownloadArtifact,
  handlePendingRemove,
  handlePendingUpdate,
  handleSaveArtifact,
  handleSendMessage,
  handleViewArtifact,
  isDisabled,
  loadMoreTracesForMessage,
  messages,
  onSetAddUrlOpen,
  onSetFileSelectOpen,
  onRunActionClick,
  onToggleExecutionDetails,
  pendingMessages,
  projectId,
  runActivity,
  sandboxStarting,
  sending,
  showExecutionDetails,
  showSseDebugPanel,
  sseDebugEvents,
  streamingContent,
  streamingMessageId,
  taskAttachedInputIds,
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
      <div className="w-[184px] flex-shrink-0 rounded-[16px] border border-white/5 bg-surface/68 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.1)]">
        <AttachedFilesPanel
          workspaceId={workspaceId}
          projectId={projectId}
          taskId={taskId}
          attachedInputIds={taskAttachedInputIds}
          addingInput={addingInput}
          onAddFromFiles={() => {
            if (!canUpdateTask) return;
            onSetFileSelectOpen(true);
          }}
          onAddFromLocal={() => {
            if (!canUpdateTask || addingInput) return;
            onSetFileSelectOpen(true);
          }}
          onAddFromUrl={() => {
            if (!canUpdateTask || addingInput) return;
            onSetAddUrlOpen(true);
          }}
        />
      </div>
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
          showExecutionDetails={showExecutionDetails}
          onToggleExecutionDetails={onToggleExecutionDetails}
          sandboxStarting={sandboxStarting}
          disabled={disabled}
          sending={sending}
        />
      </div>
      <div className="w-[216px] flex-shrink-0 rounded-[16px] border border-white/5 bg-surface/68 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.1)]">
        <ArtifactsPanel
          artifacts={artifacts}
          onView={handleViewArtifact}
          onSave={handleSaveArtifact}
          onDownload={handleDownloadArtifact}
          onAttachAsInput={handleAttachArtifactAsInput}
          disabled={isDisabled || !canUpdateTask}
        />
      </div>
    </div>
  );
}
