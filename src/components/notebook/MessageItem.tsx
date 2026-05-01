"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { NotebookTraceFailureKind } from "@/lib/build-failure-explainability";
import type { TaskMessage, TaskTraceEvent } from "@/lib/types/task";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/chat/Markdown";
import { formatElapsed } from "@/components/notebook/conversation-panel/utils";
import type { ActiveRunView } from "@/components/notebook/task-page/run-activity";
import {
  buildRenderableExecution,
  decodeCodexEventText,
  formatCancelledReasonKey,
  formatTraceStatusKey,
  type RenderableExecutionStep,
} from "@/components/notebook/message-item/utils";

export interface MessageItemProps {
  message: TaskMessage;
  streamingContent?: string | null;
  focusTraceName?: string | null;
  focusTraceToken?: number;
  traceEvents?: TaskTraceEvent[];
  traceDetailsLoading?: boolean;
  traceHasMore?: boolean;
  traceLoadMoreLoading?: boolean;
  traceError?: { kind: NotebookTraceFailureKind; message: string };
  disabled?: boolean;
  activeRunView?: ActiveRunView | null;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
  onRunActionClick?: (action: { traceName?: string; summary: string }) => void;
}

const DEFAULT_VISIBLE_STEPS = 2;

function RunStatusIcon({ running }: { running: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
      {running ? (
        <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-current/25 motion-reduce:animate-none" />
      ) : null}
      <span className={cn("inline-flex h-1.5 w-1.5 rounded-full bg-current", !running && "opacity-80")} />
    </span>
  );
}

