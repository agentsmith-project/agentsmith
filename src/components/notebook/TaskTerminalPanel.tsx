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

type TerminalStatus = 'idle' | 'connecting' | 'active' | 'closed' | 'failed';

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
  const [status, setStatus] = React.useState<TerminalStatus>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const statusRef = React.useRef<TerminalStatus>('idle');

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const createSessionWithRetry = React.useCallback(async () => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        return await taskApi.createTerminalSession(workspaceId, projectId, taskId, {
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 30,
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
        if (!message.includes('task_runner_offline')) {
          throw error;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('task_runner_offline');
  }, [projectId, taskApi, taskId, workspaceId]);

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
      terminal.writeln(`${t('terminal_banner', { title: taskTitle })}\r\n`);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
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

    void createSessionWithRetry().then((created) => {
      if (cancelled || !terminalRef.current) return;
      terminalRef.current.writeln(t('terminal_connecting'));
      const socket = new WebSocket(created.ws_url);
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
          setStatus('active');
          setErrorMessage(null);
          return;
        }
        if (message.type === 'output') {
          if (statusRef.current !== 'active') {
            setStatus('active');
            setErrorMessage(null);
          }
          terminalRef.current.write(message.chunk);
          return;
        }
        if (message.type === 'exited') {
          setStatus('closed');
          terminalRef.current.writeln(`\r\n${t('terminal_closed')}`);
          return;
        }
        if (message.type === 'error') {
          setStatus('failed');
          setErrorMessage(message.error_message);
          terminalRef.current.writeln(`\r\n${t('terminal_failed', { reason: message.error_message })}`);
        }
      };
      socket.onerror = () => {
        setStatus('failed');
        setErrorMessage('terminal_connection_failed');
      };
      socket.onclose = () => {
        dataDisposable.dispose();
        if (cancelled) return;
        setStatus((current) => current === 'failed' ? 'failed' : 'closed');
      };
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    });

    return () => {
      cancelled = true;
      cleanupSocket();
    };
  }, [cleanupSocket, createSessionWithRetry, disabled, open, t]);

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
          <Badge variant={status === 'active' ? 'default' : status === 'failed' ? 'destructive' : 'outline'}>
            {t(`terminal_status_${status}`)}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('terminal_close')}
          </Button>
        </div>
      </div>
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
