/**
 * Recipe SSE Hook
 *
 * Hook for managing Server-Sent Events (SSE) connection for real-time Recipe updates.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { RecipeAPI } from '@/lib/api';
import type { RecipeMessage, Artifact, Recipe } from '@/lib/types/recipe';
import { getApiClient } from '@/lib/api';

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

  const connect = useCallback(() => {
    if (!enabled || !workspaceId || !projectId || !recipeId) {
      return;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const recipeAPI = new RecipeAPI(getApiClient());
    const sseUrl = recipeAPI.getSSEUrl(workspaceId, projectId, recipeId);

    // Add Last-Event-ID header if available (for reconnection)
    const urlWithLastEventId = lastEventIdRef.current
      ? `${sseUrl}${sseUrl.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastEventIdRef.current)}`
      : sseUrl;

    setConnectionStatus('connecting');
    const eventSource = new EventSource(urlWithLastEventId);

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
            if (onMessage) {
              onMessage(data.data as RecipeMessage);
            }
            break;
          case 'artifact':
            if (onArtifact) {
              onArtifact(data.data as Artifact);
            }
            break;
          case 'recipe_update':
            if (onRecipeUpdate) {
              onRecipeUpdate(data.data as Recipe);
            }
            break;
          case 'error':
            const errorData = data.data as { message: string; code?: string };
            const error = new Error(errorData.message);
            if (errorData.code) {
              (error as Error & { code?: string }).code = errorData.code;
            }
            if (onError) {
              onError(error);
            }
            break;
        }
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
        if (onError) {
          onError(error instanceof Error ? error : new Error('Failed to parse SSE event'));
        }
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      setConnectionStatus('reconnecting');

      // Close the connection
      eventSource.close();
      eventSourceRef.current = null;

      // Attempt to reconnect
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      } else {
        setConnectionStatus('error');
        if (onError) {
          onError(new Error('Max reconnection attempts reached'));
        }
      }
    };

    eventSourceRef.current = eventSource;
  }, [enabled, workspaceId, projectId, recipeId, onMessage, onArtifact, onRecipeUpdate, onError, reconnectInterval, maxReconnectAttempts]);

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
