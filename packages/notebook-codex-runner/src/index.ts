import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import {
  buildCodexExecArgs,
  buildTaskCodexConfig,
  buildTaskCodexModelCatalog,
} from './codex-command-builder.js';
import { sanitizeAgentDeltaChunk, sanitizeStderrChunk, type RunnerFilterStats } from './codex-output-filter.js';
import {
  buildNotebookHeadlessPreamble,
  prepareNotebookWorkspaceAssets,
} from './notebook-assets.js';
import {
  diffWorkspaceFileSnapshots,
  filterNewArtifactsForRun,
  rememberArtifactsForRun,
  scanArtifactsDirectory,
  scanWorkspaceFilesSnapshot,
} from './artifact-scan.js';
import {
  prepareTaskWorkspace,
  releaseAllPreparedTaskWorkspaces,
} from './task-workspace.js';
import { inspectBuiltinSkills, resolveBuiltinSkillsConfig, seedBuiltinSkills } from './builtin-skills.js';
import { selectLatestInstruction } from './prompt-selection.js';
import { resolveRunnerSuccessPolicy } from './run-result-policy.js';
import {
  ensureCodexSessionStateCompatible,
  markCodexSessionStateReusable,
} from './session-state.js';
import { resolveCodexTerminalOutcome } from './terminal-outcome.js';
import { startTerminalProcess, type TerminalExecutionContext, type TerminalProcess } from './terminal-runtime.js';
import { prepareLaunchCommand } from './child-launcher.js';
import { buildAgentRuntimeEnv } from './agent-runtime-env.js';
import { buildTaskUserInstallEnv } from './user-install-env.js';
import { installNotebookRunnerProcessIdentity } from './task-workspace-ownership.js';
import {
  assertNotebookExecutionContext,
  NOTEBOOK_RUNNER_SPEC,
  type AgentServerStartPayload,
} from '@mbos/agent-runner';

type ServerStartPayload = AgentServerStartPayload;

type ServerHelloPayload = {
  resource_proxy?: {
    base_url?: string;
  };
};

type AgentMessage = {
  type?: string;
  request_id?: string;
  terminal_session_id?: string;
  session_id?: string;
  payload?: ServerStartPayload | ServerHelloPayload;
};

const wsUrl = process.env.MBOS_AGENT_WS_URL;
const key = process.env.MBOS_AGENT_KEY;
const codexBin = process.env.CODEX_BIN ?? 'codex';
const runnerDebug = process.env.MBOS_AGENT_RUNNER_DEBUG === '1';
const codexYolo = process.env.MBOS_AGENT_CODEX_YOLO !== '0';
const proxyExecutionTicketHeaderEnvName = 'MBOS_CODEX_PROXY_EXECUTION_TICKET';
const cancelKillDelayMs = (() => {
  const raw = Number.parseInt(process.env.MBOS_AGENT_CANCEL_KILL_DELAY_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 1_000) return raw;
  return 8_000;
})();
const runnerInstanceId = (process.env.MBOS_AGENT_RUNNER_INSTANCE_ID ?? '').trim();

if (runnerInstanceId) {
  installNotebookRunnerProcessIdentity(runnerInstanceId);
}

if (!wsUrl || !key) {
  process.stderr.write(
    'Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx [CODEX_BIN=codex] npm run dev -w @mbos/notebook-codex-runner\n',
  );
  process.exit(1);
}

const ws = new WebSocket(wsUrl, {
  headers: { Authorization: `Bearer ${key}` },
});

type RunningProcess = ChildProcessByStdio<null, Readable, Readable>;
const runningByRequestId = new Map<string, RunningProcess>();
const runningTerminalBySessionId = new Map<string, TerminalProcess>();
const cancelRequestedByRequestId = new Set<string>();
const traceSeqByRequestId = new Map<string, number>();
const runStartedAtByRequestId = new Map<string, number>();
const reportedArtifactsByRequestId = new Map<string, Set<string>>();
const visibleAgentCharsByRequestId = new Map<string, number>();
const commandCountByRequestId = new Map<string, number>();
let connectedResourceProxyBase = '';
type FilterStats = RunnerFilterStats;
const filterStatsByRequestId = new Map<string, FilterStats>();
let runnerShutdownPromise: Promise<void> | null = null;
let runnerIsShuttingDown = false;

type ShutdownReason = 'websocket_close' | 'sigint' | 'sigterm';
type RunnerLifecycleState = 'connected' | 'shutting_down' | 'disconnected';

function getFilterStats(requestId: string): FilterStats {
  const existing = filterStatsByRequestId.get(requestId);
  if (existing) return existing;
  const created: FilterStats = {
    stderr_superpowers_skill_missing: 0,
    model_metadata_warning: 0,
    stderr_model_refresh_timeout: 0,
    delta_metadata_warning_event: 0,
    delta_empty_error_shell: 0,
  };
  filterStatsByRequestId.set(requestId, created);
  return created;
}

function sanitizePathPart(input: string | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || fallback;
}

function canSendRunnerFrame(): boolean {
  if (runnerIsShuttingDown) return false;
  const readyState = (ws as { readyState?: number }).readyState;
  return readyState === undefined || readyState === WebSocket.OPEN;
}

function sendFrame(type: string, requestId: string, payload: Record<string, unknown>) {
  if (!canSendRunnerFrame()) return;
  ws.send(
    JSON.stringify({
      type,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      payload,
    }),
  );
}

function sendTerminalFrame(type: string, terminalSessionId: string, payload: Record<string, unknown>) {
  if (!canSendRunnerFrame()) return;
  ws.send(
    JSON.stringify({
      type,
      terminal_session_id: terminalSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        terminal_session_id: terminalSessionId,
        ...payload,
      },
    }),
  );
}

function nextTraceSequence(requestId: string): number {
  const next = (traceSeqByRequestId.get(requestId) ?? 0) + 1;
  traceSeqByRequestId.set(requestId, next);
  return next;
}

function sendTraceEvent(
  requestId: string,
  event: {
    category: 'lifecycle' | 'progress' | 'tool' | 'artifact' | 'warning' | 'error' | 'debug';
    phase?: 'start' | 'update' | 'end';
    status?: 'running' | 'success' | 'error' | 'cancelled';
    name: string;
    summary: string;
    details?: Record<string, unknown>;
    raw?: string;
  },
): void {
  sendFrame('agent.response.event', requestId, {
    sequence: nextTraceSequence(requestId),
    at: new Date().toISOString(),
    ...event,
  });
}

function computeRunDurationMs(requestId: string): number | null {
  const startedAt = runStartedAtByRequestId.get(requestId);
  if (!startedAt || !Number.isFinite(startedAt)) return null;
  return Math.max(0, Date.now() - startedAt);
}

