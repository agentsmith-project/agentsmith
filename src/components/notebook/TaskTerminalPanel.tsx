'use client';

import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TaskAPI } from '@/lib/api/endpoints/tasks';
import type { TaskTerminalServerEvent } from '@/lib/types/task';
import { toast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';

type TerminalStatus = 'idle' | 'preparing' | 'connecting' | 'active' | 'closed' | 'failed';

type TerminalProgressReason = 'runner_offline' | 'run_in_progress' | null;

function getTerminalSessionStorageKey(workspaceId: string, projectId: string, taskId: string): string {
  return `agentsmith-terminal-session:${workspaceId}:${projectId}:${taskId}`;
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
  if (reason.includes('terminal_connection_failed')) {
    return t('terminal_error_connection_failed');
  }
  return reason;
}

export interface TaskTerminalPanelProps {
  open: boolean;
  workspaceId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskApi: TaskAPI;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskTerminalPanel({
  open,
  workspaceId,
  projectId,
  taskId,
  taskTitle,
  taskApi,
  disabled = false,
  onOpenChange,
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
  const sessionStorageKey = React.useMemo(
    () => getTerminalSessionStorageKey(workspaceId, projectId, taskId),
    [projectId, taskId, workspaceId],
  );

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
          setStatus('preparing');
          setErrorMessage(null);
        } else if (message.includes('task_run_in_progress')) {
          setProgressReason('run_in_progress');
          setStatus('preparing');
          setErrorMessage(null);
        } else {
          throw error;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('task_runner_offline');
  }, [projectId, taskApi, taskId, workspaceId]);

  const resolveSession = React.useCallback(async () => {
    const storedSessionId = readStoredSessionId();
    if (storedSessionId) {
      try {
        const session = await taskApi.getTerminalSession(workspaceId, projectId, taskId, storedSessionId);
        if (
          session.ws_url
          && (session.status === 'pending' || session.status === 'active' || session.status === 'disconnected')
        ) {
          reconnectingRef.current = true;
          return {
            sessionId: session.id,
            wsUrl: session.ws_url,
          };
        }
      } catch {
        // Ignore stale session metadata and fall back to a new session.
      }
      clearStoredSessionId();
    }

    const created = await createSessionWithRetry();
    storeSessionId(created.session_id);
    reconnectingRef.current = false;
    return {
      sessionId: created.session_id,
      wsUrl: created.ws_url,
    };
  }, [
    clearStoredSessionId,
    createSessionWithRetry,
    projectId,
    readStoredSessionId,
    storeSessionId,
    taskApi,
    taskId,
    workspaceId,
  ]);

  const cleanupSocket = React.useCallback(() => {
    if (resizeHandlerRef.current) {
      window.removeEventListener('resize', resizeHandlerRef.current);
      resizeHandlerRef.current = null;
    }
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }
  }, []);

  const disposeTerminal = React.useCallback(() => {
    cleanupSocket();
    fitAddonRef.current?.dispose();
    fitAddonRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
  }, [cleanupSocket]);

  React.useEffect(() => {
    if (!open || !containerRef.current) return;
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
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      readyBannerWrittenRef.current = false;
    }
    return () => {
      disposeTerminal();
    };
  }, [disposeTerminal, open, t, taskTitle]);

  React.useEffect(() => {
    if (!open || disabled || !terminalRef.current || socketRef.current) return;
    let cancelled = false;
    setStatus('connecting');
    setErrorMessage(null);
    setProgressReason(null);
    explicitCloseRequestedRef.current = false;

    void resolveSession().then((session) => {
      if (cancelled || !terminalRef.current) return;
      setStatus('connecting');
      setProgressReason(null);
      terminalRef.current.writeln(
        reconnectingRef.current ? t('terminal_reconnecting') : t('terminal_connecting'),
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
        if (!terminalRef.current || !fitAddonRef.current || socket.readyState !== WebSocket.OPEN) return;
        fitAddonRef.current.fit();
        socket.send(JSON.stringify({
          type: 'terminal.resize',
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        }));
      };
      resizeHandlerRef.current = resizeHandler;
      window.addEventListener('resize', resizeHandler);

      socket.onopen = () => {
        setStatus('active');
        setErrorMessage(null);
        setProgressReason(null);
        reconnectingRef.current = false;
        fitAddonRef.current?.fit();
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
            terminalRef.current.writeln(`${t('terminal_banner', { title: taskTitle })}\r\n`);
            readyBannerWrittenRef.current = true;
          }
          setStatus('active');
          setErrorMessage(null);
          return;
        }
        if (message.type === 'output') {
          if (!readyBannerWrittenRef.current && terminalRef.current) {
            terminalRef.current.writeln(`${t('terminal_banner', { title: taskTitle })}\r\n`);
            readyBannerWrittenRef.current = true;
          }
          if (statusRef.current !== 'active') {
            setStatus('active');
            setErrorMessage(null);
            setProgressReason(null);
          }
          terminalRef.current.write(message.chunk);
          return;
        }
        if (message.type === 'exited') {
          setStatus('closed');
          clearStoredSessionId();
          terminalRef.current.writeln(`\r\n${t('terminal_closed')}`);
          if (explicitCloseRequestedRef.current) {
            onOpenChange(false);
          }
          return;
        }
        if (message.type === 'error') {
          setStatus('failed');
          const friendlyReason = describeTerminalError(t, message.error_message);
          setErrorMessage(friendlyReason);
          setProgressReason(null);
          terminalRef.current.writeln(`\r\n${t('terminal_failed', { reason: friendlyReason })}`);
        }
      };
      socket.onerror = () => {
        setStatus('failed');
        setErrorMessage(t('terminal_error_connection_failed'));
        setProgressReason(null);
      };
      socket.onclose = (event) => {
        dataDisposable.dispose();
        if (cancelled) return;
        if (explicitCloseRequestedRef.current) {
          clearStoredSessionId();
          setStatus('closed');
          onOpenChange(false);
          return;
        }
        if (event.reason === 'terminal_replaced') {
          setStatus('failed');
          setErrorMessage(t('terminal_error_taken_over'));
          return;
        }
        setStatus((current) => current === 'failed' ? 'failed' : 'closed');
      };
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
      const friendlyReason = describeTerminalError(t, message);
      setStatus('failed');
      setErrorMessage(friendlyReason);
      setProgressReason(null);
      clearStoredSessionId();
      toast.error(friendlyReason);
    });

    return () => {
      cancelled = true;
      cleanupSocket();
    };
  }, [clearStoredSessionId, cleanupSocket, disabled, onOpenChange, open, resolveSession, t]);

  const handleEndSession = React.useCallback(() => {
    explicitCloseRequestedRef.current = true;
    setErrorMessage(null);
    setProgressReason(null);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'terminal.close' }));
      return;
    }
    clearStoredSessionId();
    onOpenChange(false);
  }, [clearStoredSessionId, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="mt-3 overflow-hidden rounded-[18px] border border-white/5 bg-surface/70 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
      data-testid="notebook__task-terminal"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{t('terminal_title')}</div>
          <div className="mt-1 text-xs text-tertiary">{t('terminal_description')}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={
            status === 'active'
              ? 'default'
              : status === 'failed'
                ? 'destructive'
                : status === 'preparing'
                  ? 'secondary'
                  : 'outline'
          }>
            {t(`terminal_status_${status}`)}
          </Badge>
          <Button variant="outline" size="sm" onClick={handleEndSession}>
            {t('terminal_close')}
          </Button>
        </div>
      </div>
      <div className="border-b border-white/6 bg-surface/40 px-4 py-2 text-xs text-tertiary">
        {t('terminal_scope_hint')}
      </div>
      {status === 'preparing' ? (
        <div className="border-b border-white/6 bg-accent/10 px-4 py-2 text-xs text-foreground">
          {progressReason === 'run_in_progress'
            ? t('terminal_preparing_run_busy')
            : t('terminal_preparing_environment')}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="border-b border-white/6 bg-error/10 px-4 py-2 text-xs text-error">
          {t('terminal_error_hint', { reason: errorMessage })}
        </div>
      ) : null}
      <div className="h-[320px] bg-[#0f141d] p-2">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
