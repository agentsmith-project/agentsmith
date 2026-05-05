/**
 * Task SSE Hook
 *
 * Hook for managing Server-Sent Events (SSE) connection for real-time Task updates.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { TaskAPI, API_BASE, getApiClient } from '@/lib/api';
import type { TaskActivityItem, Artifact, Task, TaskTraceEvent } from '@/lib/types/task';
import { createAuthenticatedSSEAsync } from '@/lib/api/sse-client';

export type TaskSSEEvent =
  | { type: 'activity_item'; data: TaskActivityItem }
  | { type: 'artifact'; data: Artifact }
  | { type: 'task_update'; data: Task }
  | { type: 'trace_event'; data: TaskTraceEvent }
  | { type: 'error'; data: { message: string; code?: string } }
  | { type: 'ping'; data?: unknown };

export interface TaskSSEDebugEvent {
  at: string;
  phase:
    | 'connect_start'
    | 'open'
    | 'message'
    | 'heartbeat'
    | 'parse_error'
    | 'sse_error'
    | 'reconnect_scheduled'
    | 'reconnect_exhausted'
    | 'ticket_error'
    | 'disconnect'
    | 'trace_gap_fill_start'
    | 'trace_gap_fill_done'
    | 'trace_gap_fill_error'
    | 'trace_reconcile_start'
    | 'trace_reconcile_done'
    | 'trace_reconcile_error';
  summary: string;
}

export interface UseTaskSSEOptions {
  onMessage?: (message: TaskActivityItem) => void;
  onArtifact?: (artifact: Artifact) => void;
  onTaskUpdate?: (task: Task) => void;
  onTraceEvent?: (event: TaskTraceEvent) => void;
  onError?: (error: Error) => void;
  onDebug?: (event: TaskSSEDebugEvent) => void;
  enabled?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  watchdogEnabled?: boolean;
  watchdogTimeoutMs?: number;
}

/**
 * Stable refs to prevent callback dependencies from causing reconnections
 */
interface CallbackRefs {
  onMessage?: UseTaskSSEOptions['onMessage'];
  onArtifact?: UseTaskSSEOptions['onArtifact'];
  onTaskUpdate?: UseTaskSSEOptions['onTaskUpdate'];
  onTraceEvent?: UseTaskSSEOptions['onTraceEvent'];
  onError?: UseTaskSSEOptions['onError'];
  onDebug?: UseTaskSSEOptions['onDebug'];
}

