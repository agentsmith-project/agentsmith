'use client';

import * as React from 'react';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import type { TaskTraceEvent } from '@/lib/types/task';
import { cn } from '@/lib/utils';
import type { TraceFilterMode, TraceStep, TraceSummary, TraceViewMode } from './types';
import { formatCancelledReasonKey, formatDuration, formatTraceEventTitle, formatTraceStatusKey, getTransportTraceMeta } from './utils';

export function TracePanel(props: {
  tNotebookConversation: (key: string, values?: Record<string, string | number>) => string;
  messageId: string;
  disabled: boolean;
  hasTrace: boolean;
  traceDetailsLoading: boolean;
  traceError?: { kind: NotebookTraceFailureKind; message: string };
  traceSummary: TraceSummary;
  traceViewMode: TraceViewMode;
  onTraceViewModeChange: (value: TraceViewMode) => void;
  traceFilterMode: TraceFilterMode;
  onTraceFilterModeChange: (value: TraceFilterMode) => void;
  filteredExecutionTraceEvents: TaskTraceEvent[];
  filteredTraceEvents: TaskTraceEvent[];
  transportTraceEvents: TaskTraceEvent[];
  traceSteps: TraceStep[];
  traceWarningCount: number;
  traceErrorCount: number;
  traceHasMore: boolean;
  traceLoadMoreLoading: boolean;
  onTraceLoadMore?: (messageId: string) => void;
  onCopyTraceLogs: () => void;
  expandedStepKeys: Record<string, boolean>;
  onExpandedStepKeysChange: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  focusedStepKey: string | null;
  stepElementRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  const {
    tNotebookConversation, messageId, disabled, hasTrace, traceDetailsLoading, traceError, traceSummary,
    traceViewMode, onTraceViewModeChange, traceFilterMode, onTraceFilterModeChange, filteredExecutionTraceEvents,
    filteredTraceEvents, transportTraceEvents, traceSteps, traceWarningCount, traceErrorCount, traceHasMore,
    traceLoadMoreLoading, onTraceLoadMore, onCopyTraceLogs, expandedStepKeys, onExpandedStepKeysChange,
    focusedStepKey, stepElementRefs,
  } = props;
  const traceErrorTitle = traceError?.kind === 'trace_unavailable'
    ? tNotebookConversation('trace_error_unavailable_title')
    : traceError?.kind === 'trace_forbidden'
      ? tNotebookConversation('trace_error_forbidden_title')
      : traceError?.kind === 'trace_network'
        ? tNotebookConversation('trace_error_network_title')
        : traceError?.kind === 'trace_failed'
          ? tNotebookConversation('trace_error_failed_title')
          : null;
  const traceSummaryCancelledReasonKey = traceSummary.status === 'cancelled' ? formatCancelledReasonKey(traceSummary) : null;
  const getTraceStatusText = (status: TraceSummary['status']) => tNotebookConversation(formatTraceStatusKey({ status }));

  return (
    <div className="mt-3 rounded-md border border-subtle bg-background/40 p-3" data-testid="notebook__message-trace-panel">
      {traceErrorTitle ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs" data-testid="notebook__message-trace-error">
          <div className="font-medium text-red-200">{traceErrorTitle}</div>
          {traceError?.message ? <div className="mt-0.5 text-red-100/90">{traceError.message}</div> : null}
        </div>
      ) : null}
      {traceDetailsLoading && !hasTrace ? (
        <div className="text-xs text-tertiary" data-testid="notebook__message-trace-loading">{tNotebookConversation('trace_details_loading')}</div>
      ) : !hasTrace && !traceErrorTitle ? (
        <div className="text-xs text-tertiary" data-testid="notebook__message-trace-empty">{tNotebookConversation('trace_no_details')}</div>
      ) : (
        <div className="space-y-3">
          {traceSummaryCancelledReasonKey ? (
            <div className="text-xs text-amber-200/90" data-testid="notebook__message-trace-cancel-reason">{tNotebookConversation(traceSummaryCancelledReasonKey)}</div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary" data-testid="notebook__message-trace-stats">
            <span>{tNotebookConversation('trace_stats_events', { count: filteredExecutionTraceEvents.length })}</span>
            {traceSummary.durationMs != null ? <span>{tNotebookConversation('trace_stats_duration', { value: formatDuration(traceSummary.durationMs) })}</span> : null}
            {traceWarningCount > 0 ? <span>{tNotebookConversation('trace_stats_warnings', { count: traceWarningCount })}</span> : null}
            {traceErrorCount > 0 ? <span className="text-red-300">{tNotebookConversation('trace_stats_errors', { count: traceErrorCount })}</span> : null}
            {traceHasMore ? <span>{tNotebookConversation('trace_stats_truncated')}</span> : null}
            {transportTraceEvents.length > 0 ? <span>{tNotebookConversation('trace_stats_transport', { count: transportTraceEvents.length })}</span> : null}
          </div>
          {traceViewMode === 'timeline' && transportTraceEvents.length > 0 ? (
            <div className="rounded-md border border-subtle/70 bg-background/50 p-2" data-testid="notebook__message-trace-transport">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">{tNotebookConversation('trace_transport_title')}</div>
              <div className="space-y-2">
                {transportTraceEvents.map((evt) => {
                  const meta = getTransportTraceMeta(evt)!;
                  const phaseClass = meta.phase === 'done' ? 'text-green-300' : meta.phase === 'error' ? 'text-red-300' : 'text-blue-300';
                  return (
                    <div key={evt.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid="notebook__message-trace-transport-item">
                      <span className="text-tertiary">{new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span className="text-primary">{tNotebookConversation(`trace_transport_kind_${meta.kind}`)}</span>
                      <span className={phaseClass}>{tNotebookConversation(`trace_transport_phase_${meta.phase}`)}</span>
                      <span className="text-tertiary">{evt.summary}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="notebook__message-trace-toolbar">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-md border border-subtle bg-background/50 p-0.5">
                <button type="button" className={cn('rounded px-2 py-1 text-xs', traceViewMode === 'timeline' ? 'bg-hover text-primary' : 'text-tertiary hover:text-primary')} onClick={() => onTraceViewModeChange('timeline')} data-testid="notebook__message-trace-view-timeline">{tNotebookConversation('trace_view_mode_timeline')}</button>
                <button type="button" className={cn('rounded px-2 py-1 text-xs', traceViewMode === 'raw' ? 'bg-hover text-primary' : 'text-tertiary hover:text-primary')} onClick={() => onTraceViewModeChange('raw')} data-testid="notebook__message-trace-view-raw">{tNotebookConversation('trace_view_mode_raw')}</button>
              </div>
              <div className="inline-flex items-center rounded-md border border-subtle bg-background/50 p-0.5" data-testid="notebook__message-trace-filter-group">
                {(['all', 'progress', 'tool', 'alerts', 'debug'] as const).map((mode) => (
                  <button key={mode} type="button" className={cn('rounded px-2 py-1 text-xs', traceFilterMode === mode ? 'bg-hover text-primary' : 'text-tertiary hover:text-primary')} onClick={() => onTraceFilterModeChange(mode)} data-testid={`notebook__message-trace-filter-${mode}`}>{tNotebookConversation(`trace_filter_${mode}`)}</button>
                ))}
              </div>
            </div>
            <button type="button" className="text-xs text-tertiary hover:text-primary underline underline-offset-2" onClick={onCopyTraceLogs} disabled={disabled} data-testid="notebook__message-trace-copy">{tNotebookConversation('trace_copy_logs')}</button>
          </div>
          <div className="max-h-72 overflow-y-auto" data-testid="notebook__message-trace-body">
            {traceViewMode === 'timeline' ? (
              <div className="space-y-3">
                {traceSteps.length === 0 ? <div className="text-xs text-tertiary" data-testid="notebook__message-trace-filter-empty">{tNotebookConversation('trace_filter_no_results')}</div> : null}
                {traceSteps.map((step) => (
                  <div key={step.key} ref={(el) => { stepElementRefs.current[step.key] = el; }} className={cn('rounded-md border border-subtle/70 bg-background/50 p-2', focusedStepKey === step.key && 'border-blue-400/60 bg-blue-500/10')} data-testid="notebook__trace-step">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={cn('inline-block h-2 w-2 rounded-full', step.status === 'success' ? 'bg-green-400' : step.status === 'error' ? 'bg-red-400' : step.status === 'cancelled' ? 'bg-amber-400' : 'bg-blue-400')} />
                      <span className="text-primary font-medium">{step.title || step.name}</span>
                      <span className="text-tertiary">{getTraceStatusText(step.status)}</span>
                      {step.durationMs != null ? <span className="text-tertiary">{formatDuration(step.durationMs)}</span> : null}
                      <button type="button" className="ml-auto text-tertiary hover:text-primary" onClick={() => onExpandedStepKeysChange((prev) => ({ ...prev, [step.key]: !prev[step.key] }))} data-testid="notebook__trace-step-toggle">
                        {expandedStepKeys[step.key] ? tNotebookConversation('trace_step_hide_details') : tNotebookConversation('trace_step_view_details')}
                      </button>
                    </div>
                    {expandedStepKeys[step.key] ? (
                      <div className="mt-2 space-y-1" data-testid="notebook__trace-step-details">
                        {step.events.map((evt) => (
                          <div key={evt.id} className="text-xs border-l border-subtle pl-2">
                            <div className="flex items-center gap-2 text-tertiary">
                              <span>{new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                              <span>{evt.category}</span>
                              {evt.phase ? <span>{evt.phase}</span> : null}
                            </div>
                            <div className="mt-0.5 text-primary">{formatTraceEventTitle(evt)}</div>
                            {evt.details && Object.keys(evt.details).length > 0 ? <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/20 p-2 text-[11px] text-tertiary">{JSON.stringify(evt.details, null, 2)}</pre> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2" data-testid="notebook__message-trace-raw">
                {filteredTraceEvents.length === 0 ? <div className="text-xs text-tertiary" data-testid="notebook__message-trace-filter-empty">{tNotebookConversation('trace_filter_no_results')}</div> : null}
                {filteredTraceEvents.map((evt) => (
                  <div key={evt.id} className="rounded border border-subtle/60 bg-background/50 p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-tertiary">
                      <span>{new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span>#{evt.seq}</span>
                      <span>{evt.category}</span>
                      {evt.phase ? <span>{evt.phase}</span> : null}
                      {evt.status ? <span>{evt.status}</span> : null}
                      <span className="text-primary">{evt.name}</span>
                    </div>
                    <div className="mt-1 text-primary">{evt.summary || evt.name}</div>
                    {evt.details && Object.keys(evt.details).length > 0 ? <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/20 p-2 text-[11px] text-tertiary">{JSON.stringify(evt.details, null, 2)}</pre> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
          {traceHasMore ? (
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="text-tertiary" data-testid="notebook__message-trace-truncated">{tNotebookConversation('trace_more_available')}</div>
              <button type="button" className="text-tertiary hover:text-primary underline underline-offset-2 disabled:opacity-50" onClick={() => onTraceLoadMore?.(messageId)} disabled={disabled || traceLoadMoreLoading} data-testid="notebook__message-trace-load-more">
                {traceLoadMoreLoading ? tNotebookConversation('trace_load_more_loading') : tNotebookConversation('trace_load_more')}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
