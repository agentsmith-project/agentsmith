'use client';

import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskAPI } from '@/lib/api/endpoints/tasks';
import type {
  TaskTerminalServerEvent,
  TaskTerminalSessionCreateResponse,
  TaskTerminalSessionStatus,
} from '@/lib/types/task';
import { toast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';
import {
  TASK_TERMINAL_RECONNECT_VIEW,
  decodeTerminalOutputPayload,
  isEditableFocusOwner,
  readTerminalInputEnabled,
  readTerminalOutputPayloadIdentity,
  readTerminalProtocolNumber,
  readTerminalProtocolSessionId,
  readTerminalStateValue,
  terminalEventBelongsToSession,
} from './task-terminal-protocol';

export type TerminalStatus =
  | 'idle'
  | 'preparing'
  | 'recovering'
  | 'connecting'
  | 'active'
  | 'closed'
  | 'failed';

export type TerminalCloseReconcileResult = 'closed' | 'retained' | 'unavailable';

type TerminalProgressReason = 'runner_offline' | 'run_in_progress' | null;

export function getTaskTerminalSessionStorageKey(
  workspaceId: string,
  projectId: string,
  taskId: string,
  scope: string,
): string {
  const baseKey = `agentsmith-terminal-session:${workspaceId}:${projectId}:${taskId}`;
  return scope === 'default' ? baseKey : `${baseKey}:${scope}`;
}

type TerminalSessionHandle = {
  sessionId: string;
  wsUrl: string;
};

type TerminalSessionResolution =
  | {
      kind: 'connectable';
      handle: TerminalSessionHandle;
    }
  | {
      kind: 'awaiting-reconnect';
      sessionId: string;
    }
  | {
      kind: 'failed';
      sessionId: string;
      reason: string | null;
    }
  | {
      kind: 'closed';
      sessionId: string;
      reason: string | null;
    };

const resolvedTerminalSessionHandleCache = new Map<string, TerminalSessionHandle>();
const terminalSessionResolutionCache = new Map<string, Promise<TerminalSessionResolution>>();
const TERMINAL_RECOVERY_RETRY_DELAY_MS = 1000;

function isTerminalSessionLookupMiss(error: unknown): boolean {
  if (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && error.statusCode === 404
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('task_terminal_session_missing')
    || message.includes('terminal_session_missing')
    || message.includes('404')
  );
}

function getResolvedTerminalSessionHandle(sessionStorageKey: string): TerminalSessionHandle | null {
  return resolvedTerminalSessionHandleCache.get(sessionStorageKey) ?? null;
}

function setResolvedTerminalSessionHandle(
  sessionStorageKey: string,
  sessionHandle: TerminalSessionHandle,
): TerminalSessionHandle {
  resolvedTerminalSessionHandleCache.set(sessionStorageKey, sessionHandle);
  return sessionHandle;
}

function getCachedTerminalSessionResolution(
  sessionStorageKey: string,
): Promise<TerminalSessionResolution> | null {
  return terminalSessionResolutionCache.get(sessionStorageKey) ?? null;
}

function setCachedTerminalSessionResolution(
  sessionStorageKey: string,
  sessionResolutionPromise: Promise<TerminalSessionResolution>,
): Promise<TerminalSessionResolution> {
  terminalSessionResolutionCache.set(sessionStorageKey, sessionResolutionPromise);
  return sessionResolutionPromise;
}

function clearCachedTerminalSessionResolution(sessionStorageKey: string) {
  resolvedTerminalSessionHandleCache.delete(sessionStorageKey);
  terminalSessionResolutionCache.delete(sessionStorageKey);
}

export function resetTaskTerminalPanelSessionHandleCacheForTests() {
  resolvedTerminalSessionHandleCache.clear();
  terminalSessionResolutionCache.clear();
}

export function storeTaskTerminalPanelSessionIdForScope(
  workspaceId: string,
  projectId: string,
  taskId: string,
  scope: string,
  sessionId: string,
) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    getTaskTerminalSessionStorageKey(workspaceId, projectId, taskId, scope),
    sessionId,
  );
}

export function clearTaskTerminalPanelSessionStateForScope(
  workspaceId: string,
  projectId: string,
  taskId: string,
  scope: string,
) {
  const sessionStorageKey = getTaskTerminalSessionStorageKey(
    workspaceId,
    projectId,
    taskId,
    scope,
  );
  clearCachedTerminalSessionResolution(sessionStorageKey);
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(sessionStorageKey);
}

function readTerminalSessionId(
  session: TaskTerminalSessionStatus | TaskTerminalSessionCreateResponse,
): string | null {
  if (
    'terminal_session_id' in session
    && typeof session.terminal_session_id === 'string'
    && session.terminal_session_id.length > 0
  ) {
    return session.terminal_session_id;
  }
  return null;
}

function normalizeCreatedTerminalSession(
  session: TaskTerminalSessionCreateResponse,
): TerminalSessionHandle {
  const sessionId = readTerminalSessionId(session);
  const wsUrl = session.ws_url ?? null;
  if (!sessionId || !wsUrl) {
    throw new Error('task_terminal_session_invalid');
  }
  return {
    sessionId,
    wsUrl,
  };
}

function normalizeExistingTerminalSession(
  session: TaskTerminalSessionStatus,
): TerminalSessionHandle {
  if (!session.terminal_session_id || !session.ws_url) {
    throw new Error('task_terminal_session_invalid');
  }
  return {
    sessionId: session.terminal_session_id,
    wsUrl: session.ws_url,
  };
}

