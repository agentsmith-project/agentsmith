'use client';

import * as React from 'react';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';
import { TracePanel } from '@/components/notebook/message-item/TracePanel';
import type { TraceFilterMode, TraceSummary, TraceViewMode } from '@/components/notebook/message-item/types';
import {
  aggregateTraceSteps,
  decodeCodexEventText,
  formatCancelledReasonKey,
  formatTraceStatusKey,
  getTransportTraceMeta,
  isExecutionTraceEvent,
  matchesTraceFilter,
  summarizeTraceEvents,
} from '@/components/notebook/message-item/utils';

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
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
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
  onTraceExpand,
  onTraceLoadMore,
}: MessageItemProps) {
  const t = useTranslations('common.toast');
  const tCommon = useTranslations('common');
  const tNotebookConversation = useTranslations('notebook.conversation');
  const isUser = message.role === 'user';
  const [traceExpanded, setTraceExpanded] = React.useState(false);
  const [expandedStepKeys, setExpandedStepKeys] = React.useState<Record<string, boolean>>({});
  const [focusedStepKey, setFocusedStepKey] = React.useState<string | null>(null);
  const [traceViewMode, setTraceViewMode] = React.useState<TraceViewMode>('timeline');
  const [traceFilterMode, setTraceFilterMode] = React.useState<TraceFilterMode>('progress');
  const appliedFocusTokenRef = React.useRef(0);
  const stepElementRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const rawDisplayContent = streamingContent ?? message.content;
  const displayContent = isUser ? rawDisplayContent : decodeCodexEventText(rawDisplayContent);
  const traceSummary = !isUser ? summarizeTraceEvents(traceEvents) : { status: 'idle' as const, stepCount: 0 };
  const hasTrace = !isUser && traceEvents.length > 0;
  const canShowTraceToggle = !isUser;
  const visibleRunStatus: TraceSummary['status'] = !isUser && streamingContent != null && traceSummary.status === 'idle' ? 'running' : traceSummary.status;
  const sortedTraceEvents = React.useMemo(() => [...traceEvents].sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at))), [traceEvents]);
  const filteredTraceEvents = React.useMemo(() => sortedTraceEvents.filter((evt) => matchesTraceFilter(evt, traceFilterMode)), [sortedTraceEvents, traceFilterMode]);
  const filteredExecutionTraceEvents = React.useMemo(() => filteredTraceEvents.filter(isExecutionTraceEvent), [filteredTraceEvents]);
  const transportTraceEvents = React.useMemo(() => sortedTraceEvents.filter((evt) => getTransportTraceMeta(evt) != null), [sortedTraceEvents]);
  const traceSteps = React.useMemo(() => aggregateTraceSteps(filteredExecutionTraceEvents), [filteredExecutionTraceEvents]);
  const traceErrorCount = React.useMemo(() => filteredExecutionTraceEvents.filter((evt) => evt.category === 'error').length, [filteredExecutionTraceEvents]);
  const traceWarningCount = React.useMemo(() => filteredExecutionTraceEvents.filter((evt) => evt.category === 'warning').length, [filteredExecutionTraceEvents]);
  const visibleRunStatusClass = visibleRunStatus === 'success'
    ? 'text-green-300 border-green-500/30 bg-green-500/10'
    : visibleRunStatus === 'error'
      ? 'text-red-300 border-red-500/30 bg-red-500/10'
      : visibleRunStatus === 'cancelled'
        ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
        : 'text-blue-300 border-blue-500/30 bg-blue-500/10';
  const visibleRunCancelledReasonKey = visibleRunStatus === 'cancelled' ? formatCancelledReasonKey(traceSummary) : null;

  React.useEffect(() => {
    setExpandedStepKeys((prev) => {
      const valid = new Set(traceSteps.map((step) => step.key));
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!valid.has(key)) {
          changed = true;
          continue;
        }
        next[key] = value;
      }
      return changed ? next : prev;
    });
  }, [traceSteps]);

  React.useEffect(() => {
    if (!traceExpanded) return;
    onTraceExpand?.(message.id);
  }, [message.id, onTraceExpand, traceExpanded]);

  React.useEffect(() => {
    if (!focusTraceName || focusTraceToken <= 0) return;
    if (appliedFocusTokenRef.current === focusTraceToken) return;
    appliedFocusTokenRef.current = focusTraceToken;
    setTraceExpanded(true);
    setTraceViewMode('timeline');
    setTraceFilterMode('all');
  }, [focusTraceName, focusTraceToken]);

  React.useEffect(() => {
    if (!traceExpanded || !focusTraceName || focusTraceToken <= 0) return;
    const target = traceSteps.find((step) => step.name === focusTraceName);
    if (!target) return;
    setExpandedStepKeys((prev) => ({ ...prev, [target.key]: true }));
    setFocusedStepKey(target.key);
    const timer = setTimeout(() => {
      setFocusedStepKey((current) => (current === target.key ? null : current));
    }, 2200);
    const el = stepElementRefs.current[target.key];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return () => clearTimeout(timer);
  }, [focusTraceName, focusTraceToken, traceExpanded, traceSteps]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      toast.info(t('copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  };

  const handleCopyTraceLogs = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filteredTraceEvents, null, 2));
      toast.info(t('copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  };

  const formatTime = (dateString: string) => new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] rounded-md px-4 py-3 border relative', isUser ? 'bg-hover text-foreground border-subtle' : 'bg-surface-high text-primary border-subtle')}>
        <div className="space-y-2">
          {streamingContent != null ? (
            <div className="min-h-[48px]">
              {displayContent.trim().length === 0 ? (
                <div className="space-y-2">
                  <div className="h-3 w-2/3 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/2 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/3 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="pt-1 text-xs text-tertiary" data-testid="notebook__agent-streaming-status">{tNotebookConversation('agent_working')}</div>
                </div>
              ) : (
                <Markdown content={displayContent || '…'} />
              )}
            </div>
          ) : (
            <Markdown content={displayContent} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 justify-end">
          {!isUser ? (
            <span className={cn('mr-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', visibleRunStatusClass)} data-testid="notebook__message-run-status">
              {tNotebookConversation(formatTraceStatusKey({ status: visibleRunStatus, ...(visibleRunStatus === 'cancelled' ? { cancelledOutcome: traceSummary.cancelledOutcome } : {}) }))}
            </span>
          ) : null}
          {canShowTraceToggle ? (
            <button type="button" className="mr-auto text-[11px] text-tertiary hover:text-primary" onClick={() => setTraceExpanded((prev) => !prev)} disabled={disabled} data-testid="notebook__message-trace-toggle" data-trace-message-id={message.id}>
              {traceDetailsLoading && !hasTrace ? (
                <span className="text-blue-300">{tNotebookConversation('trace_details_loading')}</span>
              ) : !hasTrace ? (
                <span className="text-tertiary">{tNotebookConversation('trace_no_details')}</span>
              ) : (
                <span>{traceExpanded ? tNotebookConversation('trace_hide') : tNotebookConversation('trace_view')}</span>
              )}
            </button>
          ) : null}
          <span className="text-[11px] text-tertiary">{formatTime(message.created_at)}</span>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy} disabled={disabled} aria-label={tCommon('copy')} title={tCommon('copy')}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        {!isUser && visibleRunCancelledReasonKey ? (
          <div className="mt-1 text-[11px] text-amber-200/90" data-testid="notebook__message-run-reason">{tNotebookConversation(visibleRunCancelledReasonKey)}</div>
        ) : null}
        {canShowTraceToggle && traceExpanded ? (
          <TracePanel
            tNotebookConversation={tNotebookConversation}
            messageId={message.id}
            disabled={disabled}
            hasTrace={hasTrace}
            traceDetailsLoading={traceDetailsLoading}
            traceError={traceError}
            traceSummary={traceSummary}
            traceViewMode={traceViewMode}
            onTraceViewModeChange={setTraceViewMode}
            traceFilterMode={traceFilterMode}
            onTraceFilterModeChange={setTraceFilterMode}
            filteredExecutionTraceEvents={filteredExecutionTraceEvents}
            filteredTraceEvents={filteredTraceEvents}
            transportTraceEvents={transportTraceEvents}
            traceSteps={traceSteps}
            traceWarningCount={traceWarningCount}
            traceErrorCount={traceErrorCount}
            traceHasMore={traceHasMore}
            traceLoadMoreLoading={traceLoadMoreLoading}
            onTraceLoadMore={onTraceLoadMore}
            onCopyTraceLogs={handleCopyTraceLogs}
            expandedStepKeys={expandedStepKeys}
            onExpandedStepKeysChange={setExpandedStepKeys}
            focusedStepKey={focusedStepKey}
            stepElementRefs={stepElementRefs}
          />
        ) : null}
      </div>
    </div>
  );
}
