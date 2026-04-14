'use client';

import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskAPI } from '@/lib/api/endpoints/tasks';
import type { TaskTerminalServerEvent } from '@/lib/types/task';
import { toast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';

export type TerminalStatus =
  | 'idle'
  | 'preparing'
  | 'recovering'
  | 'connecting'
  | 'active'
  | 'closed'
  | 'failed';

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

type TerminalSessionIdentity = {
  id?: string;
  session_id?: string;
  ws_url?: string | null;
};

type TerminalSessionHandle = {
  id: string;
  wsUrl: string;
};

type TerminalSessionResolution =
  | {
      kind: 'connectable';
      handle: TerminalSessionHandle;
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

function normalizeTerminalSessionIdentity(session: TerminalSessionIdentity): TerminalSessionHandle {
  const id = session.id ?? session.session_id;
  const wsUrl = session.ws_url ?? null;
  if (!id || !wsUrl) {
    throw new Error('task_terminal_session_invalid');
  }
  return {
    id,
    wsUrl,
  };
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
  onOpenChange: (open: boolean) => void;
  onSessionResolved?: (sessionId: string) => void;
  onStatusChange?: (status: TerminalStatus) => void;
  onSessionCreateRejected?: () => void | Promise<void>;
}

export function TaskTerminalPanel({
  open,
  visible = open,
  tabId,
  workspaceId,
  projectId,
  taskId,
  sessionStorageScope = 'default',
  taskTitle,
  taskApi,
  disabled = false,
  closeRequestToken = 0,
  onOpenChange,
  onSessionResolved,
  onStatusChange,
  onSessionCreateRejected,
}: TaskTerminalPanelProps) {
  const t = useTranslations('notebook.task');
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);
  const resizeHandlerRef = React.useRef<(() => void) | null>(null);
  const readyBannerWrittenRef = React.useRef(false);
  const [status, setStatus] = React.useState<TerminalStatus>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [progressReason, setProgressReason] = React.useState<TerminalProgressReason>(null);
  const statusRef = React.useRef<TerminalStatus>('idle');
  const explicitCloseRequestedRef = React.useRef(false);
  const reconnectingRef = React.useRef(false);
  const fitFrameRef = React.useRef<number | null>(null);
  const closeRequestTokenRef = React.useRef(closeRequestToken);
  const previousVisibleRef = React.useRef(visible);
  const visibleRef = React.useRef(visible);
  const pendingTerminalFocusRef = React.useRef(false);
  const pendingResolutionCloseRef = React.useRef(false);
  const unmountingRef = React.useRef(false);
  const [hasInteractiveMount, setHasInteractiveMount] = React.useState(open && visible);
  const [connectionRetryToken, setConnectionRetryToken] = React.useState(0);
  const sessionResolutionPromiseRef =
    React.useRef<Promise<TerminalSessionResolution> | null>(null);
  const translationRef = React.useRef(t);
  const taskTitleRef = React.useRef(taskTitle);
  const onOpenChangeRef = React.useRef(onOpenChange);
  const onSessionResolvedRef = React.useRef(onSessionResolved);
  const onStatusChangeRef = React.useRef(onStatusChange);
  const onSessionCreateRejectedRef = React.useRef(onSessionCreateRejected);
  const sessionStorageKey = React.useMemo(
    () => getTaskTerminalSessionStorageKey(workspaceId, projectId, taskId, sessionStorageScope),
    [projectId, sessionStorageScope, taskId, workspaceId],
  );

  React.useEffect(() => {
    translationRef.current = t;
  }, [t]);

  React.useEffect(() => {
    taskTitleRef.current = taskTitle;
  }, [taskTitle]);

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
  }, [visible]);

  React.useEffect(() => {
    if (!previousVisibleRef.current && open && visible) {
      pendingTerminalFocusRef.current = true;
    }
    if (!visible) {
      pendingTerminalFocusRef.current = false;
    }
    previousVisibleRef.current = visible;
  }, [open, visible]);

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
      storeSessionId(sessionHandle.id);
      onSessionResolvedRef.current?.(sessionHandle.id);
    }
  }, [sessionStorageKey, storeSessionId]);

  const invalidateSessionHandle = React.useCallback(
    ({ clearStored = false }: { clearStored?: boolean } = {}) => {
      clearCachedTerminalSessionResolution(sessionStorageKey);
      sessionResolutionPromiseRef.current = null;
      if (clearStored) {
        clearStoredSessionId();
      }
    },
    [clearStoredSessionId, sessionStorageKey],
  );

  const finalizeClosedSession = React.useCallback(() => {
    reconnectingRef.current = false;
    setErrorMessage(null);
    setProgressReason(null);
    invalidateSessionHandle({ clearStored: true });
    updateStatus('closed');
  }, [invalidateSessionHandle, updateStatus]);

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
        } else if (message.includes('task_run_in_progress')) {
          setProgressReason('run_in_progress');
          updateStatus('preparing');
          setErrorMessage(null);
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
            const normalizedSession = normalizeTerminalSessionIdentity(session);
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
        } catch {
          invalidateSessionHandle({ clearStored: true });
          // Ignore stale session metadata and fall back to a new session.
        }
      }

      const created = await createSessionWithRetry();
      const normalizedSession = normalizeTerminalSessionIdentity(created);
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

  const releaseSocketResources = React.useCallback(({ close = true }: { close?: boolean } = {}) => {
    if (resizeHandlerRef.current) {
      window.removeEventListener('resize', resizeHandlerRef.current);
      resizeHandlerRef.current = null;
    }
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
    terminalRef.current?.focus();
    pendingTerminalFocusRef.current = false;
  }, []);

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
      readyBannerWrittenRef.current = false;
    }
    return () => {
      disposeTerminal();
    };
  }, [disposeTerminal, hasInteractiveMount, open, scheduleFit]);

  React.useEffect(() => {
    if (!open || !hasInteractiveMount || disabled || !terminalRef.current || socketRef.current) return;
    let cancelled = false;
    updateStatus('preparing');
    setErrorMessage(null);
    setProgressReason(null);
    explicitCloseRequestedRef.current = false;
    pendingResolutionCloseRef.current = false;

    void resolveSession().then((resolution) => {
      if (pendingResolutionCloseRef.current) {
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
        setProgressReason(null);
        terminalRef.current.writeln(
          `\r\n${translationRef.current('terminal_failed', { reason: friendlyReason })}`,
        );
        return;
      }
      if (resolution.kind === 'closed') {
        finalizeClosedSession();
        onOpenChangeRef.current(false);
        return;
      }
      const session = resolution.handle;
      updateStatus(reconnectingRef.current ? 'recovering' : 'preparing');
      setProgressReason(null);
      terminalRef.current.writeln(
        reconnectingRef.current
          ? translationRef.current('terminal_reconnecting')
          : translationRef.current('terminal_connecting'),
      );
        const socket = new WebSocket(session.wsUrl);
      socketRef.current = socket;

      const dataDisposable = terminalRef.current.onData((data) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          type: 'terminal.stdin',
          data,
        }));
      });

      const resizeHandler = () => {
        if (
          !terminalRef.current
          || !fitAddonRef.current
          || socket.readyState !== WebSocket.OPEN
          || !isTerminalContainerLaidOut()
        ) {
          return;
        }
        fitAddonRef.current.fit();
        scheduleFit();
        socket.send(JSON.stringify({
          type: 'terminal.resize',
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        }));
      };
      resizeHandlerRef.current = resizeHandler;
      window.addEventListener('resize', resizeHandler);

      socket.onopen = () => {
        updateStatus('connecting');
        setErrorMessage(null);
        setProgressReason(null);
        reconnectingRef.current = false;
        fitAddonRef.current?.fit();
        scheduleFit();
        resizeHandler();
      };
      socket.onmessage = (event) => {
        if (!terminalRef.current) return;
        let message: TaskTerminalServerEvent;
        try {
          message = JSON.parse(event.data as string) as TaskTerminalServerEvent;
        } catch {
          return;
        }
        if (message.type === 'started') {
          if (!readyBannerWrittenRef.current && terminalRef.current) {
            terminalRef.current.writeln(`${translationRef.current('terminal_banner', { title: taskTitleRef.current })}\r\n`);
            readyBannerWrittenRef.current = true;
          }
          updateStatus('active');
          setErrorMessage(null);
          setProgressReason(null);
          scheduleFit();
          focusTerminalIfRequested();
          return;
        }
        if (message.type === 'output') {
          if (!readyBannerWrittenRef.current && terminalRef.current) {
            terminalRef.current.writeln(`${translationRef.current('terminal_banner', { title: taskTitleRef.current })}\r\n`);
            readyBannerWrittenRef.current = true;
          }
          if (statusRef.current !== 'active') {
            updateStatus('active');
            setErrorMessage(null);
            setProgressReason(null);
          }
          terminalRef.current.write(message.chunk);
          scheduleFit();
          focusTerminalIfRequested();
          return;
        }
        if (message.type === 'exited') {
          finalizeClosedSession();
          terminalRef.current.writeln(`\r\n${translationRef.current('terminal_closed')}`);
          if (explicitCloseRequestedRef.current) {
            onOpenChangeRef.current(false);
          }
          return;
        }
        if (message.type === 'error') {
          invalidateSessionHandle();
          updateStatus('failed');
          const friendlyReason = describeTerminalError(translationRef.current, message.error_message);
          setErrorMessage(friendlyReason);
          setProgressReason(null);
          terminalRef.current.writeln(`\r\n${translationRef.current('terminal_failed', { reason: friendlyReason })}`);
        }
      };
      socket.onerror = () => {
        updateStatus('failed');
        setErrorMessage(translationRef.current('terminal_error_connection_failed'));
        setProgressReason(null);
      };
      socket.onclose = (event) => {
        dataDisposable.dispose();
        releaseSocketResources({ close: false });
        if (cancelled || unmountingRef.current) return;
        if (explicitCloseRequestedRef.current) {
          finalizeClosedSession();
          onOpenChangeRef.current(false);
          return;
        }
        if (event.reason === 'terminal_replaced') {
          invalidateSessionHandle();
          updateStatus('failed');
          setErrorMessage(translationRef.current('terminal_error_taken_over'));
          return;
        }
        invalidateSessionHandle();
        if (
          visibleRef.current
          && readStoredSessionId()
          && statusRef.current !== 'failed'
          && statusRef.current !== 'closed'
        ) {
          reconnectingRef.current = true;
          setErrorMessage(null);
          setProgressReason(null);
          updateStatus('recovering');
          setConnectionRetryToken((current) => current + 1);
          return;
        }
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
      setProgressReason(null);
      invalidateSessionHandle({ clearStored: true });
      toast.error(friendlyReason);
    });

    return () => {
      cancelled = true;
      cleanupSocket();
    };
  }, [
    cleanupSocket,
    connectionRetryToken,
    disabled,
    finalizeClosedSession,
    focusTerminalIfRequested,
    hasInteractiveMount,
    invalidateSessionHandle,
    isTerminalContainerLaidOut,
    updateStatus,
    open,
    readStoredSessionId,
    releaseSocketResources,
    resolveSession,
    scheduleFit,
  ]);

  const handleEndSession = React.useCallback(() => {
    explicitCloseRequestedRef.current = true;
    const storedSessionId = readStoredSessionId();
    const pendingResolution = sessionResolutionPromiseRef.current ?? getCachedTerminalSessionResolution(sessionStorageKey);
    clearStoredSessionId();
    if (storedSessionId && statusRef.current === 'failed') {
      cleanupSocket();
      void taskApi
        .closeTerminalSession(workspaceId, projectId, taskId, storedSessionId)
        .catch(() => {
          // Best-effort cleanup for failed sessions that still exist in backend state.
        })
        .finally(() => {
          finalizeClosedSession();
          onOpenChangeRef.current(false);
        });
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'terminal.close' }));
      return;
    }
    if (pendingResolution) {
      pendingResolutionCloseRef.current = true;
      invalidateSessionHandle({ clearStored: true });
      void pendingResolution
        .then((resolution) => {
          if (resolution.kind !== 'connectable') {
            return;
          }
          return taskApi.closeTerminalSession(
            workspaceId,
            projectId,
            taskId,
            resolution.handle.id,
          ).finally(() => {
            invalidateSessionHandle({ clearStored: true });
          });
        })
        .catch(() => {
          // Best-effort cleanup for sessions that resolved after the tab was already closed.
        });
      onOpenChangeRef.current(false);
      return;
    }
    if (storedSessionId) {
      void taskApi
        .closeTerminalSession(workspaceId, projectId, taskId, storedSessionId)
        .catch(() => {
          // Best-effort cleanup for hidden/disconnected sessions.
        })
        .finally(() => {
          finalizeClosedSession();
          onOpenChangeRef.current(false);
        });
      return;
    }
    finalizeClosedSession();
    onOpenChangeRef.current(false);
  }, [
    cleanupSocket,
    clearStoredSessionId,
    finalizeClosedSession,
    invalidateSessionHandle,
    projectId,
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
    (status !== 'active' || errorMessage) ? 'rounded-b-md border-t-0' : 'rounded-md',
  ].join(' ');

  return (
    <div
      className={panelClassName}
      data-visible={String(visible)}
      aria-hidden={!visible}
      data-testid={tabId ? `notebook__task-terminal-${tabId}` : 'notebook__task-terminal'}
    >
      {(status !== 'active' || errorMessage) ? (
        <div className="flex items-center justify-between gap-3 rounded-t-md border border-subtle bg-surface/70 px-4 py-2">
          <Badge variant={
            status === 'failed' || status === 'recovering'
              ? 'destructive'
              : status === 'preparing'
                ? 'secondary'
                : 'outline'
          }>
            {t(`terminal_status_${status}`)}
          </Badge>
          {status === 'recovering' ? (
            <div className="min-w-0 text-xs text-foreground">
              {t('terminal_reconnecting')}
            </div>
          ) : null}
          {status === 'preparing' ? (
            <div className="min-w-0 text-xs text-foreground">
              {progressReason === 'run_in_progress'
                ? t('terminal_preparing_run_busy')
                : t('terminal_preparing_environment')}
            </div>
          ) : null}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="border-x border-b border-subtle bg-error/10 px-4 py-3 text-xs text-error">
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
        data-testid="notebook__task-terminal-viewport"
      >
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden bg-[#0f141d]"
        />
      </div>
    </div>
  );
}