function sendRunLifecycleEvent(
  requestId: string,
  phase: 'queued' | 'dispatching' | 'running' | 'streaming' | 'completed' | 'failed' | 'cancelled',
  status: 'running' | 'success' | 'error' | 'cancelled',
  summary: string,
  details?: Record<string, unknown>,
): void {
  sendTraceEvent(requestId, {
    category: 'lifecycle',
    phase: status === 'running' ? 'update' : 'end',
    status,
    name: 'run.lifecycle',
    summary,
    details: {
      run_phase: phase,
      ...(details ?? {}),
    },
  });
}

function sendRunSummaryEvent(
  requestId: string,
  finalStatus: 'success' | 'error' | 'cancelled',
  details?: Record<string, unknown>,
): void {
  const durationMs = computeRunDurationMs(requestId);
  sendTraceEvent(requestId, {
    category: 'progress',
    phase: 'end',
    status: finalStatus,
    name: 'run.summary',
    summary: `Run ${finalStatus}`,
    details: {
      final_status: finalStatus,
      ...(durationMs != null ? { duration_ms: durationMs } : {}),
      ...(details ?? {}),
    },
  });
}

function debugLog(message: string, extra?: Record<string, unknown>): void {
  if (!runnerDebug) return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-codex-runner][debug] ${message}${payload}\n`);
}

function writeRunnerLifecycleState(state: RunnerLifecycleState, reason: string): void {
  process.stdout.write(`[notebook-codex-runner] runner_state=${state} reason=${reason}\n`);
}

function shutdownExitCode(reason: ShutdownReason): number {
  return reason === 'websocket_close' ? 1 : 0;
}

function clearRunnerState(): void {
  runningByRequestId.clear();
  runningTerminalBySessionId.clear();
  cancelRequestedByRequestId.clear();
  connectedResourceProxyBase = '';
  traceSeqByRequestId.clear();
  runStartedAtByRequestId.clear();
  reportedArtifactsByRequestId.clear();
  visibleAgentCharsByRequestId.clear();
  commandCountByRequestId.clear();
  filterStatsByRequestId.clear();
}

function waitForCodexProcessClose(child: RunningProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      child.off('close', finish);
      child.off('exit', finish);
      resolve();
    };
    child.once('close', finish);
    child.once('exit', finish);
  });
}

function waitForTerminalProcessExit(child: TerminalProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let resolved = false;
    child.onExit(() => {
      if (resolved) return;
      resolved = true;
      resolve();
    });
  });
}

async function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function terminateCodexProcess(requestId: string, child: RunningProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const closed = waitForCodexProcessClose(child);
  child.kill('SIGTERM');
  if (await waitWithTimeout(closed, cancelKillDelayMs)) return;
  if (child.exitCode === null) {
    debugLog('codex process did not exit before shutdown grace; sending SIGKILL', { request_id: requestId });
    child.kill('SIGKILL');
  }
  if (!(await waitWithTimeout(closed, cancelKillDelayMs))) {
    debugLog('codex process did not report close after SIGKILL', { request_id: requestId });
  }
}

async function terminateTerminalProcess(terminalSessionId: string, child: TerminalProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const closed = waitForTerminalProcessExit(child);
  child.kill('SIGTERM');
  if (await waitWithTimeout(closed, cancelKillDelayMs)) return;
  if (child.exitCode === null) {
    debugLog('terminal process did not exit before shutdown grace; sending SIGKILL', {
      terminal_session_id: terminalSessionId,
    });
    child.kill('SIGKILL');
  }
  if (!(await waitWithTimeout(closed, cancelKillDelayMs))) {
    debugLog('terminal process did not report exit after SIGKILL', { terminal_session_id: terminalSessionId });
  }
}

async function terminateActiveRunnerProcesses(): Promise<void> {
  const codexProcesses = Array.from(runningByRequestId.entries()).map(([requestId, child]) => (
    terminateCodexProcess(requestId, child)
  ));
  const terminalProcesses = Array.from(runningTerminalBySessionId.entries()).map(([terminalSessionId, child]) => (
    terminateTerminalProcess(terminalSessionId, child)
  ));
  await Promise.all([...codexProcesses, ...terminalProcesses]);
}

function closeWebSocketForShutdown(reason: ShutdownReason): void {
  if (reason === 'websocket_close') return;
  try {
    if (typeof ws.close === 'function') {
      ws.close();
    }
  } catch (error) {
    debugLog('websocket close during shutdown failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function shutdownRunner(reason: ShutdownReason): Promise<void> {
  if (runnerShutdownPromise) {
    return runnerShutdownPromise;
  }
  runnerIsShuttingDown = true;
  runnerShutdownPromise = (async () => {
    writeRunnerLifecycleState('shutting_down', reason);
    process.stdout.write(`[notebook-codex-runner] shutting down (${reason})\n`);
    closeWebSocketForShutdown(reason);
    await terminateActiveRunnerProcesses();
    try {
      await releaseAllPreparedTaskWorkspaces();
    } catch (error) {
      process.stderr.write(
        `[notebook-codex-runner] shutdown cleanup failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
      );
    } finally {
      clearRunnerState();
    }
  })().finally(() => {
    writeRunnerLifecycleState('disconnected', reason);
    process.exit(shutdownExitCode(reason));
  });
  return runnerShutdownPromise;
}

function closeTerminalSession(terminalSessionId: string, signal: NodeJS.Signals = 'SIGTERM'): void {
  const child = runningTerminalBySessionId.get(terminalSessionId);
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  if (signal === 'SIGTERM') {
    setTimeout(() => {
      const existing = runningTerminalBySessionId.get(terminalSessionId);
      if (existing && existing.exitCode === null) {
        existing.kill('SIGKILL');
      }
    }, cancelKillDelayMs);
  }
}

async function runTerminalSession(terminalSessionId: string, payload: {
  cols?: number;
  rows?: number;
  shell?: string;
  execution_context?: TerminalExecutionContext;
}): Promise<void> {
  debugLog('terminal start requested', {
    terminal_session_id: terminalSessionId,
    has_execution_context: !!payload.execution_context,
    shell: payload.shell ?? null,
  });
  const executionContext = (payload.execution_context ?? {}) as TerminalExecutionContext;
  const started = await startTerminalProcess({
    executionContext,
    shell: payload.shell,
    cols: payload.cols,
    rows: payload.rows,
  });
  const child = started.child;
  runningTerminalBySessionId.set(terminalSessionId, child);
  debugLog('terminal started', {
    terminal_session_id: terminalSessionId,
    cwd: started.cwd,
  });
  sendTerminalFrame('agent.terminal.started', terminalSessionId, {
    cols: payload.cols ?? 120,
    rows: payload.rows ?? 30,
    cwd: started.cwd,
  });

  child.onData((chunk) => {
    sendTerminalFrame('agent.terminal.output', terminalSessionId, {
      chunk,
    });
  });
  child.onExit(({ exitCode, signal }) => {
    runningTerminalBySessionId.delete(terminalSessionId);
    debugLog('terminal exited', {
      terminal_session_id: terminalSessionId,
      exit_code: exitCode,
      signal: signal ?? null,
    });
    sendTerminalFrame('agent.terminal.exited', terminalSessionId, {
      exit_code: exitCode,
      signal: signal ?? null,
    });
  });
}

