"use client";

import * as React from "react";
import { ArtifactsPanel } from "@/components/agent-tasks/ArtifactsPanel";
import { ConversationPanel } from "@/components/agent-tasks/ConversationPanel";
import { AgentTaskSseDebugPanel } from "@/components/agent-tasks/AgentTaskSseDebugPanel";
import type { Artifact, TaskActivityItem } from "@/lib/types/task";
import type { ActiveRunView } from "@/components/agent-tasks/task-page/run-activity";

interface TaskPageContentProps {
  agentIsBusy: boolean;
  activeRunView: ActiveRunView | null;
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
  handleDownloadArtifact: (artifact: Artifact) => Promise<void>;
  handlePendingRemove: (id: string) => void;
  handleRefreshArtifacts: () => Promise<void>;
  handlePendingUpdate: (id: string, content: string) => void;
  handleSendMessage: (content: string) => Promise<void>;
  handleViewArtifact: (artifact: Artifact) => void;
  isDisabled: boolean;
  loadMoreTracesForMessage: (messageId: string) => void;
  messages: TaskActivityItem[];
  pendingMessages: Array<{ id: string; content: string }>;
  sandboxStarting: boolean;
  sending: boolean;
  showSseDebugPanel: boolean;
  sseDebugEvents: React.ComponentProps<typeof AgentTaskSseDebugPanel>["events"];
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
  inputPlaceholder?: string;
  conversationBlockedState?: React.ComponentProps<
    typeof ConversationPanel
  >["blockedState"];
}

export function TaskPageContent({
  agentIsBusy,
  activeRunView,
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
  inputPlaceholder,
  conversationBlockedState,
  traceErrorByMessageId,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceLoadingByMessageId,
  workspaceId: _workspaceId,
}: TaskPageContentProps) {
  const showConversationMode = viewMode === "conversation";
  const showTerminalMode = viewMode === "terminal";
  const hasTerminalWorkspace = terminalWorkspace != null;
  const hasArtifacts = artifacts.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-2">
      {terminalStatusStrip}
      <div
        className={`flex min-h-0 flex-1 gap-4 overflow-hidden ${
          terminalStatusStrip ? "mt-3" : ""
        }`}
        data-testid="agent-tasks__task-content-workspace"
      >
        <div
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
          data-testid="agent-tasks__task-primary-column"
        >
          {hasTerminalWorkspace ? (
            <div
              className={
                showTerminalMode
                  ? "min-h-0 min-w-0 w-full flex-1 basis-0 overflow-hidden"
                  : "pointer-events-none absolute h-0 w-0 overflow-hidden"
              }
              data-testid="agent-tasks__task-terminal-workspace-shell"
              aria-hidden={!showTerminalMode}
            >
              <div className="flex h-full min-h-0 w-full flex-1">
                {terminalWorkspace}
              </div>
            </div>
          ) : null}
          {showConversationMode ? (
            <div
              className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-subtle bg-background/92 p-1.5 shadow-ambient"
              data-testid="agent-tasks__task-conversation-shell"
            >
              <>
                {showSseDebugPanel ? (
                  <AgentTaskSseDebugPanel events={sseDebugEvents} />
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
                  activeRunView={activeRunView}
                  onRunActionClick={onRunActionClick}
                  focusTraceMessageId={focusTraceMessageId}
                  focusTraceName={focusTraceName}
                  focusTraceToken={focusTraceToken}
                  sandboxStarting={sandboxStarting}
                  disabled={disabled}
                  sending={sending}
                  inputPlaceholder={inputPlaceholder}
                  blockedState={conversationBlockedState}
                />
              </>
            </div>
          ) : null}
        </div>
        {hasArtifacts && artifactsDrawerOpen ? (
          <div className="flex min-h-0 flex-shrink-0" data-testid="agent-tasks__task-secondary-column">
            <div
              className={`flex h-full min-h-0 flex-shrink-0 overflow-hidden rounded-xl border border-subtle bg-background/92 p-1.5 shadow-ambient ${
                showConversationMode ? "w-[232px]" : "w-[272px]"
              }`}
              data-testid="agent-tasks__task-artifacts-drawer"
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
