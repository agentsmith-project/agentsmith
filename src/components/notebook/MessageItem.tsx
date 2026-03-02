'use client';
import * as React from 'react';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';

export interface MessageItemProps {
  message: TaskMessage;
  streamingContent?: string | null;
  traceEvents?: TaskTraceEvent[];
  traceDetailsLoading?: boolean;
  traceHasMore?: boolean;
  traceLoadMoreLoading?: boolean;
  disabled?: boolean;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
}

type TraceSummary = {
  status: 'running' | 'success' | 'error' | 'cancelled' | 'idle';
  stepCount: number;
  currentStep?: string;
  durationMs?: number;
};

type TraceStep = {
  key: string;
  name: string;
  title: string;
  status: 'running' | 'success' | 'error' | 'cancelled' | 'idle';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  events: TaskTraceEvent[];
};

type TraceViewMode = 'timeline' | 'raw';
type TraceFilterMode = 'all' | 'progress' | 'tool' | 'alerts' | 'debug';
type TransportTraceKind = 'gap_fill' | 'reconcile';
type TransportTracePhase = 'start' | 'done' | 'error';

function matchesTraceFilter(evt: TaskTraceEvent, mode: TraceFilterMode): boolean {
  switch (mode) {
    case 'all':
      return true;
    case 'progress':
      return evt.category === 'progress' || evt.category === 'lifecycle';
    case 'tool':
      return evt.category === 'tool' || evt.category === 'artifact';
    case 'alerts':
      return evt.category === 'warning' || evt.category === 'error';
    case 'debug':
      return evt.category === 'debug';
    default:
      return true;
  }
}

function getTransportTraceMeta(evt: TaskTraceEvent): {
  kind: TransportTraceKind;
  phase: TransportTracePhase;
} | null {
  if (evt.category !== 'debug' || !evt.details) return null;
  const transportKind = evt.details.transport_kind;
  const transportPhase = evt.details.transport_phase;
  if (
    (transportKind === 'gap_fill' || transportKind === 'reconcile') &&
    (transportPhase === 'start' || transportPhase === 'done' || transportPhase === 'error')
  ) {
    return { kind: transportKind, phase: transportPhase };
  }
  return null;
}

function splitConcatenatedJsonObjects(input: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (!ch) continue;

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        items.push(input.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return items;
}

function decodeCodexEventText(raw: string): string {
  if (!raw || raw.indexOf('"type":"') < 0) return raw;

  const objects = splitConcatenatedJsonObjects(raw);
  if (objects.length === 0) return raw;

  const agentTexts: string[] = [];
  const agentDeltas: string[] = [];
  const errors: string[] = [];

  for (const text of objects) {
    try {
      const evt = JSON.parse(text) as {
        type?: string;
        item?: { type?: string; text?: string; message?: string };
        delta?: string | { text?: string };
        text?: string;
        message?: string;
        error?: { message?: string };
      };
      if (evt.type === 'response.output_text.delta') {
        if (typeof evt.delta === 'string') {
          agentDeltas.push(evt.delta);
          continue;
        }
      }
      if (evt.type === 'response.output_text.done' && typeof evt.text === 'string') {
        agentTexts.push(evt.text);
        continue;
      }
      if (evt.type === 'item.delta' && typeof evt.delta === 'object' && evt.delta && typeof evt.delta.text === 'string') {
        agentDeltas.push(evt.delta.text);
        continue;
      }
      if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && typeof evt.item.text === 'string') {
        agentTexts.push(evt.item.text);
        continue;
      }
      if (evt.type === 'error' && typeof evt.message === 'string') {
        errors.push(evt.message);
        continue;
      }
      if (evt.type === 'turn.failed' && typeof evt.error?.message === 'string') {
        errors.push(evt.error.message);
      }
    } catch {
      // Ignore incomplete trailing JSON while streaming and keep the decoded prefix.
      continue;
    }
  }

  if (agentTexts.length > 0) {
    return agentTexts.join('\n\n');
  }
  if (agentDeltas.length > 0) {
    return agentDeltas.join('');
  }
  // Tool/runtime error events can be transient and auto-recovered by subsequent retries.
  // Keep bubble content neutral instead of surfacing raw error text as assistant output.
  if (errors.length > 0) {
    return '';
  }
  // Streaming state before agent_message is completed: render as empty to keep placeholder skeleton.
  return '';
}