function maybeEmitDeltaChunk(requestId: string, chunk: string): number {
  const trimmed = sanitizeAgentDeltaChunk(chunk, () => getFilterStats(requestId)).replace(/\r/g, '');
  if (!trimmed.trim()) return 0;
  sendFrame('agent.response.delta', requestId, { delta: trimmed });
  return trimmed.length;
}

function extractAgentDeltaFromStdoutLine(line: string): string | null {
  const evt = parseCodexJsonLine(line);
  if (!evt) {
    const trimmed = line.trim();
    return trimmed ? trimmed : null;
  }
  const type = typeof evt.type === 'string' ? evt.type : '';
  const item = typeof evt.item === 'object' && evt.item !== null ? (evt.item as Record<string, unknown>) : null;
  const payload = typeof evt.payload === 'object' && evt.payload !== null ? (evt.payload as Record<string, unknown>) : null;
  if (type === 'response.output_text.delta' && typeof evt.delta === 'string' && evt.delta.trim()) {
    return evt.delta;
  }
  if (type === 'response.output_text.done' && typeof evt.text === 'string' && evt.text.trim()) {
    return evt.text;
  }
  if (type === 'item.delta') {
    const delta = typeof evt.delta === 'object' && evt.delta !== null ? (evt.delta as Record<string, unknown>) : null;
    if (delta && typeof delta.text === 'string' && delta.text.trim()) {
      return delta.text;
    }
  }
  if ((type === 'item.completed' || type === 'item.updated') && item?.type === 'agent_message') {
    if (typeof item.text === 'string' && item.text.trim()) return item.text;
    if (typeof item.content === 'string' && item.content.trim()) return item.content;
  }
  if (type === 'event_msg' && payload?.type === 'agent_message' && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  if (type === 'task_complete' && payload && typeof payload.last_agent_message === 'string' && payload.last_agent_message.trim()) {
    return payload.last_agent_message;
  }
  return null;
}

function parseCodexJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeProxyBase(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\/+$/, '');
}

function maybeEmitTraceFromStdoutLine(requestId: string, line: string): void {
  const evt = parseCodexJsonLine(line);
  if (!evt) return;
  const type = typeof evt.type === 'string' ? evt.type : 'unknown';
  const itemObj = typeof evt.item === 'object' && evt.item !== null ? (evt.item as Record<string, unknown>) : null;
  const itemType = itemObj && typeof itemObj.type === 'string' ? itemObj.type : null;
  const readItemErrorText = (item: Record<string, unknown> | null): string => {
    if (!item) return '';
    if (typeof item.message === 'string' && item.message.trim()) return item.message.trim();
    if (typeof item.text === 'string' && item.text.trim()) return item.text.trim();
    const errorObj = typeof item.error === 'object' && item.error !== null ? (item.error as Record<string, unknown>) : null;
    if (errorObj && typeof errorObj.message === 'string' && errorObj.message.trim()) return errorObj.message.trim();
    return '';
  };
  const readCommandText = (item: Record<string, unknown> | null): string => {
    if (!item) return '';
    if (typeof item.command === 'string' && item.command.trim()) return item.command.trim();
    if (typeof item.cmd === 'string' && item.cmd.trim()) return item.cmd.trim();
    if (typeof item.shell_command === 'string' && item.shell_command.trim()) return item.shell_command.trim();
    if (Array.isArray(item.argv)) {
      const argv = item.argv
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .trim();
      if (argv) return argv;
    }
    return '';
  };
  const commandText = readCommandText(itemObj);
  // Always emit a high-fidelity raw/debug event so the UI Raw view can show more of Codex's console semantics.
  sendTraceEvent(requestId, {
    category: 'debug',
    phase: 'update',
    status: 'running',
    name: `codex.raw.${type}`,
    summary: itemType ? `Codex event: ${type} (${itemType})` : `Codex event: ${type}`,
    details: {
      event_type: type,
      ...(itemType ? { item_type: itemType } : {}),
    },
    raw: line,
  });
  if (type !== 'thread.started'
    && type !== 'turn.started'
    && type !== 'turn.completed'
    && type !== 'turn.failed'
    && type !== 'error'
    && type !== 'item.completed'
    && type !== 'item.started'
    && type !== 'item.updated') {
    return;
  }

  if (type === 'thread.started') {
    sendTraceEvent(requestId, {
      category: 'lifecycle',
      phase: 'start',
      status: 'running',
      name: 'codex.thread',
      summary: 'Codex thread started',
    });
    return;
  }
  if (type === 'turn.started') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'start',
      status: 'running',
      name: 'codex.turn',
      summary: 'Agent turn started',
    });
    return;
  }
  if (type === 'turn.completed') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'end',
      status: 'success',
      name: 'codex.turn',
      summary: 'Agent turn completed',
    });
    return;
  }
  if (type === 'turn.failed') {
    const errObj = typeof evt.error === 'object' && evt.error !== null ? (evt.error as Record<string, unknown>) : {};
    const message = typeof errObj.message === 'string' ? errObj.message : 'Agent turn failed';
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.turn',
      summary: message,
      details: { message },
    });
    return;
  }
  if (type === 'error') {
    const message = typeof evt.message === 'string' ? evt.message : 'Codex error';
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'update',
      status: 'error',
      name: 'codex.error',
      summary: message,
      details: { message },
    });
    return;
  }
  const item = itemObj ?? {};
  if (type === 'item.started' || type === 'item.updated') {
    if (item.type === 'command_execution') {
      const commandLabel = commandText || 'shell command';
      sendTraceEvent(requestId, {
        category: 'tool',
        phase: type === 'item.started' ? 'start' : 'update',
        status: 'running',
        name: 'codex.command',
        summary: `Command ${type === 'item.started' ? 'started' : 'updated'}: ${commandLabel}`,
        details: {
          ...(commandText ? { command: commandText } : {}),
        },
      });
      return;
    }
    if (item.type === 'function_call') {
      const toolName = typeof item.name === 'string' ? item.name : 'unknown';
      sendTraceEvent(requestId, {
        category: 'tool',
        phase: type === 'item.started' ? 'start' : 'update',
        status: 'running',
        name: 'codex.tool',
        summary: `Tool call ${type === 'item.started' ? 'started' : 'updated'}: ${toolName}`,
        details: {
          tool_name: toolName,
          ...(typeof item.arguments === 'string' ? { arguments: item.arguments } : {}),
        },
      });
    }
    return;
  }
  if (item.type === 'agent_message') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'end',
      status: 'success',
      name: 'codex.output',
      summary: 'Agent message completed',
    });
    return;
  }
  if (item.type === 'function_call') {
    const toolName = typeof item.name === 'string' ? item.name : 'unknown';
    sendTraceEvent(requestId, {
      category: 'tool',
      phase: 'end',
      status: 'success',
      name: 'codex.tool',
      summary: `Tool call completed: ${toolName}`,
      details: {
        tool_name: toolName,
        ...(typeof item.arguments === 'string' ? { arguments: item.arguments } : {}),
      },
    });
    return;
  }
  if (item.type === 'command_execution') {
    const exitCode = typeof item.exit_code === 'number' && Number.isFinite(item.exit_code)
      ? Math.trunc(item.exit_code)
      : null;
    const status = exitCode === null || exitCode === 0 ? 'success' : 'error';
    const commandLabel = commandText || 'shell command';
    sendTraceEvent(requestId, {
      category: status === 'success' ? 'tool' : 'error',
      phase: 'end',
      status,
      name: 'codex.command',
      summary: status === 'success'
        ? `Command completed: ${commandLabel}`
        : `Command failed${exitCode !== null ? ` (exit ${exitCode})` : ''}: ${commandLabel}`,
      details: {
        ...(commandText ? { command: commandText } : {}),
        ...(exitCode !== null ? { exit_code: exitCode } : {}),
      },
    });
    return;
  }
  if (type === 'item.completed') {
    const errorText = itemType === 'error' ? readItemErrorText(item) : '';
    sendTraceEvent(requestId, {
      category: itemType === 'error' ? 'error' : 'progress',
      phase: 'end',
      status: itemType === 'error' ? 'error' : 'success',
      name: 'codex.item',
      summary: itemType === 'error' && errorText
        ? `Item completed: error (${errorText})`
        : itemType ? `Item completed: ${itemType}` : 'Item completed',
      details: itemType
        ? {
          item_type: itemType,
          ...(errorText ? { error_message: errorText } : {}),
        }
        : undefined,
    });
  }
}

