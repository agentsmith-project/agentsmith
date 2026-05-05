'use client';

import * as React from 'react';
import type { TaskAPI } from '@/lib/api';
import type { TaskActivityItem, TaskTraceEvent } from '@/lib/types/task';
import {
  mapTraceHasMoreByMessageId,
  pruneTaskTraceMeta,
  upsertTaskTraceMeta,
  type TaskTraceMetaByMessageId,
} from '@/lib/utils/task-trace-meta';
import { classifyAgentTaskTraceFailure, type AgentTaskTraceFailureKind } from '@/lib/build-failure-explainability';
import type { TaskSSEDebugEvent } from '@/lib/hooks/use-task-sse';

export function useTaskTraceState(args: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  messages?: TaskActivityItem[];
  taskAPI: TaskAPI;
  handleError: (error: unknown, options?: { logContext?: string; showToast?: boolean }) => void;
}) {
  const { workspaceId, projectId, taskId, messages, taskAPI, handleError } = args;

  const [traceFocusMessageId, setTraceFocusMessageId] = React.useState<string | null>(null);
  const [traceFocusName, setTraceFocusName] = React.useState<string | null>(null);
  const [traceFocusToken, setTraceFocusToken] = React.useState(0);
  const [traceEventsByMessageId, setTraceEventsByMessageId] = React.useState<Record<string, TaskTraceEvent[]>>({});
  const [traceMetaByMessageId, setTraceMetaByMessageId] = React.useState<TaskTraceMetaByMessageId>({});
  const [traceLoadingByMessageId, setTraceLoadingByMessageId] = React.useState<Record<string, boolean>>({});
  const [traceLoadMoreLoadingByMessageId, setTraceLoadMoreLoadingByMessageId] = React.useState<Record<string, boolean>>({});
  const [traceErrorByMessageId, setTraceErrorByMessageId] = React.useState<Record<string, { kind: AgentTaskTraceFailureKind; message: string }>>({});
  const [sseDebugEvents, setSseDebugEvents] = React.useState<TaskSSEDebugEvent[]>([]);
  const [traceBackfillRefreshNonce, setTraceBackfillRefreshNonce] = React.useState(0);

  const traceBackfillRequestedMessageIdsRef = React.useRef<Set<string>>(new Set());
  const lastTraceEventIdRef = React.useRef<string | null>(null);
  const syntheticTraceSeqRef = React.useRef(1_000_000);

  const mergeTraceEvents = React.useCallback((items: TaskTraceEvent[]) => {
    if (items.length === 0) return;
    setTraceEventsByMessageId((prev) => {
      let changed = false;
      const next: Record<string, TaskTraceEvent[]> = { ...prev };
      for (const evt of items) {
        const arr = next[evt.message_id] ?? [];
        if (arr.some((item) => item.id === evt.id)) continue;
        next[evt.message_id] = [...arr, evt];
        changed = true;
      }
      const latest = items[items.length - 1];
      if (latest?.id) {
        lastTraceEventIdRef.current = latest.id;
      }
      return changed ? next : prev;
    });
  }, []);

  const appendSseDebugEvent = React.useCallback((event: TaskSSEDebugEvent, activeTraceMessageId?: string | null) => {
    setSseDebugEvents((prev) => [...prev.slice(-4), event]);

    const targetMessageId = activeTraceMessageId ?? null;
    if (!targetMessageId) return;

    const buildTransportTraceEvent = (
      transportKind: 'gap_fill' | 'reconcile',
      transportPhase: 'start' | 'done' | 'error',
    ): TaskTraceEvent => ({
      id: `transport:${transportKind}:${transportPhase}:${event.at}:${targetMessageId}`,
      task_id: taskId,
      message_id: targetMessageId,
      run_id: 'transport',
      seq: syntheticTraceSeqRef.current++,
      at: event.at,
      category: 'debug',
      phase: transportPhase === 'start' ? 'start' : 'end',
      status:
        transportPhase === 'start'
          ? 'running'
          : transportPhase === 'done'
            ? 'success'
            : 'error',
      name: `transport.${transportKind}`,
      summary: event.summary,
      details: {
        transport_kind: transportKind,
        transport_phase: transportPhase,
        debug_phase: event.phase,
      },
    });

    if (event.phase === 'trace_gap_fill_start') {
      mergeTraceEvents([buildTransportTraceEvent('gap_fill', 'start')]);
    } else if (event.phase === 'trace_gap_fill_done') {
      mergeTraceEvents([buildTransportTraceEvent('gap_fill', 'done')]);
    } else if (event.phase === 'trace_gap_fill_error') {
      mergeTraceEvents([buildTransportTraceEvent('gap_fill', 'error')]);
    } else if (event.phase === 'trace_reconcile_start') {
      mergeTraceEvents([buildTransportTraceEvent('reconcile', 'start')]);
    } else if (event.phase === 'trace_reconcile_done') {
      mergeTraceEvents([buildTransportTraceEvent('reconcile', 'done')]);
    } else if (event.phase === 'trace_reconcile_error') {
      mergeTraceEvents([buildTransportTraceEvent('reconcile', 'error')]);
    }
  }, [mergeTraceEvents, taskId]);

  const fetchTracesForMessage = React.useCallback(async (messageId: string) => {
    if (!messageId) return;
    if (traceBackfillRequestedMessageIdsRef.current.has(messageId)) return;
    traceBackfillRequestedMessageIdsRef.current.add(messageId);
    setTraceLoadingByMessageId((prev) => ({ ...prev, [messageId]: true }));
    try {
      const resp = await taskAPI.listTraces(workspaceId, projectId, taskId, {
        message_id: messageId,
        page_size: 500,
      });
      mergeTraceEvents(resp.items);
      setTraceMetaByMessageId((prev) => upsertTaskTraceMeta(prev, messageId, resp));
      setTraceErrorByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (err) {
      traceBackfillRequestedMessageIdsRef.current.delete(messageId);
      setTraceErrorByMessageId((prev) => ({
        ...prev,
        [messageId]: {
          kind: classifyAgentTaskTraceFailure(err),
          message: err instanceof Error ? err.message : 'Task trace details could not be loaded.',
        },
      }));
      handleError(err, { logContext: 'TaskPage.traceMessageBackfill' });
    } finally {
      setTraceLoadingByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  }, [handleError, mergeTraceEvents, projectId, taskAPI, taskId, workspaceId]);

  const loadMoreTracesForMessage = React.useCallback(async (messageId: string) => {
    const meta = traceMetaByMessageId[messageId];
    const beforeId = meta?.nextAfterId;
    if (!messageId || !beforeId) return;
    if (traceLoadMoreLoadingByMessageId[messageId]) return;
    setTraceLoadMoreLoadingByMessageId((prev) => ({ ...prev, [messageId]: true }));
    try {
      const resp = await taskAPI.listTraces(workspaceId, projectId, taskId, {
        message_id: messageId,
        before_id: beforeId,
        page_size: 500,
      });
      mergeTraceEvents(resp.items);
      setTraceMetaByMessageId((prev) => upsertTaskTraceMeta(prev, messageId, resp));
      setTraceErrorByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (err) {
      setTraceErrorByMessageId((prev) => ({
        ...prev,
        [messageId]: {
          kind: classifyAgentTaskTraceFailure(err),
          message: err instanceof Error ? err.message : 'Task trace details could not be loaded.',
        },
      }));
      handleError(err, { logContext: 'TaskPage.traceMessageLoadMore' });
    } finally {
      setTraceLoadMoreLoadingByMessageId((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  }, [handleError, mergeTraceEvents, projectId, taskAPI, taskId, traceLoadMoreLoadingByMessageId, traceMetaByMessageId, workspaceId]);

  const resetTraceBackfillState = React.useCallback(() => {
    traceBackfillRequestedMessageIdsRef.current.clear();
    setTraceMetaByMessageId({});
    setTraceLoadingByMessageId({});
    setTraceLoadMoreLoadingByMessageId({});
    setTraceBackfillRefreshNonce((prev) => prev + 1);
  }, []);

  React.useEffect(() => {
    if (!messages || messages.length === 0) return;
    const messageIds = new Set(messages.map((message) => message.id));
    traceBackfillRequestedMessageIdsRef.current = new Set(
      [...traceBackfillRequestedMessageIdsRef.current].filter((id) => messageIds.has(id)),
    );
    setTraceMetaByMessageId((prev) => pruneTaskTraceMeta(prev, messageIds));
    setTraceLoadingByMessageId((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, loading] of Object.entries(prev)) {
        if (!messageIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = loading;
      }
      return changed ? next : prev;
    });
    setTraceLoadMoreLoadingByMessageId((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, loading] of Object.entries(prev)) {
        if (!messageIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = loading;
      }
      return changed ? next : prev;
    });
    setTraceErrorByMessageId((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [id, value] of Object.entries(prev)) {
        if (!messageIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = value;
      }
      return changed ? next : prev;
    });
  }, [messages, traceBackfillRefreshNonce]);

  return {
    traceFocusMessageId,
    setTraceFocusMessageId,
    traceFocusName,
    setTraceFocusName,
    traceFocusToken,
    setTraceFocusToken,
    traceEventsByMessageId,
    traceMetaByMessageId,
    traceLoadingByMessageId,
    traceLoadMoreLoadingByMessageId,
    traceErrorByMessageId,
    sseDebugEvents,
    setTraceBackfillRefreshNonce,
    lastTraceEventIdRef,
    traceBackfillRequestedMessageIdsRef,
    mergeTraceEvents,
    appendSseDebugEvent,
    fetchTracesForMessage,
    loadMoreTracesForMessage,
    resetTraceBackfillState,
    traceHasMoreByMessageId: mapTraceHasMoreByMessageId(traceMetaByMessageId),
  };
}