function StepRow(props: {
  step: RenderableExecutionStep;
  tNotebookConversation: (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  highlighted?: boolean;
  latest?: boolean;
  recovered?: boolean;
}) {
  const {
    step,
    tNotebookConversation,
    highlighted = false,
    latest = false,
    recovered = false,
  } = props;
  const statusDotClass =
    recovered
      ? "text-amber-300"
      : step.status === "success"
        ? "text-green-300"
        : step.status === "error"
          ? "text-red-300"
          : step.status === "cancelled"
            ? "text-amber-300"
            : "text-blue-300";
  const detailText = step.detail.startsWith("process_")
    ? tNotebookConversation(step.detail)
    : step.detail;

  return (
    <div
      className={cn(
        "relative border-l border-subtle pl-4 pr-2 py-1.5",
        latest && "border-white/18",
        (highlighted || latest) && "rounded-r-md bg-white/[0.035]",
      )}
      data-testid="notebook__message-step-row"
    >
      <div className="flex items-start gap-2 text-[12px] text-secondary">
        <span
          className={cn(
            "mt-[2px] shrink-0 text-[13px] leading-none",
            statusDotClass,
          )}
          aria-hidden
        >
          •
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "font-medium",
              latest ? "text-primary" : "text-secondary",
            )}
          >
            {tNotebookConversation(step.title)}
          </div>
          <div
            className={cn(
              "mt-1 flex gap-2 text-[12px] leading-5",
              latest ? "text-secondary" : "text-tertiary",
            )}
            data-testid="notebook__message-step-detail"
          >
            <span className="shrink-0 text-tertiary/70">└</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
              {detailText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MessageItem({
  message,
  streamingContent,
  focusTraceName = null,
  focusTraceToken = 0,
  traceEvents = [],
  traceDetailsLoading = false,
  traceHasMore = false,
  traceLoadMoreLoading = false,
  traceError,
  disabled = false,
  activeRunView = null,
  onTraceExpand,
  onTraceLoadMore,
  onRunActionClick,
}: MessageItemProps) {
  const t = useTranslations("common.toast");
  const tCommon = useTranslations("common");
  const tNotebookConversation = useTranslations("notebook.conversation");
  const isUser = message.role === "user";
  const [showExecutionDetails, setShowExecutionDetails] =
    React.useState(false);
  const [showAllSteps, setShowAllSteps] = React.useState(false);
  const requestedInitialTraceRef = React.useRef(false);
  const messageDomId = React.useMemo(
    () => message.id.replace(/[^A-Za-z0-9_-]/g, "-"),
    [message.id],
  );
  const executionDetailsRegionId = `notebook-message-${messageDomId}-execution-details`;
  const executionHistoryRegionId = `notebook-message-${messageDomId}-execution-history`;
  const isActiveRun = !isUser && activeRunView?.messageId === message.id;

  const rawDisplayContent = streamingContent ?? message.content;
  const displayContent = isUser
    ? rawDisplayContent
    : decodeCodexEventText(rawDisplayContent);
  const renderableExecution = React.useMemo(
    () =>
      buildRenderableExecution({
        traceEvents,
        streamingContent,
        fallbackAnswer: displayContent,
      }),
    [displayContent, streamingContent, traceEvents],
  );
  const visibleStatus =
    !isUser &&
    ((streamingContent != null || isActiveRun) &&
      renderableExecution.primaryOutcome.status === "idle")
      ? "running"
      : renderableExecution.primaryOutcome.status;
  const recoveredStepKeys = React.useMemo(
    () =>
      new Set(renderableExecution.recoveredIssues.map((step) => step.key)),
    [renderableExecution.recoveredIssues],
  );
  const executionHistorySteps = React.useMemo(
    () =>
      renderableExecution.steps.filter(
        (step) => !recoveredStepKeys.has(step.key),
      ),
    [renderableExecution.steps, recoveredStepKeys],
  );
  const visibleSteps = showAllSteps
    ? executionHistorySteps
    : executionHistorySteps.slice(-DEFAULT_VISIBLE_STEPS);
  const hiddenStepCount = Math.max(
    0,
    executionHistorySteps.length - visibleSteps.length,
  );
  const canToggleSteps = executionHistorySteps.length > DEFAULT_VISIBLE_STEPS;
  const canToggleExecutionDetails =
    traceDetailsLoading ||
    traceError != null ||
    renderableExecution.recoveredIssues.length > 0 ||
    executionHistorySteps.length > 0 ||
    traceHasMore;
  const cancelledReasonKey = formatCancelledReasonKey({
    status: visibleStatus,
    cancelledOutcome: renderableExecution.summary.cancelledOutcome,
  });
  const processSummary = (() => {
    if (traceError != null) {
      return tNotebookConversation("process_details_unavailable");
    }
    if (
      traceDetailsLoading &&
      executionHistorySteps.length === 0 &&
      renderableExecution.recoveredIssues.length === 0
    ) {
      return tNotebookConversation("process_loading");
    }
    if (executionHistorySteps.length > 0) {
      return tNotebookConversation("process_history_summary", {
        count: executionHistorySteps.length,
      });
    }
    return tNotebookConversation("process_no_steps");
  })();

  React.useEffect(() => {
    if (isUser || requestedInitialTraceRef.current) return;
    if (!onTraceExpand) return;
    if (traceDetailsLoading) return;
    if (traceEvents.length > 0) return;
    if (traceError) return;
    requestedInitialTraceRef.current = true;
    onTraceExpand(message.id);
  }, [
    isUser,
    message.id,
    onTraceExpand,
    traceDetailsLoading,
    traceError,
    traceEvents.length,
  ]);

  React.useEffect(() => {
    if (!focusTraceName || focusTraceToken <= 0) return;
    setShowExecutionDetails(true);
    setShowAllSteps(true);
  }, [focusTraceName, focusTraceToken]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      toast.info(t("copied"));
    } catch {
      toast.error(t("copy_failed"));
    }
  };

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  const shouldShowProcessPanel =
    isActiveRun ||
    traceDetailsLoading ||
    traceError != null ||
    renderableExecution.recoveredIssues.length > 0 ||
    executionHistorySteps.length > 0 ||
    traceHasMore;
  const activeRunState = activeRunView?.runState;
  const activeRunHealthStatus = activeRunView?.realtimeHealth.status;
  const activeFooterState = (() => {
    if (!isActiveRun || !activeRunView) return undefined;
    if (
      activeRunState === "cancelling" ||
      activeRunState === "terminating" ||
      activeRunState === "finalizing"
    ) {
      return activeRunState;
    }
    if (activeRunHealthStatus === "error") {
      return "realtime_error";
    }
    if (
      activeRunHealthStatus === "reconnecting" ||
      activeRunHealthStatus === "disconnected"
    ) {
      return "reconnecting";
    }
    return activeRunState;
  })();
  const activeFooterStatusKey =
    activeFooterState === "realtime_error"
      ? "active_run_status_realtime_error"
      : activeFooterState === "reconnecting"
        ? "active_run_status_reconnecting"
        : activeFooterState === "cancelling"
          ? "active_run_status_cancelling"
          : activeFooterState === "terminating"
            ? "active_run_status_terminating"
            : activeFooterState === "finalizing"
              ? "active_run_status_finalizing"
              : "active_run_status_running";
  const latestAction = activeRunView?.recentActions[0] ?? null;
  const latestActionSummary =
    latestAction?.summary ?? activeRunView?.latestAction.summary ?? "";
  const cancelDisabled =
    disabled ||
    !activeRunView ||
    activeRunView.cancelPending ||
    activeRunView.runState === "cancelling" ||
    activeRunView.runState === "terminating" ||
    activeRunView.runState === "finalizing";
  const cancelLabel =
    activeRunView?.cancelPending || activeRunView?.runState === "cancelling"
      ? tNotebookConversation("run_cancel_submitting")
      : tNotebookConversation("run_cancel");

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(680px,62%)] rounded-md border border-subtle bg-hover px-4 py-3 text-foreground shadow-ambient">
          <div className="space-y-2">
            <Markdown content={displayContent} />
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <span className="text-[11px] text-tertiary">
              {formatTime(message.created_at)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopy}
              disabled={disabled}
              aria-label={tCommon("copy")}
              title={tCommon("copy")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-start pr-2">
      <div
        className="w-full max-w-[1120px] rounded-md border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.038),rgba(255,255,255,0.016))] px-5 py-4 shadow-card text-primary"
        data-testid="notebook__agent-message-bubble"
      >
        {shouldShowProcessPanel ? (
        <div data-testid="notebook__message-process-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary/90">
                {tNotebookConversation("process_details_title")}
              </div>
              <div
                className="mt-1 text-xs text-secondary"
                data-testid="notebook__message-process-summary"
              >
                {processSummary}
              </div>
            </div>
            {canToggleExecutionDetails ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-tertiary hover:text-primary"
                onClick={() => setShowExecutionDetails((prev) => !prev)}
                disabled={disabled}
                aria-expanded={showExecutionDetails}
                aria-controls={executionDetailsRegionId}
                data-testid="notebook__message-process-details-toggle"
              >
                {showExecutionDetails ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>
                  {showExecutionDetails
                    ? tNotebookConversation("process_details_collapse")
                    : tNotebookConversation("process_details_expand")}
                </span>
              </button>
            ) : null}
          </div>

          {showExecutionDetails ? (
            <div
              id={executionDetailsRegionId}
              role="region"
              aria-label={tNotebookConversation("process_details_title")}
            >
              {traceError ? (
                <div
                  className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs"
                  data-testid="notebook__message-process-error"
                >
                  <div className="font-medium text-red-200">
                    {traceError.message}
                  </div>
                </div>
              ) : null}

              {renderableExecution.recoveredIssues.length > 0 ? (
                <div
                  className="mt-3"
                  data-testid="notebook__message-recovered-issues"
                >
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-200/90">
                    {tNotebookConversation("process_recovered_issues_title")}
                  </div>
                  <div className="space-y-1">
                    {renderableExecution.recoveredIssues.map((step, index) => (
                      <StepRow
                        key={step.key}
                        step={step}
                        tNotebookConversation={tNotebookConversation}
                        highlighted={
                          focusTraceName != null &&
                          step.traceNames.includes(focusTraceName)
                        }
                        latest={
                          executionHistorySteps.length === 0 &&
                          index === renderableExecution.recoveredIssues.length - 1
                        }
                        recovered
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div
                className="mt-3 space-y-1"
                id={executionHistoryRegionId}
                role="region"
                aria-label={tNotebookConversation("process_history_region_label")}
                data-testid="notebook__message-process-steps"
              >
                {visibleSteps.map((step, index) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    tNotebookConversation={tNotebookConversation}
                    highlighted={
                      focusTraceName != null &&
                      step.traceNames.includes(focusTraceName)
                    }
                    latest={index === visibleSteps.length - 1}
                  />
                ))}
                {!traceDetailsLoading &&
                executionHistorySteps.length === 0 &&
                renderableExecution.recoveredIssues.length === 0 ? (
                  <div
                    className="text-xs text-tertiary"
                    data-testid="notebook__message-process-empty"
                  >
                    {tNotebookConversation("process_no_steps")}
                  </div>
                ) : null}
              </div>

              {canToggleSteps ? (
                <div className="mt-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-tertiary hover:text-primary"
                    onClick={() => setShowAllSteps((prev) => !prev)}
                    disabled={disabled}
                    aria-expanded={showAllSteps}
                    aria-controls={executionHistoryRegionId}
                    data-testid="notebook__message-process-toggle"
                  >
                    {showAllSteps ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {showAllSteps
                        ? tNotebookConversation("process_collapse")
                        : tNotebookConversation("process_expand", {
                            count: hiddenStepCount,
                          })}
                    </span>
                  </button>
                </div>
              ) : null}

              {showAllSteps && traceHasMore ? (
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <div className="text-tertiary">
                    {tNotebookConversation("process_more_available")}
                  </div>
                  <button
                    type="button"
                    className="text-tertiary underline underline-offset-2 hover:text-primary disabled:opacity-50"
                    onClick={() => onTraceLoadMore?.(message.id)}
                    disabled={disabled || traceLoadMoreLoading}
                    data-testid="notebook__message-trace-load-more"
                  >
                    {traceLoadMoreLoading
                      ? tNotebookConversation("process_load_more_loading")
                      : tNotebookConversation("process_load_more")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        ) : null}

        {displayContent.trim().length > 0 ? (
          <div
            className={cn(
              shouldShowProcessPanel ? "mt-4 border-t border-subtle pt-4" : "",
            )}
            data-testid="notebook__message-final-answer"
          >
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary/90">
              {tNotebookConversation("final_answer_title")}
            </div>
            <div className="max-w-[88ch]">
              <Markdown content={displayContent} />
            </div>
          </div>
        ) : streamingContent != null || isActiveRun ? (
          <div
            className={cn(
              shouldShowProcessPanel ? "mt-4 border-t border-subtle pt-4" : "",
            )}
            data-testid="notebook__message-final-answer-pending"
          >
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary/90">
              {tNotebookConversation("final_answer_title")}
            </div>
            <div className="space-y-2">
              <div className="h-3 w-2/3 animate-pulse rounded-sm bg-surface-high/60 motion-reduce:animate-none" />
              <div className="h-3 w-1/2 animate-pulse rounded-sm bg-surface-high/60 motion-reduce:animate-none" />
            </div>
          </div>
        ) : null}

        {cancelledReasonKey ? (
          <div
            className="mt-3 text-[11px] text-amber-200/90"
            data-testid="notebook__message-run-reason"
          >
            {tNotebookConversation(cancelledReasonKey)}
          </div>
        ) : null}

        {isActiveRun && activeRunView ? (
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-3 text-[11px]"
            data-testid="notebook__message-active-run-footer"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-tertiary">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
                  activeFooterState === "realtime_error"
                    ? "border-error/30 bg-error/8 text-error"
                    : activeFooterState === "reconnecting"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      : "border-blue-500/30 bg-blue-500/10 text-blue-300",
                )}
                data-testid="notebook__message-active-run-status"
              >
                <RunStatusIcon
                  running={
                    activeFooterState === "running" ||
                    activeFooterState === "reconnecting"
                  }
                />
                {tNotebookConversation(activeFooterStatusKey)}
              </span>
              <span
                className="text-tertiary"
                data-testid="notebook__message-active-run-elapsed"
              >
                {tNotebookConversation("active_run_elapsed", {
                  duration: formatElapsed(activeRunView.elapsedSeconds),
                })}
              </span>
              {latestActionSummary ? (
                latestAction?.traceName ? (
                  <button
                    type="button"
                    className="max-w-[min(560px,100%)] truncate text-left text-secondary hover:text-primary"
                    onClick={() =>
                      onRunActionClick?.({
                        traceName: latestAction.traceName,
                        summary: latestAction.summary,
                      })
                    }
                    title={latestActionSummary}
                    data-testid="notebook__message-active-run-latest-action"
                  >
                    {tNotebookConversation("active_run_latest_action", {
                      summary: latestActionSummary,
                    })}
                  </button>
                ) : (
                  <span
                    className="max-w-[min(560px,100%)] truncate text-secondary"
                    title={latestActionSummary}
                    data-testid="notebook__message-active-run-latest-action"
                  >
                    {tNotebookConversation("active_run_latest_action", {
                      summary: latestActionSummary,
                    })}
                  </span>
                )
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2.5 text-[11px]"
              onClick={activeRunView.onCancel}
              disabled={cancelDisabled}
              data-testid="notebook__message-active-run-cancel"
            >
              {cancelLabel}
            </Button>
          </div>
        ) : (
        <div
          className="mt-3 flex items-center justify-between gap-2 border-t border-subtle pt-3 text-[11px]"
          data-testid="notebook__message-status-footer"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-tertiary">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
                visibleStatus === "success"
                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                  : visibleStatus === "error"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : visibleStatus === "cancelled"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      : "border-blue-500/30 bg-blue-500/10 text-blue-300",
              )}
              data-testid="notebook__message-run-status"
            >
              <RunStatusIcon running={visibleStatus === "running"} />
              {tNotebookConversation(
                formatTraceStatusKey({
                  status: visibleStatus,
                  ...(visibleStatus === "cancelled"
                    ? {
                        cancelledOutcome:
                          renderableExecution.summary.cancelledOutcome,
                      }
                    : {}),
                }),
              )}
            </span>
            {renderableExecution.summary.durationMs != null ? (
              <span
                className="text-tertiary"
                data-testid="notebook__message-run-duration"
              >
                {tNotebookConversation("process_duration", {
                  value: renderableExecution.summary.durationText ?? "",
                })}
              </span>
            ) : null}
            <span className="text-tertiary">{formatTime(message.created_at)}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopy}
            disabled={disabled}
            aria-label={tCommon("copy")}
            title={tCommon("copy")}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        )}
      </div>
    </div>
  );
}