function extractJsonObjectsFromBuffer(buffer: string): { objects: string[]; rest: string } {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (start < 0) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(buffer.slice(start, i + 1));
        start = -1;
      }
    }
  }

  if (start >= 0) {
    return { objects, rest: buffer.slice(start) };
  }
  return { objects, rest: '' };
}

function flushCodexStdoutBuffer(requestId: string, buffer: string): string {
  let remaining = buffer;

  const newlineParts = remaining.split('\n');
  const tail = newlineParts.pop() ?? '';
  for (const rawPart of newlineParts) {
    const line = rawPart.trim();
    if (!line) continue;
    maybeEmitTraceFromStdoutLine(requestId, line);
    const agentDelta = extractAgentDeltaFromStdoutLine(line);
    if (agentDelta) {
      const emitted = maybeEmitDeltaChunk(requestId, agentDelta);
      if (emitted > 0) {
        visibleAgentCharsByRequestId.set(requestId, (visibleAgentCharsByRequestId.get(requestId) ?? 0) + emitted);
      }
    }
  }
  remaining = tail;

  const parsed = extractJsonObjectsFromBuffer(remaining);
  for (const jsonObject of parsed.objects) {
    const line = jsonObject.trim();
    if (!line) continue;
    maybeEmitTraceFromStdoutLine(requestId, line);
    const agentDelta = extractAgentDeltaFromStdoutLine(line);
    if (agentDelta) {
      const emitted = maybeEmitDeltaChunk(requestId, agentDelta);
      if (emitted > 0) {
        visibleAgentCharsByRequestId.set(requestId, (visibleAgentCharsByRequestId.get(requestId) ?? 0) + emitted);
      }
    }
  }
  return parsed.rest;
}

