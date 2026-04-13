"use client";

import * as React from "react";
import { ArtifactsPanel } from "@/components/notebook/ArtifactsPanel";
import { ConversationPanel } from "@/components/notebook/ConversationPanel";
import { NotebookSseDebugPanel } from "@/components/notebook/NotebookSseDebugPanel";
import type { Artifact, TaskMessage } from "@/lib/types/task";

interface TaskPageContentProps {
  agentIsBusy: boolean;
  activeAgentMessageId: string | null;
  artifacts: Artifact[];
  artifactsRefreshing: boolean;
  canUpdateTask: boolean;
  connectionErrorCode: React.ComponentProps<
    typeof ConversationPanel
  >["connectionErrorCode"];
  connectionErrorMessage: React.ComponentProps<
    typeof ConversationPanel
  >["connectionErrorMessage"];
  connectionStatus: React.ComponentProps<
    typeof ConversationPanel
  >["connectionStatus"];
  diagnosticsLinks: React.ComponentProps<
    typeof ConversationPanel
  >["diagnosticsLinks"];
  disabled: boolean;
  fetchTracesForMessage: NonNullable<
    React.ComponentProps<typeof ConversationPanel>["onTraceExpand"]
  >;
  focusTraceMessageId: string | null;
  focusTraceName: string | null;
  focusTraceToken: number;
  handleCancelActiveRun: () => void;
  handleDownloadArtifact: (artifact: Artifact) => Promise<void>;
  handlePendingRemove: (id: string) => void;
  handleRefreshArtifacts: () => Promise<void>;
  handlePendingUpdate: (id: string, content: string) => void;
  handleSendMessage: (content: string) => Promise<void>;
  handleViewArtifact: (artifact: Artifact) => void;
  isDisabled: boolean;
  loadMoreTracesForMessage: (messageId: string) => void;
  messages: TaskMessage[];
  pendingMessages: Array<{ id: string; content: string }>;
  runActivity: NonNullable<
    React.ComponentProps<typeof ConversationPanel>["runActivity"]
  >;
  sandboxStarting: boolean;
  sending: boolean;
  showSseDebugPanel: boolean;
  sseDebugEvents: React.ComponentProps<typeof NotebookSseDebugPanel>["events"];
  streamingContent: string;
  streamingMessageId: string | null;
  traceErrorByMessageId: React.ComponentProps<
    typeof ConversationPanel
  >["traceErrorByMessageId"];
  traceEventsByMessageId: React.ComponentProps<
    typeof ConversationPanel
  >["traceEventsByMessageId"];
  traceHasMoreByMessageId: React.ComponentProps<
    typeof ConversationPanel
  >["traceHasMoreByMessageId"];
  traceLoadMoreLoadingByMessageId: React.ComponentProps<
    typeof ConversationPanel
  >["traceLoadMoreLoadingByMessageId"];
  traceLoadingByMessageId: React.ComponentProps<
    typeof ConversationPanel
  >["traceLoadingByMessageId"];
  onRunActionClick: NonNullable<
    React.ComponentProps<typeof ConversationPanel>["onRunActionClick"]
  >;
  workspaceId: string;
  projectId: string;
  taskId: string;
  viewMode?: "conversation" | "terminal";
  terminalWorkspace?: React.ReactNode;
  terminalStatusStrip?: React.ReactNode;
  artifactsDrawerOpen?: boolean;
  onToggleArtifactsDrawer?: () => void;
  artifactsShowLabel?: string;
  artifactsHideLabel?: string;
  inputPlaceholder?: string;
}

export function TaskPageContent({
  agentIsBusy,
  activeAgentMessageId,
  artifacts,
  artifactsRefreshing,
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
  handleRefreshArtifacts,
  handlePendingUpdate,
  handleSendMessage,
  handleViewArtifact,
  isDisabled,
  loadMoreTracesForMessage,
  messages,
  onRunActionClick,
  pendingMessages,
  projectId: _projectId,
  runActivity,
  sandboxStarting,
  sending,
  showSseDebugPanel,
  sseDebugEvents,
  streamingContent,
  streamingMessageId,
  taskId: _taskId,
  viewMode = "conversation",
  terminalWorkspace,
  terminalStatusStrip,
  artifactsDrawerOpen = true,
  onToggleArtifactsDrawer,
  artifactsShowLabel = "Show Artifacts",
  artifactsHideLabel = "Hide Artifacts",
  inputPlaceholder,
  traceErrorByMessageId,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceLoadingByMessageId,
  workspaceId: _workspaceId,
}: TaskPageContentProps) {
  const showConversationMode = viewMode === "conversation";
  const showTerminalMode = viewMode === "terminal";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.03),_transparent_40%)]">
      {terminalStatusStrip}
      <div className="mt-3 flex items-center justify-end">
        {onToggleArtifactsDrawer ? (
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center rounded-md border border-border/24 bg-transparent px-2.5 text-[11px] text-secondary transition-colors duration-150 hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground"
            onClick={onToggleArtifactsDrawer}
            data-testid="notebook__task-artifacts-toggle"
          >
            {artifactsDrawerOpen ? artifactsHideLabel : artifactsShowLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-subtle bg-surface/70 p-1.5 shadow-ambient">
          {showTerminalMode ? (
            <div className="h-full min-h-0 overflow-hidden">
              {terminalWorkspace}
            </div>
          ) : (
            <>
              {showSseDebugPanel ? (
                <NotebookSseDebugPanel events={sseDebugEvents} />
              ) : null}
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
                activeAgentMessageId={activeAgentMessageId}
                sending={sending}
                inputPlaceholder={inputPlaceholder}
              />
            </>
          )}
        </div>
        {artifactsDrawerOpen ? (
          <div
            className={`flex h-full min-h-0 flex-shrink-0 overflow-hidden rounded-md border border-subtle bg-surface/68 p-1.5 shadow-ambient ${
              showConversationMode ? "w-[216px]" : "w-[256px]"
            }`}
            data-testid="notebook__task-artifacts-drawer"
          >
            <ArtifactsPanel
              artifacts={artifacts}
              onView={handleViewArtifact}
              onDownload={handleDownloadArtifact}
              onRefresh={handleRefreshArtifacts}
              refreshing={artifactsRefreshing}
              disabled={isDisabled || !canUpdateTask}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