function summarizeTraceEvents(traceEvents: TaskTraceEvent[]): TraceSummary {
  if (traceEvents.length === 0) {
    return { status: 'idle', stepCount: 0 };
  }
  const sorted = [...traceEvents].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.at.localeCompare(b.at);
  });
  const stepEvents = sorted.filter((evt) => evt.category !== 'debug' && evt.category !== 'lifecycle');
  const terminal = [...sorted].reverse().find((evt) => evt.status && evt.status !== 'running');
  const running = [...sorted].reverse().find((evt) => evt.status === 'running' || evt.phase === 'start');
  const startedAt = sorted[0]?.at ? Date.parse(sorted[0].at) : NaN;
  const endedAtCandidate = terminal?.at ? Date.parse(terminal.at) : (sorted[sorted.length - 1]?.at ? Date.parse(sorted[sorted.length - 1]!.at) : NaN);
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(endedAtCandidate)
    ? Math.max(0, endedAtCandidate - startedAt)
    : undefined;
  return {
    status: terminal?.status ?? (running ? 'running' : 'idle'),
    stepCount: Math.max(1, stepEvents.length || sorted.length),
    currentStep: (running ?? sorted[sorted.length - 1])?.summary,
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
  };
}

function formatTraceStatusKey(status: TraceSummary['status']): string {
  switch (status) {
    case 'running':
      return 'trace_status_running';
    case 'success':
      return 'trace_status_success';
    case 'error':
      return 'trace_status_error';
    case 'cancelled':
      return 'trace_status_cancelled';
    default:
      return 'trace_status_idle';
  }
}

function computeDurationMs(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}

function aggregateTraceSteps(traceEvents: TaskTraceEvent[]): TraceStep[] {
  if (traceEvents.length === 0) return [];
  const sorted = [...traceEvents].sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
  const steps: TraceStep[] = [];
  const activeByName = new Map<string, number>();

  for (const evt of sorted) {
    if (evt.category === 'debug') continue;
    const stepKey = evt.name;
    const existingIndex = activeByName.get(stepKey);
    const shouldStartNewStep = existingIndex == null
      || evt.phase === 'start'
      || (steps[existingIndex] && steps[existingIndex].status !== 'running');

    if (shouldStartNewStep) {
      const step: TraceStep = {
        key: `${evt.id}:${evt.name}`,
        name: evt.name,
        title: evt.summary || evt.name,
        status: evt.status ?? (evt.phase === 'start' ? 'running' : 'idle'),
        startedAt: evt.at,
        endedAt: evt.status && evt.status !== 'running' ? evt.at : undefined,
        events: [evt],
      };
      step.durationMs = computeDurationMs(step.startedAt, step.endedAt);
      steps.push(step);
      activeByName.set(stepKey, steps.length - 1);
      continue;
    }

    const step = steps[existingIndex]!;
    step.events.push(evt);
    step.title = step.title || evt.summary || evt.name;
    if (!step.startedAt) step.startedAt = evt.at;
    if (evt.summary) step.title = evt.summary;
    if (evt.status) {
      step.status = evt.status;
      if (evt.status !== 'running') {
        step.endedAt = evt.at;
      }
    } else if (evt.phase === 'end' && step.status === 'running') {
      step.status = 'success';
      step.endedAt = evt.at;
    }
    step.durationMs = computeDurationMs(step.startedAt, step.endedAt);
  }

  return steps;
}

