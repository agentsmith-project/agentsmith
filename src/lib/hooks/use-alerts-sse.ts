/**
 * Real-time Alert SSE Hook (Epic C2 SSE Integration)
 *
 * Subscribes to server-sent alert notifications and updates the alertStore.
 * Uses ticket-based authentication from Epic B1.
 *
 * @module lib/hooks/use-alerts-sse
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAlertStore } from '@/lib/stores/alertStore';
import { createAuthenticatedSSEAsync } from '@/lib/api/sse-client';
import type { Alert, InAppAlertType } from '@/lib/types/alerts';

/**
 * SSE Alert Message Format
 *
 * Server sends alerts in this format over SSE:
 * event: alert
 * data: { "id": "...", "type": "quota.warning", ... }
 */
interface SSEAlertMessage {
  id: string;
  workspace_id: string;
  project_id: string;
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  resource_type?: string;
  resource_id?: string;
  resource_name?: string;
  metadata: Record<string, unknown>;
  actions?: Array<{ label: string; url?: string; primary?: boolean }>;
  created_at: string;
  expires_at?: string;
}

/**
 * Options for the alert SSE subscription
 */
export interface UseAlertsSSEOptions {
  /** Whether to enable SSE subscription (default: true) */
  enabled?: boolean;
  /** Callback when alert is received */
  onAlert?: (alert: Alert) => void;
  /** Callback when connection is established */
  onConnect?: () => void;
  /** Callback when connection is closed */
  onDisconnect?: () => void;
  /** Callback when connection errors */
  onError?: (error: Error) => void;
}

/**
 * Subscribe to real-time alert notifications via SSE
 *
 * @example
 * function AlertCenter() {
 *   useAlertsSSE({ enabled: true });
 *   const { alerts, unreadCount } = useAlertStore();
 *   ...
 * }
 */
export function useAlertsSSE(options: UseAlertsSSEOptions = {}) {
  const {
    enabled = true,
    onAlert,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const [connected, setConnected] = useState(false);
  const addAlert = useAlertStore((state) => state.addAlert);

  /**
   * Parse SSE alert data and add to store
   */
  const handleAlertMessage = useCallback((data: string) => {
    try {
      const parsed: SSEAlertMessage = JSON.parse(data);

      // Convert to Alert type (status defaults to 'unread')
      // Cast type to InAppAlertType assuming server sends valid types
      const alert: Alert = {
        ...parsed,
        type: parsed.type as InAppAlertType,
        status: 'unread',
      };

      // Add to store (will check preferences)
      addAlert(alert);

      // Call custom callback
      onAlert?.(alert);
    } catch (error) {
      console.error('[useAlertsSSE] Failed to parse alert:', error);
    }
  }, [addAlert, onAlert]);

  /**
   * Establish SSE connection for alert stream
   */
  const connect = useCallback(async () => {
    if (!enabled) {
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      // Get auth token from store
      // Note: This assumes the auth store has a token
      const token = typeof window !== 'undefined'
        ? (window as unknown as { __AUTH_TOKEN__?: string }).__AUTH_TOKEN__
        : null;

      if (!token) {
        console.warn('[useAlertsSSE] No auth token available');
        setConnected(false);
        onError?.(new Error('No auth token available'));
        return;
      }

      // Create SSE connection using ticket-based auth (Epic B1)
      const eventSource = await createAuthenticatedSSEAsync(
        '/api/v1/alerts/stream', // TODO: Verify backend endpoint
        token,
        undefined,
        process.env.NEXT_PUBLIC_API_BASE || ''
      );

      // Set up event handlers
      eventSource.addEventListener('alert', (event: MessageEvent) => {
        handleAlertMessage(event.data);
      });

      eventSource.addEventListener('error', (event: Event) => {
        console.error('[useAlertsSSE] SSE error:', event);
        setConnected(false);
        onError?.(new Error('SSE connection error'));
      });

      eventSourceRef.current = eventSource;
      setConnected(true);
      onConnect?.();

    } catch (error) {
      console.error('[useAlertsSSE] Failed to connect:', error);
      setConnected(false);
      onError?.(error as Error);
    }
  }, [enabled, handleAlertMessage, onConnect, onError]);

  /**
   * Close SSE connection
   */
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setConnected(false);
      onDisconnect?.();
    }
  }, [onDisconnect]);

  /**
   * Reconnect to SSE (useful after token refresh)
   */
  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);

  // Auto-connect on mount and disconnect on unmount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connected,
    connect,
    disconnect,
    reconnect,
  };
}

/**
 * Hook for subscribing to project-specific alerts
 *
 * @param projectId - Project ID to filter alerts for
 * @param options - Additional options
 */
export function useProjectAlertsSSE(
  projectId: string | undefined,
  options: Omit<UseAlertsSSEOptions, 'onConnect' | 'onDisconnect' | 'onError'> = {}
) {
  const onConnect = useCallback(() => {
    console.log(`[useProjectAlertsSSE] Connected to project ${projectId} alerts`);
  }, [projectId]);

  const onError = useCallback((error: Error) => {
    console.error(`[useProjectAlertsSSE] Project ${projectId} alert stream error:`, error);
  }, [projectId]);

  return useAlertsSSE({
    ...options,
    enabled: !!projectId && (options.enabled !== false),
    onConnect,
    onError,
  });
}

/**
 * Hook for subscribing to workspace alerts (all projects)
 *
 * @param workspaceId - Workspace ID
 * @param options - Additional options
 */
export function useWorkspaceAlertsSSE(
  workspaceId: string | undefined,
  options: Omit<UseAlertsSSEOptions, 'onConnect' | 'onDisconnect' | 'onError'> = {}
) {
  const onConnect = useCallback(() => {
    console.log(`[useWorkspaceAlertsSSE] Connected to workspace ${workspaceId} alerts`);
  }, [workspaceId]);

  const onError = useCallback((error: Error) => {
    console.error(`[useWorkspaceAlertsSSE] Workspace ${workspaceId} alert stream error:`, error);
  }, [workspaceId]);

  return useAlertsSSE({
    ...options,
    enabled: !!workspaceId && (options.enabled !== false),
    onConnect,
    onError,
  });
}