function getClosableSessionIdFromResolution(
  resolution: TerminalSessionResolution,
): string {
  switch (resolution.kind) {
    case 'connectable':
      return resolution.handle.sessionId;
    case 'awaiting-reconnect':
    case 'failed':
    case 'closed':
      return resolution.sessionId;
  }
}

function describeTerminalError(t: ReturnType<typeof useTranslations>, reason: string): string {
  if (reason.includes('task_runner_offline')) {
    return t('terminal_error_runner_offline');
  }
  if (reason.includes('task_run_in_progress')) {
    return t('terminal_error_runner_offline');
  }
  if (reason.includes('task_agent_not_available')) {
    return t('terminal_error_agent_unavailable');
  }
  if (reason.includes('invalid_shell')) {
    return t('terminal_error_invalid_shell');
  }
  if (reason.includes('terminal_connection_failed')) {
    return t('terminal_error_connection_failed');
  }
  if (reason.includes('task_terminal_session_limit_reached')) {
    return t('terminal_max_sessions_reached');
  }
  return reason;
}

export interface TaskTerminalPanelProps {
  open: boolean;
  visible?: boolean;
  tabId?: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  sessionStorageScope?: string;
  taskTitle: string;
  taskApi: TaskAPI;
  disabled?: boolean;
  closeRequestToken?: number;
  focusRequestToken?: number;
  onOpenChange: (open: boolean) => void;
  onSessionResolved?: (sessionId: string) => void;
  onStatusChange?: (status: TerminalStatus) => void;
  onSessionCreateRejected?: () => void | Promise<void>;
  onSessionCloseReconcile?: (
    sessionId: string | null,
  ) => TerminalCloseReconcileResult | Promise<TerminalCloseReconcileResult>;
}