export function useTaskSSE(
  workspaceId: string,
  projectId: string,
  taskId: string,
  options: UseTaskSSEOptions = {},
) {
  const {
    onMessage,
    onArtifact,
    onTaskUpdate,
    onTraceEvent,
    onError,
    onDebug,
    enabled = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
    watchdogEnabled = false,
    watchdogTimeoutMs = 20000,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
  >('disconnected');
  const [connectionErrorCode, setConnectionErrorCode] = useState<string | null>(null);
  const [connectionErrorMessage, setConnectionErrorMessage] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const watchdogTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const hasOpenedRef = useRef(false);
  const connectionIdRef = useRef(0);

  // Store callbacks in refs to prevent them from causing reconnection cycles
  const callbacksRef = useRef<CallbackRefs>({
    onMessage,
    onArtifact,
    onTaskUpdate,
    onTraceEvent,
    onError,
    onDebug,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onMessage,
      onArtifact,
      onTaskUpdate,
      onTraceEvent,
      onError,
      onDebug,
    };
  }, [onMessage, onArtifact, onTaskUpdate, onTraceEvent, onError, onDebug]);

  const emitDebug = useCallback((event: Omit<TaskSSEDebugEvent, 'at'>) => {
    callbacksRef.current.onDebug?.({
      at: new Date().toISOString(),
      ...event,
    });
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimeoutRef.current) {
      clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
  }, []);

  const handleStreamFailure = useCallback((eventSource: EventSource, summary: string) => {
    if (eventSourceRef.current !== eventSource) {
      eventSource.close();
      return;
    }

    clearWatchdog();
    const readyState = eventSource.readyState;
    emitDebug({ phase: 'sse_error', summary });
    if (readyState === EventSource.CLOSED) {
      console.warn('SSE connection closed, will attempt reconnect');
    }
    eventSource.close();
    eventSourceRef.current = null;
    if (reconnectAttemptsRef.current < maxReconnectAttempts) {
      setConnectionStatus('reconnecting');
      reconnectAttemptsRef.current += 1;
      emitDebug({
        phase: 'reconnect_scheduled',
        summary: `attempt=${reconnectAttemptsRef.current}/${maxReconnectAttempts}`,
      });
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, reconnectInterval);
    } else {
      const exhaustedCode = !hasOpenedRef.current && !lastEventIdRef.current
        ? 'TASK_EVENTS_STREAM_UNAVAILABLE'
        : lastEventIdRef.current
          ? 'TASK_EVENTS_RECOVERY_EXHAUSTED'
          : 'TASK_EVENTS_STREAM_INTERRUPTED';
      setConnectionStatus('error');
      setConnectionErrorCode(exhaustedCode);
      setConnectionErrorMessage(`SSE connection failed after ${maxReconnectAttempts} reconnection attempts`);
      emitDebug({ phase: 'reconnect_exhausted', summary: `max=${maxReconnectAttempts}` });
      callbacksRef.current.onError?.(
        Object.assign(
          new Error(`SSE connection failed after ${maxReconnectAttempts} reconnection attempts`),
          { code: exhaustedCode },
        ),
      );
    }
  }, [clearWatchdog, emitDebug, maxReconnectAttempts, reconnectInterval]);

  const scheduleWatchdog = useCallback((eventSource: EventSource) => {
    clearWatchdog();
    if (!watchdogEnabled) return;
    watchdogTimeoutRef.current = setTimeout(() => {
      handleStreamFailure(
        eventSource,
        `watchdog_timeout_ms=${watchdogTimeoutMs} ready_state=${eventSource.readyState}`,
      );
    }, watchdogTimeoutMs);
  }, [clearWatchdog, handleStreamFailure, watchdogEnabled, watchdogTimeoutMs]);

  const handleHeartbeat = useCallback((eventSource: EventSource, eventName: string) => {
    emitDebug({ phase: 'heartbeat', summary: `event=${eventName}` });
    scheduleWatchdog(eventSource);
  }, [emitDebug, scheduleWatchdog]);

  const connect = useCallback(() => {
    if (!enabled || !workspaceId || !projectId || !taskId) {
      return;
    }

    clearWatchdog();
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      const previousEventSource = eventSourceRef.current;
      eventSourceRef.current = null;
      previousEventSource.close();
    }

    const client = getApiClient();
    const taskAPI = new TaskAPI(client);
    const sseUrl = taskAPI.getSSEUrl(workspaceId, projectId, taskId);

    // Add Last-Event-ID for reconnection
    const urlWithLastEventId = lastEventIdRef.current
      ? `${sseUrl}${sseUrl.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastEventIdRef.current)}`
      : sseUrl;

    setConnectionStatus('connecting');
    setConnectionErrorCode(null);
    setConnectionErrorMessage(null);
    if (!lastEventIdRef.current) {
      hasOpenedRef.current = false;
    }
    emitDebug({ phase: 'connect_start', summary: `connecting task=${taskId}` });

    void (async () => {
      try {
        if (lastEventIdRef.current) {
          emitDebug({
            phase: 'trace_gap_fill_start',
            summary: `last_event_id=${lastEventIdRef.current}`,
          });
        }
        const eventSource = await createAuthenticatedSSEAsync(
          urlWithLastEventId,
          client.getToken(),
          undefined,
          API_BASE,
        );

        if (connectionIdRef.current !== connectionId) {
          eventSource.close();
          return;
        }

        eventSourceRef.current = eventSource;
        const isCurrentEventSource = () =>
          connectionIdRef.current === connectionId && eventSourceRef.current === eventSource;

        eventSource.onopen = () => {
          if (!isCurrentEventSource()) return;
          setConnectionStatus('connected');
          setConnectionErrorCode(null);
          setConnectionErrorMessage(null);
          hasOpenedRef.current = true;
          reconnectAttemptsRef.current = 0;
          emitDebug({ phase: 'open', summary: 'sse_open' });
          scheduleWatchdog(eventSource);
          if (lastEventIdRef.current) {
            emitDebug({
              phase: 'trace_gap_fill_done',
              summary: `last_event_id=${lastEventIdRef.current}`,
            });
          }
        };

        eventSource.addEventListener('ping', () => {
          if (!isCurrentEventSource()) return;
          handleHeartbeat(eventSource, 'ping');
        });

        eventSource.onmessage = (event) => {
          if (!isCurrentEventSource()) return;
          try {
            const data = JSON.parse(event.data) as TaskSSEEvent;
            if (data.type === 'ping') {
              handleHeartbeat(eventSource, 'ping');
              return;
            }

            emitDebug({ phase: 'message', summary: `type=${data.type}` });
            scheduleWatchdog(eventSource);

            // Store last event ID for reconnection
            if (event.lastEventId) {
              lastEventIdRef.current = event.lastEventId;
            }

            switch (data.type) {
              case 'activity_item':
                callbacksRef.current.onMessage?.(data.data as TaskActivityItem);
                break;
              case 'artifact':
                callbacksRef.current.onArtifact?.(data.data as Artifact);
                break;
              case 'task_update':
                callbacksRef.current.onTaskUpdate?.(data.data as Task);
                break;
              case 'trace_event':
                callbacksRef.current.onTraceEvent?.(data.data as TaskTraceEvent);
                break;
              case 'error':
                const errorData = data.data as { message: string; code?: string };
                const error = new Error(errorData.message);
                if (errorData.code) {
                  (error as Error & { code?: string }).code = errorData.code;
                }
                callbacksRef.current.onError?.(error);
                break;
            }
          } catch (err) {
            console.error('Failed to parse SSE event:', err);
            emitDebug({ phase: 'parse_error', summary: 'failed_to_parse_sse_event' });
            callbacksRef.current.onError?.(
              err instanceof Error ? err : new Error('Failed to parse SSE event')
            );
          }
        };

        eventSource.onerror = (_error) => {
          if (!isCurrentEventSource()) {
            eventSource.close();
            return;
          }
          handleStreamFailure(eventSource, `ready_state=${eventSource.readyState}`);
        };
      } catch (err) {
        if (connectionIdRef.current !== connectionId) {
          return;
        }

        setConnectionStatus('error');
        const message = err instanceof Error ? err.message : 'SSE connection failed';
        const code = typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'SSE_TICKET_OR_CONNECT_FAILED';
        setConnectionErrorCode(code);
        setConnectionErrorMessage(message);
        emitDebug({ phase: 'ticket_error', summary: `code=${code}` });
        if (lastEventIdRef.current) {
          emitDebug({
            phase: 'trace_gap_fill_error',
            summary: `last_event_id=${lastEventIdRef.current}`,
          });
        }
        callbacksRef.current.onError?.(err instanceof Error ? err : new Error('SSE connection failed'));
      }
    })();
  }, [
    clearWatchdog,
    enabled,
    workspaceId,
    projectId,
    taskId,
    emitDebug,
    handleHeartbeat,
    handleStreamFailure,
    scheduleWatchdog,
  ]);

  connectRef.current = connect;

  useEffect(() => {
    if (!watchdogEnabled) {
      clearWatchdog();
      return;
    }
    if (connectionStatus !== 'connected' || !eventSourceRef.current) return;
    scheduleWatchdog(eventSourceRef.current);
  }, [clearWatchdog, connectionStatus, scheduleWatchdog, watchdogEnabled]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      connectionIdRef.current += 1;
      clearWatchdog();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnectionStatus('disconnected');
      reconnectAttemptsRef.current = 0;
    };
  }, [clearWatchdog, enabled, connect]);

  const disconnect = useCallback(() => {
    connectionIdRef.current += 1;
    clearWatchdog();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnectionStatus('disconnected');
    reconnectAttemptsRef.current = 0;
    setConnectionErrorCode(null);
    setConnectionErrorMessage(null);
    hasOpenedRef.current = false;
    emitDebug({ phase: 'disconnect', summary: 'manual_disconnect' });
  }, [clearWatchdog, emitDebug]);

  return {
    connectionStatus,
    connectionErrorCode,
    connectionErrorMessage,
    connect,
    disconnect,
  };
}
