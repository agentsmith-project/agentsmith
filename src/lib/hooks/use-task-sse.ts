/**
 * Task SSE Hook
 *
 * Hook for managing Server-Sent Events (SSE) connection for real-time Task updates.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { TaskAPI } from '@/lib/api';
import type { TaskMessage, Artifact, Task } from '@/lib/types/task';
import { getApiClient } from '@/lib/api';
import { createAuthenticatedSSE } from '@/lib/api/sse-client';

export interface TaskSSEEvent {
  type: 'message' | 'artifact' | 'task_update' | 'error';
  data: TaskMessage | Artifact | Task | { message: string; code?: string };
}

export interface UseTaskSSEOptions {
  onMessage?: (message: TaskMessage) => void;
  onArtifact?: (artifact: Artifact) => void;
  onTaskUpdate?: (task: Task) => void;
  onError?: (error: Error) => void;
  enabled?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * Stable refs to prevent callback dependencies from causing reconnections
 */
interface CallbackRefs {
  onMessage?: UseTaskSSEOptions['onMessage'];
  onArtifact?: UseTaskSSEOptions['onArtifact'];
  onTaskUpdate?: UseTaskSSEOptions['onTaskUpdate'];
  onError?: UseTaskSSEOptions['onError'];
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
    onError,
    enabled = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
  >('disconnected');
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  // Store callbacks in refs to prevent them from causing reconnection cycles
  const callbacksRef = useRef<CallbackRefs>({
    onMessage,
    onArtifact,
    onTaskUpdate,
    onError,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onMessage,
      onArtifact,
      onTaskUpdate,
      onError,
    };
  }, [onMessage, onArtifact, onTaskUpdate, onError]);

  const connect = useCallback(() => {
    if (!enabled || !workspaceId || !projectId || !taskId) {
      return;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const client = getApiClient();
    const taskAPI = new TaskAPI(client);
    const sseUrl = taskAPI.getSSEUrl(workspaceId, projectId, taskId);

    // Add Last-Event-ID for reconnection
    const urlWithLastEventId = lastEventIdRef.current
      ? `${sseUrl}${sseUrl.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastEventIdRef.current)}`
      : sseUrl;

    setConnectionStatus('connecting');

    // Use createAuthenticatedSSE for unified auth (adds ?ticket= param)
    const token = client.getToken();
    const eventSource = createAuthenticatedSSE(urlWithLastEventId, token);

    eventSource.onopen = () => {
      setConnectionStatus('connected');
      reconnectAttemptsRef.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TaskSSEEvent;

        // Store last event ID for reconnection
        if (event.lastEventId) {
          lastEventIdRef.current = event.lastEventId;
        }

        switch (data.type) {
          case 'message':
            callbacksRef.current.onMessage?.(data.data as TaskMessage);
            break;
          case 'artifact':
            callbacksRef.current.onArtifact?.(data.data as Artifact);
            break;
          case 'task_update':
            callbacksRef.current.onTaskUpdate?.(data.data as Task);
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
        callbacksRef.current.onError?.(
          err instanceof Error ? err : new Error('Failed to parse SSE event')
        );
      }
    };

    eventSource.onerror = (_error) => {
      // Check the EventSource readyState to determine the nature of the error
      // readyState values: 0=CONNECTING, 1=OPEN, 2=CLOSED
      const readyState = eventSource.readyState;

      // Only log if there's a real error, not just a normal reconnection
      if (readyState === EventSource.CLOSED) {
        console.warn('SSE connection closed, will attempt reconnect');
      }

      // Close the connection to clean up
      eventSource.close();
      eventSourceRef.current = null;

      // Attempt to reconnect if we haven't exceeded max attempts
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        setConnectionStatus('reconnecting');
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      } else {
        setConnectionStatus('error');
        callbacksRef.current.onError?.(
          new Error(`SSE connection failed after ${maxReconnectAttempts} reconnection attempts`)
        );
      }
    };

    eventSourceRef.current = eventSource;
  }, [enabled, workspaceId, projectId, taskId, reconnectInterval, maxReconnectAttempts]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnectionStatus('disconnected');
      reconnectAttemptsRef.current = 0;
    };
  }, [enabled, connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnectionStatus('disconnected');
    reconnectAttemptsRef.current = 0;
  }, []);

  return {
    connectionStatus,
    connect,
    disconnect,
  };
}