export function TaskTerminalPanel({
  open,
  visible = open,
  tabId,
  workspaceId,
  projectId,
  taskId,
  sessionStorageScope = 'default',
  taskApi,
  disabled = false,
  closeRequestToken = 0,
  focusRequestToken = 0,
  onOpenChange,
  onSessionResolved,
  onStatusChange,
  onSessionCreateRejected,
  onSessionCloseReconcile,
}: TaskTerminalPanelProps) {
  const t = useTranslations('agent_tasks.task');
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);
  const resizeHandlerRef = React.useRef<(() => void) | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const handshakeReadyRef = React.useRef(false);
  const lastAppliedSeqBySessionRef = React.useRef<Map<string, number>>(new Map());
  const acceptedSeqBoundaryBySessionRef = React.useRef<Map<string, number>>(new Map());
  const expectedNextSeqBySessionRef = React.useRef<Map<string, number>>(new Map());
  const appliedPayloadsBySessionRef = React.useRef<Map<string, Map<number, string>>>(new Map());
  const terminalOutputDecodersBySessionRef = React.useRef<Map<string, TextDecoder>>(new Map());
  const [status, setStatus] = React.useState<TerminalStatus>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [degradationMessage, setDegradationMessage] = React.useState<string | null>(null);
  const [progressReason, setProgressReason] = React.useState<TerminalProgressReason>(null);
  const statusRef = React.useRef<TerminalStatus>('idle');
  const explicitCloseRequestedRef = React.useRef(false);
  const reconnectingRef = React.useRef(false);
  const fitFrameRef = React.useRef<number | null>(null);
  const closeRequestTokenRef = React.useRef(closeRequestToken);
  const focusRequestTokenRef = React.useRef(0);
  const visibleRef = React.useRef(visible);
  const pendingTerminalFocusRef = React.useRef(false);
  const pendingResolutionCloseRef = React.useRef(false);
  const pendingTransportReconnectRef = React.useRef(false);
  const authoritativeCloseInFlightRef = React.useRef(false);
  const suppressResolvedConnectionAfterCloseRef = React.useRef(false);
  const unmountingRef = React.useRef(false);
  const [hasInteractiveMount, setHasInteractiveMount] = React.useState(open && visible);
  const [connectionRetryToken, setConnectionRetryToken] = React.useState(0);
  const sessionResolutionPromiseRef =
    React.useRef<Promise<TerminalSessionResolution> | null>(null);
  const translationRef = React.useRef(t);
  const onOpenChangeRef = React.useRef(onOpenChange);
  const onSessionResolvedRef = React.useRef(onSessionResolved);
  const onStatusChangeRef = React.useRef(onStatusChange);
  const onSessionCreateRejectedRef = React.useRef(onSessionCreateRejected);
  const onSessionCloseReconcileRef = React.useRef(onSessionCloseReconcile);
  const sessionStorageKey = React.useMemo(
    () => getTaskTerminalSessionStorageKey(workspaceId, projectId, taskId, sessionStorageScope),
    [projectId, sessionStorageScope, taskId, workspaceId],
  );

  React.useEffect(() => {
    translationRef.current = t;
  }, [t]);

  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  React.useEffect(() => {
    onSessionResolvedRef.current = onSessionResolved;
  }, [onSessionResolved]);

  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  React.useEffect(() => {
    onSessionCreateRejectedRef.current = onSessionCreateRejected;
  }, [onSessionCreateRejected]);

  React.useEffect(() => {
    onSessionCloseReconcileRef.current = onSessionCloseReconcile;
  }, [onSessionCloseReconcile]);

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const updateStatus = React.useCallback((nextStatus: TerminalStatus) => {
    if (statusRef.current !== nextStatus) {
      statusRef.current = nextStatus;
      onStatusChangeRef.current?.(nextStatus);
    }
    setStatus(nextStatus);
  }, []);

  React.useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
    };
  }, []);

  React.useEffect(() => {
    if (!open) {
      setHasInteractiveMount(false);
      return;
    }
    if (visible) {
      setHasInteractiveMount(true);
    }
  }, [open, visible]);

  React.useEffect(() => {
    visibleRef.current = visible;
    if (!visible) {
      pendingTerminalFocusRef.current = false;
    }
  }, [visible]);

  const readStoredSessionId = React.useCallback(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(sessionStorageKey);
  }, [sessionStorageKey]);

  const storeSessionId = React.useCallback((sessionId: string) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(sessionStorageKey, sessionId);
  }, [sessionStorageKey]);

  const clearStoredSessionId = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(sessionStorageKey);
  }, [sessionStorageKey]);

  const persistResolvedSessionHandle = React.useCallback((sessionHandle: TerminalSessionHandle) => {
    setResolvedTerminalSessionHandle(sessionStorageKey, sessionHandle);
    if (!pendingResolutionCloseRef.current) {
      storeSessionId(sessionHandle.sessionId);
      onSessionResolvedRef.current?.(sessionHandle.sessionId);
    }
  }, [sessionStorageKey, storeSessionId]);

  const invalidateSessionHandle = React.useCallback(
    ({ clearStored = false }: { clearStored?: boolean } = {}) => {
      pendingTransportReconnectRef.current = false;
      clearCachedTerminalSessionResolution(sessionStorageKey);
      sessionResolutionPromiseRef.current = null;
      if (clearStored) {
        clearStoredSessionId();
      }
    },
    [clearStoredSessionId, sessionStorageKey],
  );

  const finalizeClosedSession = React.useCallback(() => {
    authoritativeCloseInFlightRef.current = false;
    suppressResolvedConnectionAfterCloseRef.current = false;
    pendingTransportReconnectRef.current = false;
    reconnectingRef.current = false;
    terminalOutputDecodersBySessionRef.current.clear();
    setErrorMessage(null);
    setDegradationMessage(null);
    setProgressReason(null);
    invalidateSessionHandle({ clearStored: true });
    updateStatus('closed');
  }, [invalidateSessionHandle, updateStatus]);

  const markAuthoritativeCloseFailed = React.useCallback((error: unknown, sessionId: string | null) => {
    authoritativeCloseInFlightRef.current = false;
    explicitCloseRequestedRef.current = false;
    pendingResolutionCloseRef.current = false;
    reconnectingRef.current = false;
    invalidateSessionHandle();
    if (sessionId) {
      storeSessionId(sessionId);
      onSessionResolvedRef.current?.(sessionId);
    }
    const message = error instanceof Error ? error.message : 'task_terminal_session_close_failed';
    const friendlyReason = describeTerminalError(translationRef.current, message);
    updateStatus('failed');
    setErrorMessage(friendlyReason);
    setDegradationMessage(null);
    setProgressReason(null);
    toast.error(friendlyReason);
  }, [invalidateSessionHandle, storeSessionId, updateStatus]);

  const restoreSessionAfterUnconfirmedClose = React.useCallback(
    (
      sessionId: string | null,
      result: Exclude<TerminalCloseReconcileResult, 'closed'>,
    ) => {
      authoritativeCloseInFlightRef.current = false;
      explicitCloseRequestedRef.current = false;
      pendingResolutionCloseRef.current = false;
      suppressResolvedConnectionAfterCloseRef.current = false;
      pendingTransportReconnectRef.current = false;
      reconnectingRef.current = Boolean(sessionId);
      invalidateSessionHandle();
      if (sessionId) {
        storeSessionId(sessionId);
        onSessionResolvedRef.current?.(sessionId);
      }
      setProgressReason(null);
      setDegradationMessage(null);
      if (result === 'retained') {
        setErrorMessage(null);
        updateStatus('recovering');
        setConnectionRetryToken((current) => current + 1);
        return;
      }
      updateStatus(statusRef.current === 'failed' ? 'failed' : 'recovering');
    },
    [invalidateSessionHandle, storeSessionId, updateStatus],
  );

  const reconcileClosedSession = React.useCallback(
    async (sessionId: string | null) => {
      const reconcile = onSessionCloseReconcileRef.current;
      if (!reconcile) {
        finalizeClosedSession();
        onOpenChangeRef.current(false);
        return;
      }
      const result = await reconcile(sessionId);
      if (result === 'retained' || result === 'unavailable') {
        restoreSessionAfterUnconfirmedClose(sessionId, result);
        return;
      }
      finalizeClosedSession();
    },
    [finalizeClosedSession, restoreSessionAfterUnconfirmedClose],
  );

  const createSessionWithRetry = React.useCallback(async () => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        return await taskApi.createTerminalSession(workspaceId, projectId, taskId, {
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 30,
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
        if (message.includes('task_runner_offline')) {
          setProgressReason('runner_offline');
          updateStatus('preparing');
          setErrorMessage(null);
          setDegradationMessage(null);
        } else if (message.includes('task_run_in_progress')) {
          setProgressReason('run_in_progress');
          updateStatus('preparing');
          setErrorMessage(null);
          setDegradationMessage(null);
        } else {
          throw error;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('task_runner_offline');
  }, [projectId, taskApi, taskId, updateStatus, workspaceId]);

  const resolveSession = React.useCallback(async (): Promise<TerminalSessionResolution> => {
    if (sessionResolutionPromiseRef.current) {
      return sessionResolutionPromiseRef.current;
    }

    const resolvedHandle = getResolvedTerminalSessionHandle(sessionStorageKey);
    if (resolvedHandle) {
      return {
        kind: 'connectable',
        handle: resolvedHandle,
      };
    }

    const cachedSessionResolution = getCachedTerminalSessionResolution(sessionStorageKey);
    if (cachedSessionResolution) {
      sessionResolutionPromiseRef.current = cachedSessionResolution;
      return cachedSessionResolution;
    }

    const sessionPromise = (async (): Promise<TerminalSessionResolution> => {
      const storedSessionId = readStoredSessionId();
      if (storedSessionId) {
        try {
          const session = await taskApi.getTerminalSession(workspaceId, projectId, taskId, storedSessionId);
          onSessionResolvedRef.current?.(storedSessionId);
          if (
            session.status === 'pending'
            || session.status === 'active'
            || session.status === 'disconnected'
          ) {
            const sessionId = readTerminalSessionId(session) ?? storedSessionId;
            if (!sessionId) {
              throw new Error('task_terminal_session_invalid');
            }
            if (!session.ws_url) {
              reconnectingRef.current = true;
              return {
                kind: 'awaiting-reconnect',
                sessionId,
              };
            }
            const normalizedSession = normalizeExistingTerminalSession(session);
            persistResolvedSessionHandle(normalizedSession);
            reconnectingRef.current = true;
            return {
              kind: 'connectable',
              handle: normalizedSession,
            };
          }
          if (session.status === 'failed') {
            return {
              kind: 'failed',
              sessionId: storedSessionId,
              reason: session.close_reason ?? null,
            };
          }
          if (session.status === 'closed') {
            return {
              kind: 'closed',
              sessionId: storedSessionId,
              reason: session.close_reason ?? null,
            };
          }
        } catch (error) {
          invalidateSessionHandle({ clearStored: true });
          if (isTerminalSessionLookupMiss(error)) {
            reconnectingRef.current = false;
            return {
              kind: 'closed',
              sessionId: storedSessionId,
              reason: 'task_terminal_session_missing',
            };
          }
          throw error;
        }
      }

      const created = await createSessionWithRetry();
      const normalizedSession = normalizeCreatedTerminalSession(created);
      persistResolvedSessionHandle(normalizedSession);
      reconnectingRef.current = false;
      return {
        kind: 'connectable',
        handle: normalizedSession,
      };
    })();

    const inFlightResolutionPromise = sessionPromise.finally(() => {
      if (sessionResolutionPromiseRef.current === inFlightResolutionPromise) {
        sessionResolutionPromiseRef.current = null;
      }
    });
    sessionResolutionPromiseRef.current = inFlightResolutionPromise;
    setCachedTerminalSessionResolution(sessionStorageKey, inFlightResolutionPromise);
    void inFlightResolutionPromise.catch(() => undefined);
    return inFlightResolutionPromise;
  }, [
    createSessionWithRetry,
    invalidateSessionHandle,
    persistResolvedSessionHandle,
    projectId,
    readStoredSessionId,
    sessionStorageKey,
    taskApi,
    taskId,
    workspaceId,
  ]);

  const releaseSocketResources = React.useCallback(({
    close = true,
    socket: expectedSocket,
  }: { close?: boolean; socket?: WebSocket | null } = {}) => {
    if (expectedSocket && socketRef.current !== expectedSocket) {
      return;
    }
    if (resizeHandlerRef.current) {
      window.removeEventListener('resize', resizeHandlerRef.current);
      resizeHandlerRef.current = null;
    }
    handshakeReadyRef.current = false;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      if (close && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    }
  }, []);

  const cleanupSocket = React.useCallback(() => {
    releaseSocketResources();
  }, [releaseSocketResources]);

  const isTerminalContainerLaidOut = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, []);

  const scheduleFit = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      if (!isTerminalContainerLaidOut()) {
        return;
      }
      fitAddonRef.current?.fit();
    });
  }, [isTerminalContainerLaidOut]);

  const focusTerminalIfRequested = React.useCallback(() => {
    if (!pendingTerminalFocusRef.current) return;
    if (!visibleRef.current) return;
    if (!terminalRef.current) return;
    if (isEditableFocusOwner(document.activeElement)) {
      pendingTerminalFocusRef.current = false;
      return;
    }
    terminalRef.current?.focus();
    pendingTerminalFocusRef.current = false;
  }, []);

  React.useEffect(() => {
    if (focusRequestToken <= focusRequestTokenRef.current) return;
    focusRequestTokenRef.current = focusRequestToken;
    if (focusRequestToken <= 0) return;
    pendingTerminalFocusRef.current = true;
    if (!open || !visible || !hasInteractiveMount || !terminalRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      focusTerminalIfRequested();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    focusRequestToken,
    focusTerminalIfRequested,
    hasInteractiveMount,
    open,
    visible,
  ]);

  React.useEffect(() => {
    if (!open || !visible || !hasInteractiveMount) return;
    scheduleFit();
  }, [hasInteractiveMount, open, scheduleFit, visible]);

  const disposeTerminal = React.useCallback(() => {
    cleanupSocket();
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    fitAddonRef.current?.dispose();
    fitAddonRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
  }, [cleanupSocket]);

  React.useEffect(() => {
    if (!open || !hasInteractiveMount || !containerRef.current) return;
    if (!terminalRef.current) {
      const terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        theme: {
          background: '#0f141d',
          foreground: '#e5ecf4',
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      scheduleFit();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
          scheduleFit();
          resizeHandlerRef.current?.();
        });
        observer.observe(containerRef.current);
        resizeObserverRef.current = observer;
      }
    }
    return () => {
      disposeTerminal();
    };
  }, [disposeTerminal, hasInteractiveMount, open, scheduleFit]);

  const sendTerminalResize = React.useCallback((socket: WebSocket) => {
    if (socketRef.current !== socket) return;
    if (!handshakeReadyRef.current) return;
    if (!terminalRef.current) {
      return;
    }
    if (fitAddonRef.current && isTerminalContainerLaidOut()) {
      fitAddonRef.current.fit();
      scheduleFit();
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'terminal.resize',
      cols: terminalRef.current.cols,
      rows: terminalRef.current.rows,
    }));
  }, [isTerminalContainerLaidOut, scheduleFit]);

  const markTerminalHandshakeReady = React.useCallback((socket: WebSocket) => {
    if (socketRef.current !== socket) return;
    handshakeReadyRef.current = true;
    pendingTransportReconnectRef.current = false;
    reconnectingRef.current = false;
    updateStatus('active');
    setErrorMessage(null);
    setProgressReason(null);
    sendTerminalResize(socket);
    focusTerminalIfRequested();
  }, [focusTerminalIfRequested, sendTerminalResize, updateStatus]);

  const alignUnavailableReplayContinuation = React.useCallback((
    sessionId: string,
    message: TaskTerminalServerEvent,
  ) => {
    if (!('status' in message) || message.status !== 'unavailable') {
      return false;
    }
    const explicitNextSeq = readTerminalProtocolNumber(message, 'next_seq');
    const latestSeq = readTerminalProtocolNumber(message, 'latest_seq');
    const continuationSeq = explicitNextSeq ?? (latestSeq !== null ? latestSeq + 1 : null);
    if (continuationSeq === null) {
      return true;
    }
    const nextExpectedSeq = Math.max(1, continuationSeq);
    expectedNextSeqBySessionRef.current.set(sessionId, nextExpectedSeq);
    acceptedSeqBoundaryBySessionRef.current.set(sessionId, nextExpectedSeq - 1);
    return true;
  }, []);

  const getAppliedPayloadsForSession = React.useCallback((sessionId: string) => {
    const existing = appliedPayloadsBySessionRef.current.get(sessionId);
    if (existing) return existing;
    const created = new Map<number, string>();
    appliedPayloadsBySessionRef.current.set(sessionId, created);
    return created;
  }, []);

  const getTerminalOutputDecoderForSession = React.useCallback((sessionId: string) => {
    if (typeof TextDecoder === 'undefined') return null;
    const existing = terminalOutputDecodersBySessionRef.current.get(sessionId);
    if (existing) return existing;
    const created = new TextDecoder();
    terminalOutputDecodersBySessionRef.current.set(sessionId, created);
    return created;
  }, []);

  const markProtocolDegraded = React.useCallback((message: string, sessionId?: string) => {
    if (sessionId) {
      terminalOutputDecodersBySessionRef.current.delete(sessionId);
    }
    setDegradationMessage(message);
    pendingTransportReconnectRef.current = true;
    handshakeReadyRef.current = false;
    updateStatus('recovering');
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }, [updateStatus]);

  const shouldAcceptSequencedTerminalOutput = React.useCallback((
    sessionId: string,
    seq: number,
    payloadIdentity: string,
  ) => {
    const expectedSeq =
      expectedNextSeqBySessionRef.current.get(sessionId) ??
      ((lastAppliedSeqBySessionRef.current.get(sessionId) ?? 0) + 1);
    const appliedPayloads = getAppliedPayloadsForSession(sessionId);

    if (seq < expectedSeq) {
      const previousPayloadIdentity = appliedPayloads.get(seq);
      if (previousPayloadIdentity !== undefined && previousPayloadIdentity !== payloadIdentity) {
        setErrorMessage(translationRef.current('terminal_error_connection_failed'));
        setDegradationMessage(null);
        updateStatus('failed');
      }
      return false;
    }

    if (seq > expectedSeq) {
      markProtocolDegraded(translationRef.current('terminal_replay_gap'), sessionId);
      return false;
    }

    return true;
  }, [
    getAppliedPayloadsForSession,
    markProtocolDegraded,
    updateStatus,
  ]);

  const applySequencedTerminalOutput = React.useCallback((
    sessionId: string,
    seq: number,
    payload: string,
    payloadIdentity: string,
  ) => {
    const appliedPayloads = getAppliedPayloadsForSession(sessionId);
    terminalRef.current?.write(payload);
    lastAppliedSeqBySessionRef.current.set(sessionId, seq);
    acceptedSeqBoundaryBySessionRef.current.set(sessionId, seq);
    expectedNextSeqBySessionRef.current.set(sessionId, seq + 1);
    appliedPayloads.set(seq, payloadIdentity);
    if (appliedPayloads.size > 1000) {
      const oldestSeq = Math.min(...appliedPayloads.keys());
      appliedPayloads.delete(oldestSeq);
    }
    scheduleFit();
    focusTerminalIfRequested();
  }, [
    focusTerminalIfRequested,
    getAppliedPayloadsForSession,
    scheduleFit,
  ]);

  React.useEffect(() => {
    if (!open || !hasInteractiveMount || disabled || !terminalRef.current || socketRef.current) return;
    let cancelled = false;
    let recoveryRetryTimer: number | null = null;
    updateStatus('preparing');
    setErrorMessage(null);
    setProgressReason(null);
    explicitCloseRequestedRef.current = false;
    pendingResolutionCloseRef.current = false;

    void resolveSession().then((resolution) => {
      if (pendingResolutionCloseRef.current || suppressResolvedConnectionAfterCloseRef.current) {
        return;
      }
      if (cancelled || !terminalRef.current) return;
      if (resolution.kind === 'failed') {
        invalidateSessionHandle();
        updateStatus('failed');
        const friendlyReason = describeTerminalError(
          translationRef.current,
          resolution.reason ?? 'terminal_connection_failed',
        );
        setErrorMessage(friendlyReason);
        setDegradationMessage(null);
        setProgressReason(null);
        return;
      }
      if (resolution.kind === 'closed') {
        finalizeClosedSession();
        onOpenChangeRef.current(false);
        return;
      }
      if (resolution.kind === 'awaiting-reconnect') {
        invalidateSessionHandle();
        updateStatus('recovering');
        setErrorMessage(null);
        setProgressReason(null);
        recoveryRetryTimer = window.setTimeout(() => {
          if (cancelled || unmountingRef.current) return;
          if (!visibleRef.current) return;
          if (!readStoredSessionId()) return;
          setConnectionRetryToken((current) => current + 1);
        }, TERMINAL_RECOVERY_RETRY_DELAY_MS);
        return;
      }
      const session = resolution.handle;
      updateStatus(reconnectingRef.current ? 'recovering' : 'preparing');
      setErrorMessage(null);
      setProgressReason(null);
      handshakeReadyRef.current = false;
      const socket = new WebSocket(session.wsUrl);
      socketRef.current = socket;
      const isCurrentSocket = () => socketRef.current === socket;

      const dataDisposable = terminalRef.current.onData((data) => {
        if (!isCurrentSocket()) return;
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!handshakeReadyRef.current) return;
        socket.send(JSON.stringify({
          type: 'terminal.stdin',
          data,
        }));
      });

      const resizeHandler = () => {
        if (!isCurrentSocket()) return;
        if (
          !terminalRef.current
          || !fitAddonRef.current
          || !isTerminalContainerLaidOut()
        ) {
          return;
        }
        fitAddonRef.current.fit();
        scheduleFit();
        sendTerminalResize(socket);
      };
      resizeHandlerRef.current = resizeHandler;
      window.addEventListener('resize', resizeHandler);

      socket.onopen = () => {
        if (cancelled || !isCurrentSocket()) return;
        updateStatus('connecting');
        setErrorMessage(null);
        setProgressReason(null);
        pendingTransportReconnectRef.current = false;
        fitAddonRef.current?.fit();
        scheduleFit();
        const lastAppliedSeq = lastAppliedSeqBySessionRef.current.get(session.sessionId) ?? 0;
        const acceptedSeqBoundary =
          acceptedSeqBoundaryBySessionRef.current.get(session.sessionId) ?? 0;
        const afterSeq = Math.max(lastAppliedSeq, acceptedSeqBoundary);
        socket.send(JSON.stringify({
          type: 'terminal.reconnect',
          terminal_session_id: session.sessionId,
          view: TASK_TERMINAL_RECONNECT_VIEW,
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 30,
          ...(afterSeq > 0
            ? { after_seq: afterSeq }
            : {}),
        }));
      };
      socket.onmessage = (event) => {
        if (cancelled || !isCurrentSocket()) return;
        if (!terminalRef.current) return;
        let message: TaskTerminalServerEvent;
        try {
          message = JSON.parse(event.data as string) as TaskTerminalServerEvent;
        } catch {
          return;
        }
        if (!terminalEventBelongsToSession(message, session.sessionId)) {
          return;
        }
        if (message.type === 'terminal.replay_start') {
          pendingTransportReconnectRef.current = false;
          const replayUnavailable = alignUnavailableReplayContinuation(session.sessionId, message);
          const earliestSeq = readTerminalProtocolNumber(message, 'earliest_seq');
          const currentLastSeq = lastAppliedSeqBySessionRef.current.get(session.sessionId) ?? 0;
          const nextExpectedSeq =
            earliestSeq !== null && earliestSeq > currentLastSeq + 1
              ? earliestSeq
              : currentLastSeq + 1;
          if (!replayUnavailable) {
            expectedNextSeqBySessionRef.current.set(session.sessionId, nextExpectedSeq);
          }
          if (message.gap === true || message.status === 'partial' || message.status === 'unavailable') {
            terminalOutputDecodersBySessionRef.current.delete(session.sessionId);
            setDegradationMessage(translationRef.current('terminal_replay_partial'));
          } else {
            setDegradationMessage(null);
          }
          return;
        }
        if (message.type === 'terminal.output') {
          pendingTransportReconnectRef.current = false;
          const messageSessionId = readTerminalProtocolSessionId(message) ?? session.sessionId;
          const seq = readTerminalProtocolNumber(message, 'seq');
          const payloadIdentity = readTerminalOutputPayloadIdentity(message);
          if (seq === null || payloadIdentity === null) return;
          if (!shouldAcceptSequencedTerminalOutput(messageSessionId, seq, payloadIdentity)) return;
          const payload = decodeTerminalOutputPayload(
            message,
            getTerminalOutputDecoderForSession(messageSessionId),
          );
          if (payload === null) return;
          applySequencedTerminalOutput(messageSessionId, seq, payload, payloadIdentity);
          return;
        }
        if (message.type === 'terminal.replay_end') {
          alignUnavailableReplayContinuation(session.sessionId, message);
          if (message.gap === true || message.status === 'partial' || message.status === 'unavailable') {
            if (message.status === 'unavailable') {
              terminalOutputDecodersBySessionRef.current.delete(session.sessionId);
            }
            setDegradationMessage(translationRef.current('terminal_replay_partial'));
          } else {
            setDegradationMessage(null);
          }
          if (readTerminalInputEnabled(message) === true) {
            markTerminalHandshakeReady(socket);
          } else {
            handshakeReadyRef.current = false;
          }
          return;
        }
        if (message.type === 'terminal.state') {
          const state = readTerminalStateValue(message);
          const inputEnabled = readTerminalInputEnabled(message);
          if (state === 'ready' || state === 'active' || state === 'connected') {
            if (inputEnabled === false) {
              handshakeReadyRef.current = false;
              return;
            }
            setDegradationMessage(null);
            markTerminalHandshakeReady(socket);
            return;
          }
          if (state === 'partial' || state === 'connected_partial_replay') {
            setDegradationMessage(translationRef.current('terminal_replay_partial'));
            if (inputEnabled === true) {
              markTerminalHandshakeReady(socket);
            } else {
              handshakeReadyRef.current = false;
            }
            return;
          }
          if (state === 'starting' || state === 'pending' || state === 'waiting') {
            handshakeReadyRef.current = false;
            updateStatus(reconnectingRef.current ? 'recovering' : 'connecting');
            return;
          }
          if (state === 'closed' || state === 'session_ended') {
            finalizeClosedSession();
            return;
          }
          if (state === 'failed' || state === 'unavailable' || state === 'attach_unavailable') {
            invalidateSessionHandle();
            updateStatus('failed');
            setErrorMessage(
              state === 'attach_unavailable'
                ? translationRef.current('terminal_attach_unavailable')
                : translationRef.current('terminal_error_connection_failed'),
            );
            setProgressReason(null);
            return;
          }
        }
        if (message.type === 'terminal.error') {
          pendingTransportReconnectRef.current = false;
          invalidateSessionHandle();
          updateStatus('failed');
          const reason = message.error_message ?? message.reason ?? 'terminal_connection_failed';
          const friendlyReason = describeTerminalError(translationRef.current, reason);
          setErrorMessage(friendlyReason);
          setDegradationMessage(null);
          setProgressReason(null);
          return;
        }
      };
      socket.onerror = () => {
        if (cancelled || !isCurrentSocket()) return;
        pendingTransportReconnectRef.current = true;
        updateStatus('failed');
        setErrorMessage(translationRef.current('terminal_error_connection_failed'));
        setDegradationMessage(null);
        setProgressReason(null);
      };
      socket.onclose = (event) => {
        const wasCurrentSocket = isCurrentSocket();
        dataDisposable.dispose();
        if (!wasCurrentSocket) return;
        releaseSocketResources({ close: false, socket });
        if (cancelled || unmountingRef.current) return;
        if (authoritativeCloseInFlightRef.current) {
          return;
        }
        if (explicitCloseRequestedRef.current) {
          finalizeClosedSession();
          onOpenChangeRef.current(false);
          return;
        }
        if (event.reason === 'terminal_replaced') {
          pendingTransportReconnectRef.current = false;
          invalidateSessionHandle();
          updateStatus('failed');
          setErrorMessage(translationRef.current('terminal_error_taken_over'));
          setDegradationMessage(null);
          return;
        }
        clearCachedTerminalSessionResolution(sessionStorageKey);
        sessionResolutionPromiseRef.current = null;
        const hasStoredSession = Boolean(readStoredSessionId());
        const shouldRetryStoredSession =
          hasStoredSession
          && pendingTransportReconnectRef.current
          && statusRef.current === 'failed';
        if (
          visibleRef.current
          && hasStoredSession
          && (
            (statusRef.current !== 'failed' && statusRef.current !== 'closed')
            || shouldRetryStoredSession
          )
        ) {
          reconnectingRef.current = true;
          pendingTransportReconnectRef.current = false;
          setErrorMessage(null);
          setProgressReason(null);
          updateStatus('recovering');
          setConnectionRetryToken((current) => current + 1);
          return;
        }
        if (shouldRetryStoredSession) {
          reconnectingRef.current = true;
          pendingTransportReconnectRef.current = false;
          setErrorMessage(null);
          setProgressReason(null);
          updateStatus('recovering');
          return;
        }
        pendingTransportReconnectRef.current = false;
        invalidateSessionHandle();
        updateStatus(statusRef.current === 'failed' ? 'failed' : 'closed');
      };
    }).catch((error) => {
      if (cancelled || unmountingRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
      const friendlyReason = describeTerminalError(translationRef.current, message);
      if (message.includes('task_terminal_session_limit_reached')) {
        finalizeClosedSession();
        toast.error(friendlyReason);
        void Promise.resolve(onSessionCreateRejectedRef.current?.()).finally(() => {
          onOpenChangeRef.current(false);
        });
        return;
      }
      updateStatus('failed');
      setErrorMessage(friendlyReason);
      setDegradationMessage(null);
      setProgressReason(null);
      invalidateSessionHandle({ clearStored: true });
      toast.error(friendlyReason);
    });

    return () => {
      cancelled = true;
      if (recoveryRetryTimer !== null) {
        window.clearTimeout(recoveryRetryTimer);
      }
      cleanupSocket();
    };
  }, [
    alignUnavailableReplayContinuation,
    applySequencedTerminalOutput,
    cleanupSocket,
    connectionRetryToken,
    disabled,
    finalizeClosedSession,
    focusTerminalIfRequested,
    getTerminalOutputDecoderForSession,
    hasInteractiveMount,
    invalidateSessionHandle,
    isTerminalContainerLaidOut,
    markTerminalHandshakeReady,
    updateStatus,
    open,
    readStoredSessionId,
    releaseSocketResources,
    resolveSession,
    scheduleFit,
    sendTerminalResize,
    sessionStorageKey,
    shouldAcceptSequencedTerminalOutput,
  ]);

  React.useEffect(() => {
    if (!open || !visible || !hasInteractiveMount) return;
    if (socketRef.current) return;
    if (!readStoredSessionId()) return;
    if (
      statusRef.current !== 'closed'
      && statusRef.current !== 'recovering'
      && !(statusRef.current === 'failed' && pendingTransportReconnectRef.current)
    ) {
      return;
    }
    reconnectingRef.current = true;
    pendingTransportReconnectRef.current = false;
    setErrorMessage(null);
    setProgressReason(null);
    updateStatus('recovering');
    setConnectionRetryToken((current) => current + 1);
  }, [hasInteractiveMount, open, readStoredSessionId, updateStatus, visible]);

  const handleEndSession = React.useCallback(() => {
    explicitCloseRequestedRef.current = true;
    const storedSessionId = readStoredSessionId();
    const pendingResolution = sessionResolutionPromiseRef.current ?? getCachedTerminalSessionResolution(sessionStorageKey);
    if (storedSessionId) {
      pendingResolutionCloseRef.current = true;
      authoritativeCloseInFlightRef.current = true;
      suppressResolvedConnectionAfterCloseRef.current = true;
      invalidateSessionHandle();
      cleanupSocket();
      void taskApi
        .closeTerminalSession(workspaceId, projectId, taskId, storedSessionId)
        .then(() => reconcileClosedSession(storedSessionId))
        .catch((error) => {
          markAuthoritativeCloseFailed(error, storedSessionId);
        });
      return;
    }
    if (pendingResolution) {
      pendingResolutionCloseRef.current = true;
      authoritativeCloseInFlightRef.current = true;
      suppressResolvedConnectionAfterCloseRef.current = true;
      invalidateSessionHandle();
      cleanupSocket();
      void (async () => {
        let resolvedSessionId: string | null = null;
        try {
          const resolution = await pendingResolution;
          resolvedSessionId = getClosableSessionIdFromResolution(resolution);
          await taskApi.closeTerminalSession(
            workspaceId,
            projectId,
            taskId,
            resolvedSessionId,
          );
          await reconcileClosedSession(resolvedSessionId);
        } catch (error) {
          markAuthoritativeCloseFailed(error, resolvedSessionId);
        }
      })();
      return;
    }
    cleanupSocket();
    finalizeClosedSession();
    onOpenChangeRef.current(false);
  }, [
    cleanupSocket,
    finalizeClosedSession,
    invalidateSessionHandle,
    markAuthoritativeCloseFailed,
    projectId,
    reconcileClosedSession,
    readStoredSessionId,
    sessionStorageKey,
    taskApi,
    taskId,
    workspaceId,
  ]);

  React.useEffect(() => {
    if (!open) {
      closeRequestTokenRef.current = closeRequestToken;
      return;
    }
    if (closeRequestToken === closeRequestTokenRef.current) return;
    closeRequestTokenRef.current = closeRequestToken;
    if (closeRequestToken > 0) {
      handleEndSession();
    }
  }, [closeRequestToken, handleEndSession, open]);

  if (!open || (!visible && !hasInteractiveMount)) return null;

  const panelClassName = visible
    ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden'
    : 'pointer-events-none absolute h-0 w-0 overflow-hidden';

  const terminalViewportClassName = [
    'min-h-0',
    'flex-1',
    'overflow-hidden',
    'border',
    'border-subtle',
    'bg-[#0f141d]',
    (status !== 'active' || errorMessage || degradationMessage)
      ? 'rounded-b-md border-t-0'
      : 'rounded-md',
  ].join(' ');
  const terminalStatusMessage =
    degradationMessage ??
    (status === 'recovering'
      ? t('terminal_reconnecting')
      : status === 'preparing'
        ? (
          progressReason === 'run_in_progress'
            ? t('terminal_preparing_run_busy')
            : t('terminal_preparing_environment')
        )
        : status === 'connecting'
          ? t('terminal_connecting')
          : null);

  return (
    <div
      className={panelClassName}
      data-visible={String(visible)}
      aria-hidden={!visible}
      data-testid={tabId ? `agent-tasks__task-terminal-${tabId}` : 'agent-tasks__task-terminal'}
    >
      {(status !== 'active' || errorMessage || degradationMessage) ? (
        <div
          className="flex items-center justify-between gap-3 rounded-t-md border border-subtle bg-surface/70 px-4 py-2"
          aria-live="polite"
        >
          <Badge variant={
            status === 'failed' || status === 'recovering'
              ? 'destructive'
              : status === 'preparing'
                ? 'secondary'
                : 'outline'
          }>
            {t(`terminal_status_${status}`)}
          </Badge>
          {terminalStatusMessage ? (
            <div className="min-w-0 text-xs text-foreground">
              {terminalStatusMessage}
            </div>
          ) : null}
        </div>
      ) : null}
      {errorMessage ? (
        <div
          className="border-x border-b border-subtle bg-error/10 px-4 py-3 text-xs text-error"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div>{t('terminal_error_hint', { reason: errorMessage })}</div>
              <div className="mt-1 text-[11px] text-error/80">{t('terminal_recovery_hint')}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 border-error/30 bg-background/70 px-2.5 text-[11px] text-error hover:bg-background"
              onClick={handleEndSession}
            >
              {t('terminal_close')}
            </Button>
          </div>
        </div>
      ) : null}
      <div
        className={terminalViewportClassName}
        data-testid="agent-tasks__task-terminal-viewport"
      >
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden bg-[#0f141d]"
        />
      </div>
    </div>
  );
}