async function runCodexRequest(requestId: string, payload: ServerStartPayload): Promise<void> {
  const executionContext = assertNotebookExecutionContext(payload.execution_context);
  const taskId = sanitizePathPart(executionContext.task_id, `task_${requestId.slice(0, 8)}`);
  const agentSessionId = sanitizePathPart(executionContext.session_id, '');
  const username = sanitizePathPart(executionContext.username, 'unknown_user');
  debugLog('preparing task workspace', { request_id: requestId, task_id: taskId });
  const cwdResult = await prepareTaskWorkspace({
    executionContext,
    username,
    taskId,
  });
  const cwd = cwdResult.cwd;
  const taskPaths = cwdResult.paths;
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(taskPaths.codexDir, { recursive: true }),
    mkdir(taskPaths.mbosDir, { recursive: true }),
    mkdir(taskPaths.skillsDir, { recursive: true }),
  ]);
  const builtinSkillsConfig = resolveBuiltinSkillsConfig();
  debugLog('checking builtin skills', {
    request_id: requestId,
    cwd,
    source_dir: builtinSkillsConfig.sourceDir,
    skills: builtinSkillsConfig.skills,
  });
  const builtinSkillsResult = await inspectBuiltinSkills({
    sourceDir: builtinSkillsConfig.sourceDir,
    skills: builtinSkillsConfig.skills,
    required: builtinSkillsConfig.required,
  });
  const builtinSkillsRuntime = await seedBuiltinSkills({
    sourceDir: builtinSkillsResult.sourceDir,
    skills: builtinSkillsResult.available,
    targetDir: taskPaths.skillsDir,
    manifestDir: taskPaths.mbosDir,
  });
  const interactionKind = 'notebook';
  const userPrompt = selectLatestInstruction(payload.messages);
  const taskInputs = Array.isArray(executionContext.task_inputs) ? executionContext.task_inputs : [];
  debugLog('preparing notebook workspace assets', { request_id: requestId, cwd });
  const preparedAssets = await prepareNotebookWorkspaceAssets({
    cwd,
    paths: taskPaths,
    executionContext,
    taskInputs,
    debugLog,
  });
  const artifactsDir = preparedAssets.artifactsDir;
  const prompt = `${buildNotebookHeadlessPreamble({
    artifactsDir,
  })}User request:\n${userPrompt}`;
  const endpointProxyBase = connectedResourceProxyBase;
  if (!endpointProxyBase) {
    throw new Error('resource_proxy_base_missing');
  }
  const modelContextWindow =
    typeof executionContext.model_context_window === 'number' && Number.isFinite(executionContext.model_context_window)
      ? Math.floor(executionContext.model_context_window)
      : undefined;
  const modelAutoCompactTokenLimit =
    typeof executionContext.model_auto_compact_token_limit === 'number'
      && Number.isFinite(executionContext.model_auto_compact_token_limit)
      ? Math.floor(executionContext.model_auto_compact_token_limit)
      : undefined;
  const modelCatalogInputModalities = Array.isArray(executionContext.model_catalog?.input_modalities)
    ? executionContext.model_catalog?.input_modalities
      ?.filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : ['text'];
  const modelCatalogSupportsSearchTool = executionContext.model_catalog?.supports_search_tool === true;
  const modelCatalogSupportsParallelToolCalls = executionContext.model_catalog?.supports_parallel_tool_calls === true;
  const sessionStateResult = await ensureCodexSessionStateCompatible({
    codexDir: taskPaths.codexDir,
    taskId,
    model: payload.model ?? executionContext.model ?? 'gpt-5-codex',
    wireApi: executionContext.wire_api === 'chat' ? 'chat' : 'responses',
    resourceProxyBase: endpointProxyBase,
    interactionKind,
    modelContextWindow,
    modelAutoCompactTokenLimit,
    modelCatalogSignature: JSON.stringify({
      input_modalities: modelCatalogInputModalities,
      supports_search_tool: modelCatalogSupportsSearchTool,
      supports_parallel_tool_calls: modelCatalogSupportsParallelToolCalls,
    }),
  });
  debugLog('validated codex session state', {
    request_id: requestId,
    codex_dir: taskPaths.codexDir,
    reset_performed: sessionStateResult.resetPerformed,
    reason: sessionStateResult.reason,
    resume_allowed: sessionStateResult.resumeAllowed,
  });
  const resumeSession = sessionStateResult.resumeAllowed;
  // codex-cli >=0.104 no longer accepts wire_api=chat in provider config.
  const wireApi = 'responses';

  const model = executionContext.model ?? payload.model ?? 'gpt-5-codex';
  const codexConfigDir = taskPaths.codexDir;
  await mkdir(codexConfigDir, { recursive: true });
  const modelCatalogPath = join(codexConfigDir, 'catalog.json');
  await writeFile(
    modelCatalogPath,
    buildTaskCodexModelCatalog({
      model,
      modelContextWindow: modelContextWindow ?? 128000,
      modelAutoCompactTokenLimit: modelAutoCompactTokenLimit ?? Math.floor((modelContextWindow ?? 128000) * 0.9),
      inputModalities: modelCatalogInputModalities,
      supportsSearchTool: modelCatalogSupportsSearchTool,
      supportsParallelToolCalls: modelCatalogSupportsParallelToolCalls,
    }),
    'utf-8',
  );
  debugLog('writing codex config', {
    request_id: requestId,
    config_path: join(codexConfigDir, 'config.toml'),
    model_catalog_path: modelCatalogPath,
  });
  await writeFile(
    join(codexConfigDir, 'config.toml'),
    buildTaskCodexConfig({
      model,
      endpointProxyBase,
      wireApi,
      modelContextWindow,
      modelAutoCompactTokenLimit,
      modelCatalogPath,
      executionTicketHeaderEnvName: executionContext.execution_ticket
        ? proxyExecutionTicketHeaderEnvName
        : undefined,
    }),
    'utf-8',
  );
  debugLog('prepared task workspace', {
    request_id: requestId,
    cwd,
    codex_config: join(codexConfigDir, 'config.toml'),
    model,
    wire_api: wireApi,
    resource_proxy_base: endpointProxyBase,
    proxy_source: 'server_hello',
    model_context_window: modelContextWindow ?? null,
    model_auto_compact_token_limit: modelAutoCompactTokenLimit ?? null,
    model_catalog_path: modelCatalogPath,
    model_input_modalities: modelCatalogInputModalities,
    model_supports_search_tool: modelCatalogSupportsSearchTool,
    model_supports_parallel_tool_calls: modelCatalogSupportsParallelToolCalls,
    has_execution_ticket: Boolean(executionContext.execution_ticket && executionContext.execution_ticket.trim()),
    interaction_kind: interactionKind,
    resume_session: resumeSession,
    session_id: agentSessionId || null,
    task_inputs_count: taskInputs.length,
    builtin_skills_source_dir: builtinSkillsResult.sourceDir,
    builtin_skills_runtime_dir: builtinSkillsRuntime.targetDir,
    builtin_skills_mounted: builtinSkillsRuntime.seeded,
    artifacts_dir: artifactsDir,
    cwd_source: cwdResult.source,
  });

  const codexArgs = buildCodexExecArgs({
    model,
    prompt,
    cwd,
    endpointProxyBase,
    wireApi,
    modelContextWindow,
    modelAutoCompactTokenLimit,
    modelCatalogPath,
    resumeSession,
  });

  const childCommand = await prepareLaunchCommand({
    file: codexBin,
    args: codexArgs,
    cwd,
    env: buildTaskUserInstallEnv(taskPaths.homeDir, {
      ...process.env,
      NO_COLOR: '1',
      ...buildAgentRuntimeEnv(executionContext),
      ...(executionContext.execution_ticket ? {
        [proxyExecutionTicketHeaderEnvName]: executionContext.execution_ticket,
      } : {}),
    }),
  });
  const child = spawn(
    childCommand.file,
    childCommand.args,
    {
      cwd,
      env: childCommand.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  debugLog('spawned codex', {
    request_id: requestId,
    yolo: codexYolo,
    cmd: childCommand.file,
    argv: childCommand.args.map((arg) => {
      if (arg === prompt) return '<prompt>';
      return arg;
    }),
  });
  runningByRequestId.set(requestId, child);
  cancelRequestedByRequestId.delete(requestId);
  sendRunLifecycleEvent(requestId, 'dispatching', 'running', 'Dispatching agent run', {
    model,
    wire_api: wireApi,
  });
  sendRunLifecycleEvent(requestId, 'running', 'running', 'Agent run in progress');
  sendTraceEvent(requestId, {
    category: 'progress',
    phase: 'start',
    status: 'running',
    name: 'codex.exec',
    summary: 'Starting Codex execution',
    details: {
      model,
      wire_api: wireApi,
      model_context_window: modelContextWindow ?? null,
      model_auto_compact_token_limit: modelAutoCompactTokenLimit ?? null,
      model_catalog_path: modelCatalogPath,
      model_input_modalities: modelCatalogInputModalities,
      model_supports_search_tool: modelCatalogSupportsSearchTool,
      model_supports_parallel_tool_calls: modelCatalogSupportsParallelToolCalls,
      yolo: codexYolo,
      interaction_kind: interactionKind,
      task_inputs_count: taskInputs.length,
      builtin_skills_count: builtinSkillsResult.available.length,
      artifacts_dir: './.artifacts/',
    },
  });
  sendTraceEvent(requestId, {
    category: 'progress',
    phase: 'start',
    status: 'running',
    name: 'runner.policy',
    summary: 'Notebook headless execution policy applied',
    details: {
      artifacts_dir: './.artifacts/',
    },
  });

  let stdoutBuffer = '';
  const workspaceBeforeSnapshot = await scanWorkspaceFilesSnapshot(cwd);
  const artifactsBeforeRun = await scanArtifactsDirectory(cwd, taskId);
  if (artifactsBeforeRun.length > 0) {
    rememberArtifactsForRun(reportedArtifactsByRequestId, requestId, artifactsBeforeRun);
  }
  child.stdout.on('data', (buffer: Buffer) => {
    stdoutBuffer += buffer.toString('utf-8');
    stdoutBuffer = flushCodexStdoutBuffer(requestId, stdoutBuffer);
  });

  child.stderr.on('data', (buffer: Buffer) => {
    const text = sanitizeStderrChunk(buffer.toString('utf-8'), () => getFilterStats(requestId));
    if (!text) return;
    sendTraceEvent(requestId, {
      category: text.includes('ERROR') ? 'error' : 'warning',
      phase: 'update',
      status: 'running',
      name: 'codex.stderr',
      summary: (text.split('\n')[0] ?? 'stderr').slice(0, 200),
      details: { stderr: text.slice(0, 4000) },
    });
  });

  child.on('error', (error) => {
    runningByRequestId.delete(requestId);
    cancelRequestedByRequestId.delete(requestId);
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.exec',
      summary: error.message,
    });
    sendFrame('agent.response.error', requestId, {
      error_code: 'AGENT_UPSTREAM_ERROR',
      error_message: error.message,
    });
    sendRunLifecycleEvent(requestId, 'failed', 'error', error.message);
    sendRunSummaryEvent(requestId, 'error', { reason: 'runner_error' });
    if (runnerDebug) {
      const stats = filterStatsByRequestId.get(requestId);
      if (stats) debugLog('filter stats', { request_id: requestId, ...stats });
    }
    runStartedAtByRequestId.delete(requestId);
    filterStatsByRequestId.delete(requestId);
    reportedArtifactsByRequestId.delete(requestId);
    visibleAgentCharsByRequestId.delete(requestId);
    commandCountByRequestId.delete(requestId);
  });

  child.on('close', (code, signal) => {
    stdoutBuffer = flushCodexStdoutBuffer(requestId, stdoutBuffer);
    const trailingLine = stdoutBuffer.trim();
    if (trailingLine.length > 0) {
      // Final fallback for residual non-JSON text without trailing newline.
      maybeEmitTraceFromStdoutLine(requestId, trailingLine);
      const emitted = maybeEmitDeltaChunk(requestId, trailingLine);
      if (emitted > 0) {
        visibleAgentCharsByRequestId.set(requestId, (visibleAgentCharsByRequestId.get(requestId) ?? 0) + emitted);
      }
      stdoutBuffer = '';
    }
    debugLog('codex process closed', {
      request_id: requestId,
      code: code ?? null,
      signal: signal ?? null,
    });
    if (runnerDebug) {
      const stats = filterStatsByRequestId.get(requestId);
      if (stats) debugLog('filter stats', { request_id: requestId, ...stats });
    }
    const cancelRequested = cancelRequestedByRequestId.has(requestId);
    runningByRequestId.delete(requestId);
    cancelRequestedByRequestId.delete(requestId);
    void (async () => {
      if (workspaceBeforeSnapshot) {
        try {
          const workspaceAfterSnapshot = await scanWorkspaceFilesSnapshot(cwd);
          const changes = diffWorkspaceFileSnapshots(workspaceBeforeSnapshot, workspaceAfterSnapshot);
          if (changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0) {
            sendTraceEvent(requestId, {
              category: 'tool',
              phase: 'end',
              status: code === 0 ? 'success' : 'running',
              name: 'workspace.files_changed',
              summary: `Workspace files changed (+${changes.added.length} ~${changes.modified.length} -${changes.deleted.length})`,
              details: changes as unknown as Record<string, unknown>,
            });
          }
        } catch (error) {
          sendTraceEvent(requestId, {
            category: 'warning',
            phase: 'update',
            status: 'running',
            name: 'workspace.scan',
            summary: error instanceof Error ? error.message : 'workspace_scan_failed',
          });
        }
      }
      const artifacts = filterNewArtifactsForRun(
        reportedArtifactsByRequestId,
        requestId,
        await scanArtifactsDirectory(cwd, taskId),
      );
      for (const artifact of artifacts) {
        sendTraceEvent(requestId, {
          category: 'artifact',
          phase: 'end',
          status: 'success',
          name: 'runner.artifact',
          summary: `Artifact discovered: ${artifact.filename}`,
          details: {
            filename: artifact.filename,
            path: artifact.task_relative_path,
            artifact_type: artifact.artifact_type,
            file_size: artifact.file_size,
            mtime_ms: artifact.mtime_ms,
          },
        });
        sendFrame('agent.response.artifact', requestId, artifact as unknown as Record<string, unknown>);
      }
      const terminalOutcome = resolveCodexTerminalOutcome({
        cancelRequested,
        code,
        signal,
      });
      if (cancelRequested) {
        const gracefulCancelExit = code === 0 && !signal;
        sendTraceEvent(requestId, {
          category: 'warning',
          phase: 'end',
          status: terminalOutcome.codexTraceStatus,
          name: 'codex.exec',
          summary: signal
            ? `Codex terminated (${signal})`
            : 'Codex run cancelled after request',
          details: {
            cancel_requested: true,
            graceful_exit: gracefulCancelExit,
            ...(signal ? { signal } : {}),
            ...(code !== null ? { exit_code: code } : {}),
          },
        });
        sendRunLifecycleEvent(
          requestId,
          'cancelled',
          'cancelled',
          signal ? `Run cancelled (${signal})` : 'Run cancelled by request',
          {
            cancel_requested: true,
            graceful_exit: gracefulCancelExit,
            ...(signal ? { signal } : {}),
            ...(code !== null ? { exit_code: code } : {}),
          },
        );
        sendRunSummaryEvent(requestId, 'cancelled', {
          cancel_requested: true,
          graceful_exit: gracefulCancelExit,
          ...(signal ? { signal } : {}),
          ...(code !== null ? { exit_code: code } : {}),
          artifacts_count: artifacts.length,
        });
        sendFrame('agent.response.error', requestId, {
          error_code: terminalOutcome.errorCode ?? 'AGENT_CANCELLED',
          error_message: terminalOutcome.errorMessage ?? 'codex_cancelled_by_request',
        });
        traceSeqByRequestId.delete(requestId);
        runStartedAtByRequestId.delete(requestId);
        filterStatsByRequestId.delete(requestId);
        return;
      }
      if (terminalOutcome.finalStatus === 'success') {
        const successPolicy = resolveRunnerSuccessPolicy({
          visibleAgentChars: visibleAgentCharsByRequestId.get(requestId) ?? 0,
          artifactCount: artifacts.length,
          commandCount: commandCountByRequestId.get(requestId) ?? 0,
        });
        if (!successPolicy.ok) {
          sendTraceEvent(requestId, {
            category: 'error',
            phase: 'end',
            status: 'error',
            name: 'runner.result_policy',
            summary: successPolicy.errorMessage ?? 'runner_success_policy_rejected',
            details: {
              error_code: successPolicy.errorCode ?? 'AGENT_UPSTREAM_ERROR',
              visible_agent_chars: visibleAgentCharsByRequestId.get(requestId) ?? 0,
              command_count: commandCountByRequestId.get(requestId) ?? 0,
              artifacts_count: artifacts.length,
            },
          });
          sendRunLifecycleEvent(
            requestId,
            'failed',
            'error',
            successPolicy.errorMessage ?? 'runner_success_policy_rejected',
            {
              error_code: successPolicy.errorCode ?? 'AGENT_UPSTREAM_ERROR',
              visible_agent_chars: visibleAgentCharsByRequestId.get(requestId) ?? 0,
              command_count: commandCountByRequestId.get(requestId) ?? 0,
              artifacts_count: artifacts.length,
            },
          );
          sendRunSummaryEvent(requestId, 'error', {
            reason: successPolicy.errorMessage ?? 'runner_success_policy_rejected',
            error_code: successPolicy.errorCode ?? 'AGENT_UPSTREAM_ERROR',
            visible_agent_chars: visibleAgentCharsByRequestId.get(requestId) ?? 0,
            command_count: commandCountByRequestId.get(requestId) ?? 0,
            artifacts_count: artifacts.length,
            exit_code: 0,
          });
          sendFrame('agent.response.error', requestId, {
            error_code: successPolicy.errorCode ?? 'AGENT_UPSTREAM_ERROR',
            error_message: successPolicy.errorMessage ?? 'runner_success_policy_rejected',
          });
          traceSeqByRequestId.delete(requestId);
          runStartedAtByRequestId.delete(requestId);
          filterStatsByRequestId.delete(requestId);
          reportedArtifactsByRequestId.delete(requestId);
          visibleAgentCharsByRequestId.delete(requestId);
          commandCountByRequestId.delete(requestId);
          return;
        }
        try {
          await markCodexSessionStateReusable({
            codexDir: taskPaths.codexDir,
            taskId,
          });
        } catch (error) {
          sendTraceEvent(requestId, {
            category: 'warning',
            phase: 'update',
            status: 'running',
            name: 'codex.session_state',
            summary: error instanceof Error ? error.message : 'codex_session_state_mark_failed',
          });
        }
        sendRunLifecycleEvent(requestId, 'completed', 'success', 'Run completed');
        sendRunSummaryEvent(requestId, 'success', {
          artifacts_count: artifacts.length,
          visible_agent_chars: visibleAgentCharsByRequestId.get(requestId) ?? 0,
          command_count: commandCountByRequestId.get(requestId) ?? 0,
          exit_code: 0,
        });
        sendTraceEvent(requestId, {
          category: 'progress',
          phase: 'end',
          status: 'success',
          name: 'codex.exec',
          summary: 'Codex execution completed',
        });
        sendFrame('agent.response.done', requestId, {
          finish_reason: 'stop',
          usage_tokens: Math.max(1, userPrompt.length),
        });
        traceSeqByRequestId.delete(requestId);
        runStartedAtByRequestId.delete(requestId);
        filterStatsByRequestId.delete(requestId);
        reportedArtifactsByRequestId.delete(requestId);
        visibleAgentCharsByRequestId.delete(requestId);
        commandCountByRequestId.delete(requestId);
        return;
      }
      sendTraceEvent(requestId, {
        category: signal ? 'warning' : 'error',
        phase: 'end',
        status: terminalOutcome.codexTraceStatus,
        name: 'codex.exec',
        summary: signal ? `Codex terminated (${signal})` : `Codex exited with code ${String(code ?? 'unknown')}`,
        details: {
          ...(signal ? { signal } : {}),
          ...(code !== null ? { exit_code: code } : {}),
        },
      });
      sendRunLifecycleEvent(
        requestId,
        terminalOutcome.finalStatus === 'cancelled' ? 'cancelled' : 'failed',
        terminalOutcome.finalStatus === 'cancelled' ? 'cancelled' : 'error',
        signal ? `Run cancelled (${signal})` : `Run failed with exit code ${String(code ?? 'unknown')}`,
      );
      sendRunSummaryEvent(requestId, terminalOutcome.finalStatus === 'cancelled' ? 'cancelled' : 'error', {
        ...(signal ? { signal } : {}),
        ...(code !== null ? { exit_code: code } : {}),
        artifacts_count: artifacts.length,
      });
      sendFrame('agent.response.error', requestId, {
        error_code: terminalOutcome.errorCode ?? 'AGENT_UPSTREAM_ERROR',
        error_message: terminalOutcome.errorMessage ?? `codex_exit_code_${String(code ?? 'unknown')}`,
      });
      traceSeqByRequestId.delete(requestId);
      runStartedAtByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
      reportedArtifactsByRequestId.delete(requestId);
      visibleAgentCharsByRequestId.delete(requestId);
      commandCountByRequestId.delete(requestId);
    })().catch((error) => {
      sendTraceEvent(requestId, {
        category: 'warning',
        phase: 'update',
        status: 'running',
        name: 'runner.artifact_scan',
        summary: error instanceof Error ? error.message : 'artifact_scan_failed',
      });
      sendFrame('agent.response.error', requestId, {
        error_code: 'AGENT_UPSTREAM_ERROR',
        error_message: error instanceof Error ? error.message : 'artifact_scan_failed',
      });
      sendRunLifecycleEvent(requestId, 'failed', 'error', error instanceof Error ? error.message : 'artifact_scan_failed');
      sendRunSummaryEvent(requestId, 'error', { reason: 'artifact_scan_failed' });
      traceSeqByRequestId.delete(requestId);
      runStartedAtByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
      reportedArtifactsByRequestId.delete(requestId);
      visibleAgentCharsByRequestId.delete(requestId);
      commandCountByRequestId.delete(requestId);
    });
  });
}

