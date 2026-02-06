/**
 * Recipe SSE Hook
 *
 * Hook for managing Server-Sent Events (SSE) connection for real-time Recipe updates.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { RecipeAPI } from '@/lib/api';
import type { RecipeMessage, Artifact, Recipe } from '@/lib/types/recipe';
import { getApiClient } from '@/lib/api';
import { createAuthenticatedSSE } from '@/lib/api/sse-client';

export interface RecipeSSEEvent {
  type: 'message' | 'artifact' | 'recipe_update' | 'error';
  data: RecipeMessage | Artifact | Recipe | { message: string; code?: string };
}

export interface UseRecipeSSEOptions {
  onMessage?: (message: RecipeMessage) => void;
  onArtifact?: (artifact: Artifact) => void;
  onRecipeUpdate?: (recipe: Recipe) => void;
  onError?: (error: Error) => void;
  enabled?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * Stable refs to prevent callback dependencies from causing reconnections
 */
interface CallbackRefs {
  onMessage?: UseRecipeSSEOptions['onMessage'];
  onArtifact?: UseRecipeSSEOptions['onArtifact'];
  onRecipeUpdate?: UseRecipeSSEOptions['onRecipeUpdate'];
  onError?: UseRecipeSSEOptions['onError'];
}

export function useRecipeSSE(
  workspaceId: string,
  projectId: string,
  recipeId: string,
  options: UseRecipeSSEOptions = {},
) {
  const {
    onMessage,
    onArtifact,
    onRecipeUpdate,
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
    onRecipeUpdate,
    onError,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onMessage,
      onArtifact,
      onRecipeUpdate,
      onError,
    };
  }, [onMessage, onArtifact, onRecipeUpdate, onError]);

  const connect = useCallback(() => {
    if (!enabled || !workspaceId || !projectId || !recipeId) {
      return;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const client = getApiClient();
    const recipeAPI = new RecipeAPI(client);
    const sseUrl = recipeAPI.getSSEUrl(workspaceId, projectId, recipeId);

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
        const data = JSON.parse(event.data) as RecipeSSEEvent;

        // Store last event ID for reconnection
        if (event.lastEventId) {
          lastEventIdRef.current = event.lastEventId;
        }

        switch (data.type) {
          case 'message':
            callbacksRef.current.onMessage?.(data.data as RecipeMessage);
            break;
          case 'artifact':
            callbacksRef.current.onArtifact?.(data.data as Artifact);
            break;
          case 'recipe_update':
            callbacksRef.current.onRecipeUpdate?.(data.data as Recipe);
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
  }, [enabled, workspaceId, projectId, recipeId, reconnectInterval, maxReconnectAttempts]);

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