export function MessageItem({
  message,
  streamingContent,
  traceEvents = [],
  traceDetailsLoading = false,
  traceHasMore = false,
  traceLoadMoreLoading = false,
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
  const [traceViewMode, setTraceViewMode] = React.useState<TraceViewMode>('timeline');
  const [traceFilterMode, setTraceFilterMode] = React.useState<TraceFilterMode>('all');

  const rawDisplayContent = streamingContent ?? message.content;
  const displayContent = isUser ? rawDisplayContent : decodeCodexEventText(rawDisplayContent);
  const traceSummary = !isUser ? summarizeTraceEvents(traceEvents) : { status: 'idle' as const, stepCount: 0 };
  const hasTrace = !isUser && traceEvents.length > 0;
  const canShowTraceToggle = !isUser;
  const sortedTraceEvents = React.useMemo(
    () => [...traceEvents].sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at))),
    [traceEvents],
  );
  const filteredTraceEvents = React.useMemo(
    () => sortedTraceEvents.filter((evt) => matchesTraceFilter(evt, traceFilterMode)),
    [sortedTraceEvents, traceFilterMode],
  );
  const transportTraceEvents = React.useMemo(
    () => sortedTraceEvents.filter((evt) => getTransportTraceMeta(evt) != null),
    [sortedTraceEvents],
  );
  const traceSteps = React.useMemo(() => aggregateTraceSteps(filteredTraceEvents), [filteredTraceEvents]);
  const traceErrorCount = React.useMemo(
    () => filteredTraceEvents.filter((evt) => evt.category === 'error').length,
    [filteredTraceEvents],
  );
  const traceWarningCount = React.useMemo(
    () => filteredTraceEvents.filter((evt) => evt.category === 'warning').length,
    [filteredTraceEvents],
  );
  const formatDuration = (ms?: number) => {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    if (ms < 1000) return '<1s';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
  };
  const traceStatusClass = traceSummary.status === 'success'
    ? 'text-green-300'
    : traceSummary.status === 'error'
      ? 'text-red-300'
      : traceSummary.status === 'cancelled'
        ? 'text-amber-300'
      : 'text-blue-300';

  React.useEffect(() => {
    // Prune stale step expansion state when trace list changes.
    setExpandedStepKeys((prev) => {
      const valid = new Set(traceSteps.map((s) => s.key));
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

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-md px-4 py-3 border relative',
          isUser
            ? 'bg-hover text-foreground border-subtle'
            : 'bg-surface-high text-primary border-subtle',
        )}
      >
        <div className="space-y-2">
          {streamingContent != null ? (
            <div className="min-h-[48px]">
              {displayContent.trim().length === 0 ? (
                <div className="space-y-2">
                  <div className="h-3 w-2/3 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/2 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/3 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="pt-1 text-xs text-tertiary" data-testid="notebook__agent-streaming-status">
                    {tNotebookConversation('agent_working')}
                  </div>
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
          {canShowTraceToggle && (
            <button
              type="button"
              className="mr-auto text-[11px] text-tertiary hover:text-primary"
              onClick={() => setTraceExpanded((prev) => !prev)}
              disabled={disabled}
              data-testid="notebook__message-trace-toggle"
              data-trace-message-id={message.id}
            >
              {traceDetailsLoading && !hasTrace ? (
                <span className="text-blue-300">{tNotebookConversation('trace_details_loading')}</span>
              ) : !hasTrace ? (
                <span className="text-tertiary">{tNotebookConversation('trace_no_details')}</span>
              ) : (
                <>
                  <span className={traceStatusClass}>
                    {tNotebookConversation(formatTraceStatusKey(traceSummary.status))}
                  </span>
                  {' · '}
                  {tNotebookConversation('trace_step_count', { count: traceSummary.stepCount })}
                  {traceSummary.durationMs != null ? ` · ${formatDuration(traceSummary.durationMs)}` : ''}
                  {traceSummary.currentStep ? ` · ${traceSummary.currentStep}` : ''}
                </>
              )}
              {' · '}
              {traceExpanded
                ? tNotebookConversation('trace_hide')
                : tNotebookConversation('trace_view')}
            </button>
          )}
          <span className="text-[11px] text-tertiary">{formatTime(message.created_at)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopy}
            disabled={disabled}
            aria-label={tCommon('copy')}
            title={tCommon('copy')}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        {canShowTraceToggle && traceExpanded && (
          <div className="mt-3 rounded-md border border-subtle bg-background/40 p-3" data-testid="notebook__message-trace-panel">
            {traceDetailsLoading && !hasTrace ? (
              <div className="text-xs text-tertiary" data-testid="notebook__message-trace-loading">
                {tNotebookConversation('trace_details_loading')}
              </div>
            ) : !hasTrace ? (
              <div className="text-xs text-tertiary" data-testid="notebook__message-trace-empty">
                {tNotebookConversation('trace_no_details')}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary" data-testid="notebook__message-trace-stats">
                  <span>{tNotebookConversation('trace_stats_events', { count: filteredTraceEvents.length })}</span>
                  {traceSummary.durationMs != null ? (
                    <span>{tNotebookConversation('trace_stats_duration', { value: formatDuration(traceSummary.durationMs) })}</span>
                  ) : null}
                  {traceWarningCount > 0 ? (
                    <span>{tNotebookConversation('trace_stats_warnings', { count: traceWarningCount })}</span>
                  ) : null}
                  {traceErrorCount > 0 ? (
                    <span className="text-red-300">{tNotebookConversation('trace_stats_errors', { count: traceErrorCount })}</span>
                  ) : null}
                  {traceHasMore ? (
                    <span>{tNotebookConversation('trace_stats_truncated')}</span>
                  ) : null}
                </div>
                {traceViewMode === 'timeline' && transportTraceEvents.length > 0 ? (
                  <div className="rounded-md border border-subtle/70 bg-background/50 p-2" data-testid="notebook__message-trace-transport">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">
                      {tNotebookConversation('trace_transport_title')}
                    </div>
                    <div className="space-y-2">
                      {transportTraceEvents.map((evt) => {
                        const transportMeta = getTransportTraceMeta(evt)!;
                        const phaseClass = transportMeta.phase === 'done'
                          ? 'text-green-300'
                          : transportMeta.phase === 'error'
                            ? 'text-red-300'
                            : 'text-blue-300';
                        return (
                          <div
                            key={evt.id}
                            className="flex flex-wrap items-center gap-2 text-xs"
                            data-testid="notebook__message-trace-transport-item"
                          >
                            <span className="text-tertiary">
                              {new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className="text-primary">
                              {tNotebookConversation(`trace_transport_kind_${transportMeta.kind}`)}
                            </span>
                            <span className={phaseClass}>
                              {tNotebookConversation(`trace_transport_phase_${transportMeta.phase}`)}
                            </span>
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
                    <button
                      type="button"
                      className={cn(
                        'rounded px-2 py-1 text-xs',
                        traceViewMode === 'timeline' ? 'bg-hover text-primary' : 'text-tertiary hover:text-primary',
                      )}
                      onClick={() => setTraceViewMode('timeline')}
                      data-testid="notebook__message-trace-view-timeline"
                    >
                      {tNotebookConversation('trace_view_mode_timeline')}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded px-2 py-1 text-xs',
                        traceViewMode === 'raw' ? 'bg-hover text-primary' : 'text-tertiary hover:text-primary',
                      )}
                      onClick={() => setTraceViewMode('raw')}
                      data-testid="notebook__message-trace-view-raw"
                    >
                      {tNotebookConversation('trace_view_mode_raw')}
                    </button>
                    </div>
                    <div className="inline-flex items-center rounded-md border border-subtle bg-background/50 p-0.5" data-testid="notebook__message-trace-filter-group">
                      {(['all', 'progress', 'tool', 'alerts', 'debug'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={cn(
                            'rounded px-2 py-1 text-xs',
                            traceFilterMode === mode ? 'bg-hover text-primary' : 'text-tertiary hover:text-primary',
                          )}
                          onClick={() => setTraceFilterMode(mode)}
                          data-testid={`notebook__message-trace-filter-${mode}`}
                        >
                          {tNotebookConversation(`trace_filter_${mode}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-tertiary hover:text-primary underline underline-offset-2"
                    onClick={handleCopyTraceLogs}
                    disabled={disabled}
                    data-testid="notebook__message-trace-copy"
                  >
                    {tNotebookConversation('trace_copy_logs')}
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto" data-testid="notebook__message-trace-body">
                  {traceViewMode === 'timeline' ? (
                    <div className="space-y-3">
                      {traceSteps.length === 0 ? (
                        <div className="text-xs text-tertiary" data-testid="notebook__message-trace-filter-empty">
                          {tNotebookConversation('trace_filter_no_results')}
                        </div>
                      ) : null}
                      {traceSteps.map((step) => (
                        <div key={step.key} className="rounded-md border border-subtle/70 bg-background/50 p-2" data-testid="notebook__trace-step">
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={cn(
                                'inline-block h-2 w-2 rounded-full',
                                step.status === 'success'
                                  ? 'bg-green-400'
                                  : step.status === 'error'
                                    ? 'bg-red-400'
                                    : step.status === 'cancelled'
                                      ? 'bg-amber-400'
                                      : 'bg-blue-400',
                              )}
                            />
                            <span className="text-primary font-medium">{step.title || step.name}</span>
                            <span className="text-tertiary">{step.status}</span>
                            {step.durationMs != null ? (
                              <span className="text-tertiary">{formatDuration(step.durationMs)}</span>
                            ) : null}
                            <button
                              type="button"
                              className="ml-auto text-tertiary hover:text-primary"
                              onClick={() => setExpandedStepKeys((prev) => ({ ...prev, [step.key]: !prev[step.key] }))}
                              data-testid="notebook__trace-step-toggle"
                            >
                              {expandedStepKeys[step.key]
                                ? tNotebookConversation('trace_step_hide_details')
                                : tNotebookConversation('trace_step_view_details')}
                            </button>
                          </div>
                          {expandedStepKeys[step.key] && (
                            <div className="mt-2 space-y-1" data-testid="notebook__trace-step-details">
                              {step.events.map((evt) => (
                                <div key={evt.id} className="text-xs border-l border-subtle pl-2">
                                  <div className="flex items-center gap-2 text-tertiary">
                                    <span>{new Date(evt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                    <span>{evt.category}</span>
                                    {evt.phase ? <span>{evt.phase}</span> : null}
                                  </div>
                                  <div className="mt-0.5 text-primary">{evt.summary || evt.name}</div>
                                  {evt.details && Object.keys(evt.details).length > 0 && (
                                    <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/20 p-2 text-[11px] text-tertiary">
                                      {JSON.stringify(evt.details, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="notebook__message-trace-raw">
                      {filteredTraceEvents.length === 0 ? (
                        <div className="text-xs text-tertiary" data-testid="notebook__message-trace-filter-empty">
                          {tNotebookConversation('trace_filter_no_results')}
                        </div>
                      ) : null}
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
                          {evt.details && Object.keys(evt.details).length > 0 ? (
                            <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/20 p-2 text-[11px] text-tertiary">
                              {JSON.stringify(evt.details, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              {traceHasMore && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="text-tertiary" data-testid="notebook__message-trace-truncated">
                    {tNotebookConversation('trace_more_available')}
                  </div>
                  <button
                    type="button"
                    className="text-tertiary hover:text-primary underline underline-offset-2 disabled:opacity-50"
                    onClick={() => onTraceLoadMore?.(message.id)}
                    disabled={disabled || traceLoadMoreLoading}
                    data-testid="notebook__message-trace-load-more"
                  >
                    {traceLoadMoreLoading
                      ? tNotebookConversation('trace_load_more_loading')
                      : tNotebookConversation('trace_load_more')}
                  </button>
                </div>
              )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