ws.on('open', () => {
  writeRunnerLifecycleState('connected', 'websocket_open');
  process.stdout.write('[notebook-codex-runner] connected\n');
  debugLog('websocket open', { ws_url: wsUrl });
  ws.send(
    JSON.stringify({
      type: 'agent.ready',
      timestamp: new Date().toISOString(),
      payload: {
        runner_spec: NOTEBOOK_RUNNER_SPEC,
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
        request_details: {
          executor: 'codex_cli',
          wire_api: 'responses',
        },
      },
    }),
  );
});

ws.on('message', (raw) => {
  let message: AgentMessage;
  try {
    message = JSON.parse(raw.toString('utf-8')) as AgentMessage;
  } catch {
    return;
  }

  if (runnerIsShuttingDown) {
    debugLog('ignoring server message while runner is shutting down', {
      message_type: message.type ?? null,
      request_id: message.request_id ?? null,
      terminal_session_id: message.terminal_session_id ?? null,
    });
    return;
  }

  if (message.type === 'server.hello') {
    const payload = message.payload as ServerHelloPayload | undefined;
    const nextProxyBase = normalizeProxyBase(payload?.resource_proxy?.base_url);
    if (nextProxyBase) {
      connectedResourceProxyBase = nextProxyBase;
      debugLog('received server hello resource proxy', { base_url: connectedResourceProxyBase });
    }
    return;
  }

  if (message.type === 'server.ping') {
    ws.send(
      JSON.stringify({
        type: 'agent.pong',
        timestamp: new Date().toISOString(),
        payload: {},
      }),
    );
    return;
  }

  if (message.type === 'server.request.cancel' && message.request_id) {
    debugLog('received cancel', { request_id: message.request_id });
    const child = runningByRequestId.get(message.request_id);
    if (child && child.exitCode === null) {
      if (cancelRequestedByRequestId.has(message.request_id)) return;
      cancelRequestedByRequestId.add(message.request_id);
      sendTraceEvent(message.request_id, {
        category: 'warning',
        phase: 'update',
        status: 'running',
        name: 'run.cancel',
        summary: `Cancellation requested by server (grace ${Math.round(cancelKillDelayMs / 1000)}s)`,
      });
      sendRunLifecycleEvent(message.request_id, 'running', 'running', 'Cancellation requested', {
        cancel_requested: true,
      });
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, cancelKillDelayMs);
    }
    return;
  }

  if (message.type === 'server.terminal.stdin' && message.terminal_session_id) {
    const child = runningTerminalBySessionId.get(message.terminal_session_id);
    const payload = message.payload as { data?: unknown } | undefined;
    if (child && child.exitCode === null && typeof payload?.data === 'string') {
      child.write(payload.data);
    }
    return;
  }

  if (message.type === 'server.terminal.resize' && message.terminal_session_id) {
    const child = runningTerminalBySessionId.get(message.terminal_session_id);
    const payload = message.payload as { cols?: unknown; rows?: unknown } | undefined;
    if (child && child.exitCode === null) {
      const cols = typeof payload?.cols === 'number' && Number.isFinite(payload.cols) ? Math.max(1, Math.floor(payload.cols)) : null;
      const rows = typeof payload?.rows === 'number' && Number.isFinite(payload.rows) ? Math.max(1, Math.floor(payload.rows)) : null;
      if (cols !== null && rows !== null) {
        child.resize(cols, rows);
      }
    }
    return;
  }

  if (message.type === 'server.terminal.close' && message.terminal_session_id) {
    closeTerminalSession(message.terminal_session_id);
    return;
  }

  if (message.type === 'server.terminal.start' && message.terminal_session_id) {
    if (runningTerminalBySessionId.has(message.terminal_session_id)) {
      sendTerminalFrame('agent.terminal.error', message.terminal_session_id, {
        error_code: 'AGENT_TERMINAL_ALREADY_RUNNING',
        error_message: 'terminal_session_already_running',
      });
      return;
    }
    const terminalPayload = message.payload as {
      cols?: number;
      rows?: number;
      shell?: string;
      execution_context?: TerminalExecutionContext;
    } | undefined;
    void runTerminalSession(message.terminal_session_id, terminalPayload ?? {}).catch((error) => {
      runningTerminalBySessionId.delete(message.terminal_session_id!);
      sendTerminalFrame('agent.terminal.error', message.terminal_session_id!, {
        error_code: 'AGENT_UPSTREAM_ERROR',
        error_message: error instanceof Error ? error.message : 'terminal_start_failed',
      });
    });
    return;
  }

  if (message.type !== 'server.request.start' || !message.request_id || !message.payload) {
    return;
  }
  const startPayload = message.payload as ServerStartPayload;
  runStartedAtByRequestId.set(message.request_id, Date.now());
  sendRunLifecycleEvent(message.request_id, 'queued', 'running', 'Run queued');
  const executionContext = startPayload.execution_context as {
    model?: string;
    wire_api?: string;
    task_id?: string;
    workspace_binding_mode?: string;
    workspace_file_library_id?: string;
    workspace_dir_name?: string;
  } | undefined;
  debugLog('received start', {
    request_id: message.request_id,
    model: executionContext?.model ?? startPayload.model ?? null,
    wire_api: executionContext?.wire_api ?? null,
    task_id: executionContext?.task_id ?? null,
    workspace_binding_mode: executionContext?.workspace_binding_mode ?? null,
    workspace_file_library_id: executionContext?.workspace_file_library_id ?? null,
    workspace_dir_name: executionContext?.workspace_dir_name ?? null,
  });

  void runCodexRequest(message.request_id, startPayload).catch((error) => {
    debugLog('request start failed', {
      request_id: message.request_id!,
      error: error instanceof Error ? error.message : 'codex_request_failed',
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    sendRunLifecycleEvent(
      message.request_id!,
      'failed',
      'error',
      error instanceof Error ? error.message : 'codex_request_failed',
    );
    sendRunSummaryEvent(message.request_id!, 'error', { reason: 'request_start_failed' });
    sendTraceEvent(message.request_id!, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.exec',
      summary: error instanceof Error ? error.message : 'codex_request_failed',
    });
    sendFrame('agent.response.error', message.request_id!, {
      error_code: 'AGENT_UPSTREAM_ERROR',
      error_message: error instanceof Error ? error.message : 'codex_request_failed',
    });
    runStartedAtByRequestId.delete(message.request_id!);
  });
});

ws.on('close', () => {
  void shutdownRunner('websocket_close');
});

ws.on('error', (error) => {
  process.stderr.write(`[notebook-codex-runner] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
});

process.once('SIGINT', () => {
  void shutdownRunner('sigint');
});

process.once('SIGTERM', () => {
  void shutdownRunner('sigterm');
});
