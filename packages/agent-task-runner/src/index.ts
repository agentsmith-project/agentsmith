import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import {
  buildCodexExecArgs,
  buildTaskCodexConfig,
  buildTaskCodexModelCatalog,
  resolveModelAutoCompactTokenLimit,
} from './codex-command-builder.js';
import { sanitizeAgentDeltaChunk, sanitizeStderrChunk, type RunnerFilterStats } from './codex-output-filter.js';
import {
  buildTaskHeadlessPreamble,
  prepareTaskWorkspaceAssets,
} from './task-assets.js';
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
import {
  startTerminalProcess,
  terminateTerminalProcessTree,
  type TerminalExecutionContext,
  type TerminalProcess,
  type TerminalProcessTreeTerminationResult,
} from './terminal-runtime.js';
import { prepareLaunchCommand } from './child-launcher.js';
import { buildAgentRuntimeEnv } from './agent-runtime-env.js';
import { buildTaskUserInstallEnv } from './user-install-env.js';
import { installAgentTaskRunnerProcessIdentity } from './task-workspace-ownership.js';
import {
  assertTaskExecutionContext,
  AGENT_TASK_RUNNER_SPEC,
  type AgentServerStartPayload,
  type AgentWireApi,
} from '@mbos/agent-runner';

type ServerStartPayload = AgentServerStartPayload;

type ServerHelloPayload = {
  protocol_version?: string;
  heartbeat_interval_sec?: number;
};

type AgentMessage = {
  type?: string;
  request_id?: string;
  runner_session_id?: string;
  terminal_session_id?: string;
  payload?: unknown;
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
const resolvedRunnerInstanceId = runnerInstanceId || `runner_${randomUUID().replace(/-/g, '')}`;
const fallbackRunnerSessionId = (
  process.env.MBOS_AGENT_RUNNER_SESSION_ID
  ?? runnerInstanceId
  ?? 'runner_session_default'
).trim() || 'runner_session_default';
const reconnectBaseDelayMs = readPositiveIntegerEnv('MBOS_AGENT_RECONNECT_BASE_MS', 500);
const reconnectMaxDelayMs = Math.max(
  reconnectBaseDelayMs,
  readPositiveIntegerEnv('MBOS_AGENT_RECONNECT_MAX_MS', 15_000),
);
const terminalCloseGraceMs = readPositiveIntegerEnv('NOTEBOOK_TERMINAL_CLOSE_GRACE_MS', cancelKillDelayMs);

if (runnerInstanceId) {
  installAgentTaskRunnerProcessIdentity(runnerInstanceId);
}

if (!wsUrl || !key) {
  process.stderr.write(
    'Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx [CODEX_BIN=codex] npm run dev -w @mbos/agent-task-runner\n',
  );
  process.exit(1);
}

type RunningProcess = ChildProcessByStdio<null, Readable, Readable>;
const runningByRequestId = new Map<string, RunningProcess>();
const runningTerminalBySessionId = new Map<string, TerminalProcess>();
const cancelRequestedByRequestId = new Set<string>();
const suppressFramesByRequestId = new Set<string>();
const traceSeqByRequestId = new Map<string, number>();
const runStartedAtByRequestId = new Map<string, number>();
const reportedArtifactsByRequestId = new Map<string, Set<string>>();
const visibleAgentCharsByRequestId = new Map<string, number>();
const commandCountByRequestId = new Map<string, number>();
const emittedFinalAgentMessageByRequestId = new Set<string>();
const finalAgentMessageCandidateByRequestId = new Map<string, string>();
type StandardResponsesTextState = {
  emittedText: string;
  sawDelta: boolean;
  doneSeen: boolean;
};
const standardResponsesTextStateByRequestId = new Map<string, StandardResponsesTextState>();
type FilterStats = RunnerFilterStats;
const filterStatsByRequestId = new Map<string, FilterStats>();
let runnerShutdownPromise: Promise<void> | null = null;
let runnerIsShuttingDown = false;
let activeWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let lastConnectionEpoch = 0;
const connectionEpochBySocket = new WeakMap<WebSocket, number>();

type ShutdownReason = 'sigint' | 'sigterm' | 'operator_shutdown' | 'runner_process_exit';
type RunnerLifecycleState = 'connected' | 'reconnecting' | 'shutting_down' | 'disconnected';
type TerminalCloseAttempt = {
  requestId: string;
  closeAttemptId: string;
  connectionEpoch: number | null;
  generation: number | null;
  runnerSessionId: string | null;
  reason: string;
};
type ValidTerminalCloseAttempt = TerminalCloseAttempt & {
  connectionEpoch: number;
  generation: number;
  runnerSessionId: string;
};
type TerminalExitEvidence = {
  terminalSessionId: string;
  runnerSessionId: string;
  generation: number;
  cols: number;
  rows: number;
  cwd: string;
  exitCode: number | null;
  signal: string | number | null;
};
type ActiveTerminalEntry = {
  terminalSessionId: string;
  runnerSessionId: string;
  generation: number;
  cols: number;
  rows: number;
  cwd: string;
  connectionEpoch: number | null;
  child: TerminalProcess;
  closeAttempt: TerminalCloseAttempt | null;
  closePromise: Promise<void> | null;
  attachedToTransport: boolean;
};
const activeTerminalBySessionId = new Map<string, ActiveTerminalEntry>();
const exitedTerminalBySessionId = new Map<string, TerminalExitEvidence>();

function getFilterStats(requestId: string): FilterStats {
  const existing = filterStatsByRequestId.get(requestId);
  if (existing) return existing;
  const created: FilterStats = {
    stderr_superpowers_skill_missing: 0,
    model_metadata_warning: 0,
    stderr_model_refresh_timeout: 0,
    stderr_rollout_record_missing_thread: 0,
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

function positiveInteger(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return undefined;
  }
  return Math.floor(input);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  if (Number.isFinite(value) && value > 0) return Math.floor(value);
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringFieldFromRecord(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readPositiveIntegerField(record: Record<string, unknown>, field: string): number | undefined {
  return positiveInteger(record[field]);
}

function readIntegerField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function resolveRunnerSessionId(
  message: Pick<AgentMessage, 'runner_session_id'>,
  payload: Record<string, unknown>,
): string {
  return (
    (typeof message.runner_session_id === 'string' && message.runner_session_id.trim()
      ? message.runner_session_id.trim()
      : undefined)
    ?? readStringFieldFromRecord(payload, 'runner_session_id')
    ?? fallbackRunnerSessionId
  );
}

function readRunnerSessionIdWithoutFallback(
  message: Pick<AgentMessage, 'runner_session_id'>,
  payload: Record<string, unknown>,
): string | null {
  const fromMessage = typeof message.runner_session_id === 'string' && message.runner_session_id.trim()
    ? message.runner_session_id.trim()
    : null;
  if (fromMessage) return fromMessage;
  return readStringFieldFromRecord(payload, 'runner_session_id') ?? null;
}

function canSendOnSocket(socket: WebSocket | null): socket is WebSocket {
  if (!socket) return false;
  const readyState = (socket as { readyState?: number }).readyState;
  return readyState === undefined || readyState === WebSocket.OPEN;
}

function canSendRunnerFrame(): boolean {
  if (runnerIsShuttingDown) return false;
  return canSendOnSocket(activeWs);
}

function sendRawFrameOnSocket(socket: WebSocket | null, frame: Record<string, unknown>): boolean {
  if (!canSendOnSocket(socket)) return false;
  socket.send(JSON.stringify(frame));
  return true;
}

function sendRawFrameBestEffort(socket: WebSocket | null, frame: Record<string, unknown>): boolean {
  if (!socket) return false;
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch (error) {
    debugLog('best-effort websocket send failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function sendRawFrame(frame: Record<string, unknown>): boolean {
  if (!canSendRunnerFrame()) return false;
  return sendRawFrameOnSocket(activeWs, frame);
}

function assignConnectionEpoch(socket: WebSocket): number {
  lastConnectionEpoch += 1;
  connectionEpochBySocket.set(socket, lastConnectionEpoch);
  return lastConnectionEpoch;
}

function readConnectionEpoch(socket: WebSocket): number {
  const existing = connectionEpochBySocket.get(socket);
  if (existing !== undefined) return existing;
  return assignConnectionEpoch(socket);
}

function sendFrame(type: string, requestId: string, payload: Record<string, unknown>) {
  if (suppressFramesByRequestId.has(requestId)) return;
  sendRawFrame({
    type,
    request_id: requestId,
    timestamp: new Date().toISOString(),
    payload,
  });
}

function sendTerminalFrame(
  type: string,
  terminalSessionId: string,
  payload: Record<string, unknown>,
  options: {
    requestId?: string;
    runnerSessionId?: string;
  } = {},
) {
  sendRawFrame({
    type,
    ...(options.requestId ? { request_id: options.requestId } : {}),
    ...(options.runnerSessionId ? { runner_session_id: options.runnerSessionId } : {}),
    terminal_session_id: terminalSessionId,
    timestamp: new Date().toISOString(),
    payload: {
      terminal_session_id: terminalSessionId,
      ...(options.runnerSessionId ? { runner_session_id: options.runnerSessionId } : {}),
      ...payload,
    },
  });
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
  process.stdout.write(`[agent-task-runner][debug] ${message}${payload}\n`);
}

function createPreparedTaskWorkspaceReleaseOnce(
  requestId: string,
  release: () => Promise<void>,
): () => Promise<void> {
  let releasePromise: Promise<void> | null = null;
  return () => {
    if (releasePromise) {
      return releasePromise;
    }
    releasePromise = release().catch((error) => {
      debugLog('prepared task workspace release failed', {
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return releasePromise;
  };
}

function writeRunnerLifecycleState(state: RunnerLifecycleState, reason: string): void {
  process.stdout.write(`[agent-task-runner] runner_state=${state} reason=${reason}\n`);
}

function shutdownExitCode(reason: ShutdownReason): number {
  return reason === 'runner_process_exit' ? 1 : 0;
}

function clearRunnerState(): void {
  runningByRequestId.clear();
  runningTerminalBySessionId.clear();
  cancelRequestedByRequestId.clear();
  suppressFramesByRequestId.clear();
  traceSeqByRequestId.clear();
  runStartedAtByRequestId.clear();
  reportedArtifactsByRequestId.clear();
  visibleAgentCharsByRequestId.clear();
  commandCountByRequestId.clear();
  emittedFinalAgentMessageByRequestId.clear();
  finalAgentMessageCandidateByRequestId.clear();
  standardResponsesTextStateByRequestId.clear();
  filterStatsByRequestId.clear();
  activeTerminalBySessionId.clear();
  exitedTerminalBySessionId.clear();
}

function clearRequestRuntimeState(requestId: string): void {
  runningByRequestId.delete(requestId);
  cancelRequestedByRequestId.delete(requestId);
  suppressFramesByRequestId.delete(requestId);
  traceSeqByRequestId.delete(requestId);
  runStartedAtByRequestId.delete(requestId);
  filterStatsByRequestId.delete(requestId);
  reportedArtifactsByRequestId.delete(requestId);
  visibleAgentCharsByRequestId.delete(requestId);
  commandCountByRequestId.delete(requestId);
  emittedFinalAgentMessageByRequestId.delete(requestId);
  finalAgentMessageCandidateByRequestId.delete(requestId);
  standardResponsesTextStateByRequestId.delete(requestId);
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
  if (child.exitCode !== null) {
    await child.waitForWorkspaceRelease();
    return;
  }
  const result = await terminateTerminalProcessTree(child, {
    terminalSessionId,
    graceMs: terminalCloseGraceMs,
    hardKillGraceMs: terminalCloseGraceMs,
    reason: 'shutdown',
  });
  if (result.outcome !== 'terminated') {
    debugLog('terminal process tree termination incomplete during shutdown', {
      terminal_session_id: terminalSessionId,
      outcome: result.outcome,
      diagnostic_code: result.diagnosticCode,
      remaining_pid_count: result.remainingPids.length,
    });
    return;
  }
  await child.waitForWorkspaceRelease();
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

async function terminateActiveCodexProcessesForTransportLost(): Promise<void> {
  const codexProcesses = Array.from(runningByRequestId.entries()).map(([requestId, child]) => {
    suppressFramesByRequestId.add(requestId);
    return terminateCodexProcess(requestId, child);
  });
  await Promise.all(codexProcesses);
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function nextReconnectDelayMs(): number {
  const exponentialDelay = reconnectBaseDelayMs * (2 ** Math.min(reconnectAttempt, 6));
  const cappedDelay = Math.min(reconnectMaxDelayMs, exponentialDelay);
  const jitter = Math.floor(cappedDelay * 0.2 * Math.random());
  reconnectAttempt += 1;
  return Math.min(reconnectMaxDelayMs, cappedDelay + jitter);
}

function scheduleReconnect(reason: string): void {
  if (runnerIsShuttingDown || reconnectTimer) return;
  const delayMs = nextReconnectDelayMs();
  debugLog('scheduling websocket reconnect', { reason, delay_ms: delayMs, attempt: reconnectAttempt });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delayMs);
  // Keep unexpected transport-loss reconnects ref'ed so Node does not exit
  // before the runner can reattach to the task control channel.
}

function handleTransportLost(reason: 'websocket_close'): void {
  writeRunnerLifecycleState('reconnecting', reason);
  for (const entry of activeTerminalBySessionId.values()) {
    entry.attachedToTransport = false;
  }
  void terminateActiveCodexProcessesForTransportLost().catch((error) => {
    debugLog('transport lost codex termination failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  scheduleReconnect(reason);
}

function closeWebSocketForShutdown(socket: WebSocket | null): void {
  if (socket === activeWs) {
    activeWs = null;
  }
  try {
    if (socket && typeof socket.close === 'function') {
      socket.close();
    }
  } catch (error) {
    debugLog('websocket close during shutdown failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sendShutdownFrame(reason: ShutdownReason, socket: WebSocket | null): void {
  sendRawFrameBestEffort(socket, {
    type: 'agent.shutdown',
    timestamp: new Date().toISOString(),
    payload: {
      reason,
      terminal_processes_terminated: true,
    },
  });
}

async function shutdownRunner(reason: ShutdownReason): Promise<void> {
  if (runnerShutdownPromise) {
    return runnerShutdownPromise;
  }
  runnerIsShuttingDown = true;
  clearReconnectTimer();
  const shutdownSocket = activeWs;
  runnerShutdownPromise = (async () => {
    writeRunnerLifecycleState('shutting_down', reason);
    process.stdout.write(`[agent-task-runner] shutting down (${reason})\n`);
    await terminateActiveRunnerProcesses();
    sendShutdownFrame(reason, shutdownSocket);
    closeWebSocketForShutdown(shutdownSocket);
    try {
      await releaseAllPreparedTaskWorkspaces();
    } catch (error) {
      process.stderr.write(
        `[agent-task-runner] shutdown cleanup failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
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

function sendTerminalCloseAck(
  terminalSessionId: string,
  attempt: TerminalCloseAttempt,
  status: 'closed' | 'not_found' | 'error',
  details: {
    exitCode?: number | null;
    signal?: string | number | null;
    errorCode?: string | null;
    diagnosticCode?: string | null;
    message?: string | null;
    remainingPidCount?: number;
    remainingPids?: number[];
    pidMetadata?: TerminalProcess['pidMetadata'] | null;
    terminationResult?: TerminalProcessTreeTerminationResult | null;
  } = {},
): void {
  const terminationResult = details.terminationResult ?? null;
  const remainingPids = terminationResult?.remainingPids ?? details.remainingPids ?? [];
  const remainingPidCount = terminationResult?.remainingPids.length ?? details.remainingPidCount ?? remainingPids.length;
  const diagnosticCode = details.diagnosticCode ?? terminationResult?.diagnosticCode ?? details.errorCode ?? null;
  debugLog('terminal close ack send', {
    terminal_session_id: terminalSessionId,
    runner_session_id: attempt.runnerSessionId,
    request_id: attempt.requestId,
    close_attempt_id: attempt.closeAttemptId,
    generation: attempt.generation,
    connection_epoch: attempt.connectionEpoch,
    status,
    remaining_pid_count: remainingPidCount,
    diagnostic_code: diagnosticCode,
  });
  sendTerminalFrame('agent.terminal.close_ack', terminalSessionId, {
    close_attempt_id: attempt.closeAttemptId,
    connection_epoch: attempt.connectionEpoch,
    generation: attempt.generation,
    runner_session_id: attempt.runnerSessionId,
    status,
    exit_code: details.exitCode ?? null,
    signal: details.signal ?? null,
    error_code: details.errorCode ?? null,
    diagnostic_code: diagnosticCode,
    message: details.message ?? null,
    remaining_pid_count: remainingPidCount,
    remaining_pids: remainingPids.slice(0, 20),
    root_pid: terminationResult?.rootPid ?? details.pidMetadata?.rootPid ?? null,
    pty_pid: terminationResult?.ptyPid ?? details.pidMetadata?.ptyPid ?? null,
    pgid: terminationResult?.pgid ?? details.pidMetadata?.pgid ?? null,
    sid: terminationResult?.sid ?? details.pidMetadata?.sid ?? null,
    signal_sequence: terminationResult?.signalSequence ?? [],
    duration_ms: terminationResult?.durationMs ?? null,
    diagnostics: terminationResult?.diagnostics ?? [],
  }, {
    requestId: attempt.requestId,
    runnerSessionId: attempt.runnerSessionId ?? undefined,
  });
}

function remainingPidEvidenceForTerminal(child: TerminalProcess | undefined): {
  remainingPidCount: number;
  remainingPids: number[];
  pidMetadata: TerminalProcess['pidMetadata'] | null;
} {
  if (!child || child.exitCode !== null) {
    return {
      remainingPidCount: 0,
      remainingPids: [],
      pidMetadata: child?.pidMetadata ?? null,
    };
  }
  const rootPid = positiveInteger(child.pidMetadata.rootPid) ?? positiveInteger(child.pidMetadata.ptyPid);
  return {
    remainingPidCount: 1,
    remainingPids: rootPid === undefined ? [] : [rootPid],
    pidMetadata: child.pidMetadata,
  };
}

async function closeTerminalSession(
  terminalSessionId: string,
  closeAttempt: ValidTerminalCloseAttempt | null = null,
): Promise<void> {
  const entry = activeTerminalBySessionId.get(terminalSessionId);
  const child = entry?.child ?? runningTerminalBySessionId.get(terminalSessionId);
  if (!child || child.exitCode !== null) {
    if (child) {
      await child.waitForWorkspaceRelease();
    }
    if (closeAttempt) {
      sendTerminalCloseAck(terminalSessionId, closeAttempt, 'not_found');
    }
    return;
  }
  if (!closeAttempt) {
    await terminateTerminalProcess(terminalSessionId, child);
    return;
  }
  if (entry && closeAttempt) {
    entry.closeAttempt = closeAttempt;
    if (entry.closePromise) {
      return entry.closePromise;
    }
  }
  const closePromise = (async () => {
    let result: TerminalProcessTreeTerminationResult;
    try {
      result = await terminateTerminalProcessTree(child, {
        terminalSessionId,
        runnerSessionId: closeAttempt.runnerSessionId,
        generation: closeAttempt.generation,
        reason: closeAttempt.reason,
        graceMs: terminalCloseGraceMs,
        hardKillGraceMs: terminalCloseGraceMs,
      });
    } catch (error) {
      sendTerminalCloseAck(terminalSessionId, closeAttempt, 'error', {
        errorCode: 'AGENT_TERMINAL_CLOSE_FAILED',
        diagnosticCode: 'terminal_process_tree_termination_exception',
        message: error instanceof Error ? error.message : 'terminal_close_failed',
      });
      return;
    }
    if (result.outcome === 'terminated') {
      await child.waitForWorkspaceRelease();
      sendTerminalCloseAck(terminalSessionId, closeAttempt, 'closed', {
        exitCode: child.exitCode,
        signal: null,
        terminationResult: result,
      });
      return;
    }
    if (result.outcome === 'not_found') {
      await child.waitForWorkspaceRelease();
      sendTerminalCloseAck(terminalSessionId, closeAttempt, 'not_found', {
        terminationResult: result,
      });
      return;
    }
    sendTerminalCloseAck(terminalSessionId, closeAttempt, 'error', {
      errorCode: 'AGENT_TERMINAL_CLOSE_FAILED',
      diagnosticCode: result.diagnosticCode ?? 'terminal_process_tree_remaining',
      message: result.diagnosticCode ?? 'terminal_close_failed',
      terminationResult: result,
    });
  })().finally(() => {
    if (entry) {
      entry.closePromise = null;
    }
  });
  if (entry) {
    entry.closePromise = closePromise;
  }
  await closePromise;
}

async function runTerminalSession(terminalSessionId: string, payload: {
  cols?: number;
  rows?: number;
  shell?: string;
  generation?: number;
  runner_session_id?: string;
  execution_context?: TerminalExecutionContext;
}, metadata: {
  runnerSessionId?: string;
} = {}): Promise<void> {
  debugLog('terminal start requested', {
    terminal_session_id: terminalSessionId,
    has_execution_context: !!payload.execution_context,
    shell: payload.shell ?? null,
  });
  const executionContext = (payload.execution_context ?? {}) as TerminalExecutionContext;
  const cols = positiveInteger(payload.cols) ?? 120;
  const rows = positiveInteger(payload.rows) ?? 30;
  const generation = positiveInteger(payload.generation) ?? 1;
  const runnerSessionId = (metadata.runnerSessionId ?? payload.runner_session_id ?? fallbackRunnerSessionId).trim()
    || fallbackRunnerSessionId;
  const connectionEpoch = activeWs ? readConnectionEpoch(activeWs) : null;
  const started = await startTerminalProcess({
    executionContext,
    shell: payload.shell,
    cols,
    rows,
  });
  const child = started.child;
  runningTerminalBySessionId.set(terminalSessionId, child);
  exitedTerminalBySessionId.delete(terminalSessionId);
  const entry: ActiveTerminalEntry = {
    terminalSessionId,
    runnerSessionId,
    generation,
    cols,
    rows,
    cwd: started.cwd,
    connectionEpoch,
    child,
    closeAttempt: null,
    closePromise: null,
    attachedToTransport: true,
  };
  activeTerminalBySessionId.set(terminalSessionId, entry);
  debugLog('terminal started', {
    terminal_session_id: terminalSessionId,
    cwd: started.cwd,
  });
  sendTerminalFrame('agent.terminal.started', terminalSessionId, {
    runner_session_id: runnerSessionId,
    generation,
    connection_epoch: connectionEpoch,
    cols,
    rows,
    cwd: started.cwd,
  }, {
    runnerSessionId,
  });

  child.onData((chunk) => {
    if (!entry.attachedToTransport) return;
    sendTerminalFrame('agent.terminal.output', terminalSessionId, {
      chunk,
    });
  });
  child.onExit(({ exitCode, signal }) => {
    runningTerminalBySessionId.delete(terminalSessionId);
    activeTerminalBySessionId.delete(terminalSessionId);
    const exitEvidence: TerminalExitEvidence = {
      terminalSessionId,
      runnerSessionId: entry.runnerSessionId,
      generation: entry.generation,
      cols: entry.cols,
      rows: entry.rows,
      cwd: entry.cwd,
      exitCode,
      signal: signal ?? null,
    };
    exitedTerminalBySessionId.set(terminalSessionId, exitEvidence);
    debugLog('terminal exited', {
      terminal_session_id: terminalSessionId,
      exit_code: exitCode,
      signal: signal ?? null,
    });
    if (entry.attachedToTransport || entry.closeAttempt) {
      sendTerminalFrame('agent.terminal.exited', terminalSessionId, {
        runner_session_id: entry.runnerSessionId,
        generation: entry.generation,
        exit_code: exitCode,
        signal: signal ?? null,
      }, {
        runnerSessionId: entry.runnerSessionId,
      });
    }
  });
}

function listActiveTerminalDescriptors(connectionEpoch: number | null = null): Array<Record<string, unknown>> {
  return Array.from(activeTerminalBySessionId.values())
    .filter((entry) => entry.child.exitCode === null)
    .map((entry) => ({
      terminal_session_id: entry.terminalSessionId,
      runner_session_id: entry.runnerSessionId,
      generation: entry.generation,
      connection_epoch: connectionEpoch ?? entry.connectionEpoch,
      cols: entry.cols,
      rows: entry.rows,
      cwd: entry.cwd,
    }));
}

function readAdoptOrCloseAttempt(
  message: AgentMessage,
  payload: Record<string, unknown>,
  attemptField: 'adopt_attempt_id' | 'close_attempt_id',
): {
  requestId: string;
  attemptId: string;
  connectionEpoch: number | null;
  generation: number | null;
  runnerSessionId: string;
} {
  const requestId = (
    typeof message.request_id === 'string' && message.request_id.trim()
      ? message.request_id.trim()
      : undefined
  ) ?? readStringFieldFromRecord(payload, attemptField) ?? `${attemptField}_${Date.now()}`;
  return {
    requestId,
    attemptId: readStringFieldFromRecord(payload, attemptField) ?? requestId,
    connectionEpoch: readPositiveIntegerField(payload, 'connection_epoch') ?? null,
    generation: readPositiveIntegerField(payload, 'generation') ?? null,
    runnerSessionId: resolveRunnerSessionId(message, payload),
  };
}

function readTerminalCloseAttempt(
  message: AgentMessage,
  payload: Record<string, unknown>,
): {
  attempt: TerminalCloseAttempt;
  diagnosticCode: string | null;
} {
  const requestId = (
    typeof message.request_id === 'string' && message.request_id.trim()
      ? message.request_id.trim()
      : undefined
  ) ?? readStringFieldFromRecord(payload, 'close_attempt_id') ?? `close_attempt_id_${Date.now()}`;
  const hasGeneration = Object.prototype.hasOwnProperty.call(payload, 'generation');
  const hasConnectionEpoch = Object.prototype.hasOwnProperty.call(payload, 'connection_epoch');
  const generation = hasGeneration ? readIntegerField(payload, 'generation') : null;
  const connectionEpoch = hasConnectionEpoch ? readIntegerField(payload, 'connection_epoch') : null;
  const runnerSessionId = readRunnerSessionIdWithoutFallback(message, payload);
  let diagnosticCode: string | null = null;
  if (!runnerSessionId || !hasGeneration || !hasConnectionEpoch || generation === null || connectionEpoch === null) {
    diagnosticCode = 'missing_runtime_identity';
  } else if (generation <= 0) {
    diagnosticCode = 'non_positive_generation';
  } else if (connectionEpoch <= 0) {
    diagnosticCode = 'non_positive_connection_epoch';
  }
  return {
    attempt: {
      requestId,
      closeAttemptId: readStringFieldFromRecord(payload, 'close_attempt_id') ?? requestId,
      connectionEpoch,
      generation,
      runnerSessionId,
      reason: readStringFieldFromRecord(payload, 'reason') ?? 'user_requested',
    },
    diagnosticCode,
  };
}

function isValidTerminalCloseAttempt(attempt: TerminalCloseAttempt): attempt is ValidTerminalCloseAttempt {
  return typeof attempt.runnerSessionId === 'string'
    && attempt.runnerSessionId.trim().length > 0
    && typeof attempt.generation === 'number'
    && Number.isInteger(attempt.generation)
    && attempt.generation > 0
    && typeof attempt.connectionEpoch === 'number'
    && Number.isInteger(attempt.connectionEpoch)
    && attempt.connectionEpoch > 0;
}

function sendTerminalAdopted(
  terminalSessionId: string,
  entry: ActiveTerminalEntry,
  request: {
    requestId: string;
    attemptId: string;
    connectionEpoch: number | null;
  },
): void {
  sendTerminalFrame('agent.terminal.adopted', terminalSessionId, {
    adopt_attempt_id: request.attemptId,
    connection_epoch: request.connectionEpoch,
    runner_session_id: entry.runnerSessionId,
    generation: entry.generation,
    cols: entry.cols,
    rows: entry.rows,
    cwd: entry.cwd,
  }, {
    requestId: request.requestId,
    runnerSessionId: entry.runnerSessionId,
  });
}

function sendTerminalAdoptNotFound(
  terminalSessionId: string,
  request: {
    requestId: string;
    attemptId: string;
    connectionEpoch: number | null;
    generation: number | null;
    runnerSessionId: string;
  },
): void {
  sendTerminalFrame('agent.terminal.not_found', terminalSessionId, {
    adopt_attempt_id: request.attemptId,
    connection_epoch: request.connectionEpoch,
    runner_session_id: request.runnerSessionId,
    generation: request.generation,
  }, {
    requestId: request.requestId,
    runnerSessionId: request.runnerSessionId,
  });
}

function sendTerminalAdoptExited(
  terminalSessionId: string,
  evidence: TerminalExitEvidence,
  request: {
    requestId: string;
    attemptId: string;
    connectionEpoch: number | null;
  },
): void {
  sendTerminalFrame('agent.terminal.exited', terminalSessionId, {
    adopt_attempt_id: request.attemptId,
    connection_epoch: request.connectionEpoch,
    runner_session_id: evidence.runnerSessionId,
    generation: evidence.generation,
    cols: evidence.cols,
    rows: evidence.rows,
    cwd: evidence.cwd,
    exit_code: evidence.exitCode,
    signal: evidence.signal,
  }, {
    requestId: request.requestId,
    runnerSessionId: evidence.runnerSessionId,
  });
}

function sendTerminalAdoptError(
  terminalSessionId: string,
  request: {
    requestId: string;
    attemptId: string;
    connectionEpoch: number | null;
    runnerSessionId: string;
    generation: number | null;
  },
  errorCode: string,
  errorMessage: string,
): void {
  sendTerminalFrame('agent.terminal.error', terminalSessionId, {
    adopt_attempt_id: request.attemptId,
    connection_epoch: request.connectionEpoch,
    runner_session_id: request.runnerSessionId,
    generation: request.generation,
    error_code: errorCode,
    error_message: errorMessage,
  }, {
    requestId: request.requestId,
    runnerSessionId: request.runnerSessionId,
  });
}

function handleTerminalAdopt(message: AgentMessage): void {
  if (!message.terminal_session_id) return;
  const payload = isRecord(message.payload) ? message.payload : {};
  const request = readAdoptOrCloseAttempt(message, payload, 'adopt_attempt_id');
  const entry = activeTerminalBySessionId.get(message.terminal_session_id);
  if (!entry || entry.child.exitCode !== null) {
    const exitEvidence = exitedTerminalBySessionId.get(message.terminal_session_id);
    if (exitEvidence) {
      sendTerminalAdoptExited(message.terminal_session_id, exitEvidence, request);
      return;
    }
    sendTerminalAdoptNotFound(message.terminal_session_id, request);
    return;
  }

  if (
    entry.runnerSessionId !== request.runnerSessionId
    || request.generation == null
    || entry.generation !== request.generation
  ) {
    sendTerminalAdoptError(
      message.terminal_session_id,
      request,
      'AGENT_TERMINAL_ADOPT_STALE',
      'terminal_adopt_stale',
    );
    return;
  }

  if (entry.closeAttempt) {
    sendTerminalAdoptError(
      message.terminal_session_id,
      request,
      'AGENT_TERMINAL_CLOSING',
      'terminal_close_in_progress',
    );
    return;
  }

  const cols = readPositiveIntegerField(payload, 'cols');
  const rows = readPositiveIntegerField(payload, 'rows');
  if (cols !== undefined && rows !== undefined) {
    entry.child.resize(cols, rows);
    entry.cols = cols;
    entry.rows = rows;
  }
  entry.attachedToTransport = true;
  sendTerminalAdopted(message.terminal_session_id, entry, request);
}

async function handleTerminalClose(message: AgentMessage): Promise<void> {
  if (!message.terminal_session_id) return;
  const payload = isRecord(message.payload) ? message.payload : {};
  const { attempt: closeAttempt, diagnosticCode } = readTerminalCloseAttempt(message, payload);
  const entry = activeTerminalBySessionId.get(message.terminal_session_id);
  const child = entry?.child ?? runningTerminalBySessionId.get(message.terminal_session_id);
  if (diagnosticCode || !isValidTerminalCloseAttempt(closeAttempt)) {
    sendTerminalCloseAck(message.terminal_session_id, closeAttempt, 'error', {
      errorCode: 'AGENT_TERMINAL_CLOSE_INVALID_FENCE',
      diagnosticCode: diagnosticCode ?? 'missing_runtime_identity',
      message: diagnosticCode ?? 'missing_runtime_identity',
      ...remainingPidEvidenceForTerminal(child),
    });
    return;
  }
  if (
    entry
    && entry.child.exitCode === null
    && (entry.runnerSessionId !== closeAttempt.runnerSessionId || entry.generation !== closeAttempt.generation)
  ) {
    sendTerminalCloseAck(message.terminal_session_id, closeAttempt, 'error', {
      errorCode: 'AGENT_TERMINAL_CLOSE_STALE',
      message: 'terminal_close_stale',
    });
    return;
  }
  await closeTerminalSession(message.terminal_session_id, closeAttempt);
}

function maybeEmitDeltaChunk(requestId: string, chunk: string): number {
  const trimmed = sanitizeAgentDeltaChunk(chunk, () => getFilterStats(requestId)).replace(/\r/g, '');
  if (!trimmed.trim()) return 0;
  sendFrame('agent.response.delta', requestId, { delta: trimmed });
  return trimmed.length;
}

function emitDeltaChunkAndTrackVisibleChars(requestId: string, chunk: string): number {
  const emitted = maybeEmitDeltaChunk(requestId, chunk);
  if (emitted > 0) {
    visibleAgentCharsByRequestId.set(requestId, (visibleAgentCharsByRequestId.get(requestId) ?? 0) + emitted);
  }
  return emitted;
}

function getStandardResponsesTextState(requestId: string): StandardResponsesTextState {
  const existing = standardResponsesTextStateByRequestId.get(requestId);
  if (existing) return existing;
  const created: StandardResponsesTextState = {
    emittedText: '',
    sawDelta: false,
    doneSeen: false,
  };
  standardResponsesTextStateByRequestId.set(requestId, created);
  return created;
}

function markFinalAgentOutputEmitted(requestId: string): void {
  emittedFinalAgentMessageByRequestId.add(requestId);
  finalAgentMessageCandidateByRequestId.delete(requestId);
}

function readStringField(record: Record<string, unknown> | null, field: string): string {
  const value = record?.[field];
  return typeof value === 'string' ? value : '';
}

function readCodexPhase(
  evt: Record<string, unknown>,
  payload: Record<string, unknown> | null,
  item: Record<string, unknown> | null,
): string {
  const phase = readStringField(evt, 'phase')
    || readStringField(payload, 'phase')
    || readStringField(item, 'phase');
  return phase.trim();
}

function readResponseItemMessageText(payload: Record<string, unknown> | null): string {
  if (!payload || payload.type !== 'message' || payload.role !== 'assistant') return '';
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return '';
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      return '';
    })
    .join('');
}

function containsPatchMarkerLine(text: string): boolean {
  const patchMarkerLinePattern = /^\s*\*{3}\s+(?:(?:Begin Patch|End Patch|End of File)(?=\s|$)|(?:Add File|Update File|Delete File|Move to):(?=\s|$))/i;
  return text.split('\n').some((line) => patchMarkerLinePattern.test(line));
}

function isLikelyToolArgumentContaminationText(text: string): boolean {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return false;
  if (containsPatchMarkerLine(normalized)) return true;
  if (/\bapply_patch\b\s*(?:<<|[{(])/i.test(normalized)) return true;
  if (/"type"\s*:\s*"function_call"/i.test(normalized) && /"arguments"\s*:/i.test(normalized)) return true;
  if (/\bTool call partial arguments\b/i.test(normalized)) return true;
  if (/\bpartial arguments\b/i.test(normalized) && /\b(function_call|tool call|tool_call|apply_patch|arguments)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function isLikelyFinalAssistantMessageText(text: string): boolean {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return false;
  if (!/[A-Za-z0-9\u4e00-\u9fff]/u.test(normalized)) return false;
  if (isLikelyToolArgumentContaminationText(normalized)) return false;
  return true;
}

function rememberFinalAgentMessageCandidate(requestId: string, text: string): void {
  const candidate = text.replace(/\r/g, '').trim();
  if (!isLikelyFinalAssistantMessageText(candidate)) return;
  finalAgentMessageCandidateByRequestId.set(requestId, candidate);
}

function emitFinalAgentMessageOnce(requestId: string, text: string): string | null {
  if (emittedFinalAgentMessageByRequestId.has(requestId)) return null;
  if (!text.trim()) return null;
  markFinalAgentOutputEmitted(requestId);
  return text;
}

function takeFinalAgentMessageCandidate(requestId: string): string | null {
  const candidate = finalAgentMessageCandidateByRequestId.get(requestId);
  finalAgentMessageCandidateByRequestId.delete(requestId);
  if (!candidate) return null;
  return emitFinalAgentMessageOnce(requestId, candidate);
}

function extractStandardResponsesTextDelta(
  requestId: string,
  type: string,
  evt: Record<string, unknown>,
): string | null {
  if (type === 'response.output_text.delta') {
    const delta = typeof evt.delta === 'string' ? evt.delta : '';
    if (!delta.trim()) return null;
    const state = getStandardResponsesTextState(requestId);
    state.sawDelta = true;
    state.emittedText += delta;
    markFinalAgentOutputEmitted(requestId);
    return delta;
  }

  if (type !== 'response.output_text.done') {
    return null;
  }

  const text = typeof evt.text === 'string' ? evt.text : '';
  if (!text.trim()) return null;
  const state = getStandardResponsesTextState(requestId);
  if (state.doneSeen) return null;
  state.doneSeen = true;

  if (!state.sawDelta) {
    if (emittedFinalAgentMessageByRequestId.has(requestId)) return null;
    state.emittedText = text;
    markFinalAgentOutputEmitted(requestId);
    return text;
  }

  if (!text.startsWith(state.emittedText)) {
    return null;
  }
  const suffix = text.slice(state.emittedText.length);
  state.emittedText = text;
  if (!suffix.trim()) return null;
  markFinalAgentOutputEmitted(requestId);
  return suffix;
}

function extractAgentDeltaFromStdoutLine(requestId: string, line: string): string | null {
  const evt = parseCodexJsonLine(line);
  if (!evt) {
    return null;
  }
  const type = typeof evt.type === 'string' ? evt.type : '';
  const item = typeof evt.item === 'object' && evt.item !== null ? (evt.item as Record<string, unknown>) : null;
  const payload = typeof evt.payload === 'object' && evt.payload !== null ? (evt.payload as Record<string, unknown>) : null;
  const phase = readCodexPhase(evt, payload, item);
  const standardResponsesTextDelta = extractStandardResponsesTextDelta(requestId, type, evt);
  if (standardResponsesTextDelta !== null) {
    return standardResponsesTextDelta;
  }
  if (type === 'response.output_text.done' && phase === 'final_answer' && typeof evt.text === 'string' && evt.text.trim()) {
    return emitFinalAgentMessageOnce(requestId, evt.text);
  }
  if (type === 'item.delta') {
    return null;
  }
  if ((type === 'item.completed' || type === 'item.updated') && item?.type === 'agent_message') {
    const text = typeof item.text === 'string' && item.text.trim()
      ? item.text
      : typeof item.content === 'string' && item.content.trim()
        ? item.content
        : '';
    if (phase === 'final_answer') return emitFinalAgentMessageOnce(requestId, text);
    if (phase === '' && text) rememberFinalAgentMessageCandidate(requestId, text);
    return null;
  }
  if (type === 'response_item') {
    const text = readResponseItemMessageText(payload ?? item);
    if (phase === 'final_answer') return emitFinalAgentMessageOnce(requestId, text);
    if (phase === '' && text) rememberFinalAgentMessageCandidate(requestId, text);
    return null;
  }
  if (type === 'event_msg' && payload?.type === 'agent_message' && typeof payload.message === 'string' && payload.message.trim()) {
    if (phase === 'final_answer') return emitFinalAgentMessageOnce(requestId, payload.message);
    if (phase === '') rememberFinalAgentMessageCandidate(requestId, payload.message);
    return null;
  }
  if (type === 'event_msg' && payload?.type === 'task_complete' && typeof payload.last_agent_message === 'string' && payload.last_agent_message.trim()) {
    return emitFinalAgentMessageOnce(requestId, payload.last_agent_message);
  }
  if (type === 'task_complete' && payload && typeof payload.last_agent_message === 'string' && payload.last_agent_message.trim()) {
    return emitFinalAgentMessageOnce(requestId, payload.last_agent_message);
  }
  if (type === 'task_complete' && typeof evt.last_agent_message === 'string' && evt.last_agent_message.trim()) {
    return emitFinalAgentMessageOnce(requestId, evt.last_agent_message);
  }
  if ((type === 'event_msg' && payload?.type === 'task_complete') || type === 'task_complete') {
    return takeFinalAgentMessageCandidate(requestId);
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

function hasOwnRecordField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function measureTraceValueBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf-8');
  if (typeof value === 'undefined') return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf-8');
  } catch {
    return 0;
  }
}

function buildFunctionCallTraceDetails(item: Record<string, unknown>): Record<string, unknown> {
  const toolName = readStringField(item, 'name') || 'unknown';
  const callId = readStringField(item, 'call_id');
  const details: Record<string, unknown> = {
    tool_name: toolName,
    ...(callId ? { call_id: callId } : {}),
  };

  if (hasOwnRecordField(item, 'arguments')) {
    details.arguments_present = true;
    details.arguments_bytes = measureTraceValueBytes(item.arguments);
    details.arguments_redacted = true;
  }

  return details;
}

function containsFunctionCallArguments(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsFunctionCallArguments(entry, depth + 1));
  }
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type === 'function_call' && hasOwnRecordField(record, 'arguments')) return true;
  return Object.values(record).some((entry) => containsFunctionCallArguments(entry, depth + 1));
}

function containsToolArgumentContamination(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === 'string') return isLikelyToolArgumentContaminationText(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsToolArgumentContamination(entry, depth + 1));
  }
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).some((entry) => (
    containsToolArgumentContamination(entry, depth + 1)
  ));
}

function shouldSuppressRawTraceText(raw: string): boolean {
  const parsed = parseCodexJsonLine(raw);
  if (parsed) {
    return containsFunctionCallArguments(parsed) || containsToolArgumentContamination(parsed);
  }
  return isLikelyToolArgumentContaminationText(raw)
    || (/"type"\s*:\s*"function_call"/.test(raw) && /"arguments"\s*:/.test(raw));
}

function normalizeProxyBase(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\/+$/, '');
}

function normalizeExecutionWireApi(input: unknown): AgentWireApi {
  if (typeof input !== 'string') return 'openai_responses';
  switch (input.trim()) {
    case 'openai_chat_completions':
      return 'openai_chat_completions';
    case 'openai_responses':
      return 'openai_responses';
    case 'anthropic_messages':
      return 'anthropic_messages';
    case 'chat':
      return 'openai_chat_completions';
    case 'responses':
      return 'openai_responses';
    default:
      return 'openai_responses';
  }
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
  const rawTraceLine = shouldSuppressRawTraceText(line) ? undefined : line;
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
    ...(rawTraceLine ? { raw: rawTraceLine } : {}),
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
      sendTraceEvent(requestId, {
        category: 'tool',
        phase: type === 'item.started' ? 'start' : 'update',
        status: 'running',
        name: 'codex.command',
        summary: `Command ${type === 'item.started' ? 'started' : 'updated'}`,
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
        details: buildFunctionCallTraceDetails(item),
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
      details: buildFunctionCallTraceDetails(item),
    });
    return;
  }
  if (item.type === 'command_execution') {
    const exitCode = typeof item.exit_code === 'number' && Number.isFinite(item.exit_code)
      ? Math.trunc(item.exit_code)
      : null;
    const status = exitCode === null || exitCode === 0 ? 'success' : 'error';
    sendTraceEvent(requestId, {
      category: status === 'success' ? 'tool' : 'error',
      phase: 'end',
      status,
      name: 'codex.command',
      summary: status === 'success'
        ? 'Command completed'
        : `Command failed${exitCode !== null ? ` (exit ${exitCode})` : ''}`,
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
    const agentDelta = extractAgentDeltaFromStdoutLine(requestId, line);
    if (agentDelta) {
      emitDeltaChunkAndTrackVisibleChars(requestId, agentDelta);
    }
  }
  remaining = tail;

  const parsed = extractJsonObjectsFromBuffer(remaining);
  for (const jsonObject of parsed.objects) {
    const line = jsonObject.trim();
    if (!line) continue;
    maybeEmitTraceFromStdoutLine(requestId, line);
    const agentDelta = extractAgentDeltaFromStdoutLine(requestId, line);
    if (agentDelta) {
      emitDeltaChunkAndTrackVisibleChars(requestId, agentDelta);
    }
  }
  return parsed.rest;
}

async function runCodexRequest(requestId: string, payload: ServerStartPayload): Promise<void> {
  const executionContext = assertTaskExecutionContext(payload.execution_context);
  const taskId = sanitizePathPart(executionContext.task_id, `task_${requestId.slice(0, 8)}`);
  const username = sanitizePathPart(executionContext.username, 'unknown_user');
  let releasePreparedTaskWorkspace: (() => Promise<void>) | null = null;
  let releaseHandledByCodexLifecycle = false;
  try {
  debugLog('preparing task workspace', { request_id: requestId, task_id: taskId });
  const cwdResult = await prepareTaskWorkspace({
    executionContext,
    username,
    taskId,
  });
  releasePreparedTaskWorkspace = createPreparedTaskWorkspaceReleaseOnce(requestId, cwdResult.release);
  const releasePreparedTaskWorkspaceOnce = releasePreparedTaskWorkspace;
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
  const userPrompt = selectLatestInstruction(payload.messages);
  const taskInputs = Array.isArray(executionContext.task_inputs) ? executionContext.task_inputs : [];
  debugLog('preparing task workspace assets', { request_id: requestId, cwd });
  const preparedAssets = await prepareTaskWorkspaceAssets({
    cwd,
    paths: taskPaths,
    executionContext,
    taskInputs,
    debugLog,
  });
  const artifactsDir = preparedAssets.artifactsDir;
  const prompt = `${buildTaskHeadlessPreamble({
    artifactsDir,
  })}User request:\n${userPrompt}`;
  const endpointProxyBase = normalizeProxyBase(executionContext.resource_proxy?.base_url);
  if (!endpointProxyBase) {
    throw new Error('resource_proxy_base_missing');
  }
  const modelContextWindow =
    positiveInteger(executionContext.model_limits?.context_window)
      ?? positiveInteger(executionContext.model_context_window);
  const modelMaxOutputTokens = positiveInteger(executionContext.model_limits?.max_output_tokens);
  const modelAutoCompactTokenLimit = resolveModelAutoCompactTokenLimit({
    modelContextWindow,
    modelMaxOutputTokens,
    modelAutoCompactTokenLimit: positiveInteger(executionContext.model_auto_compact_token_limit),
  });
  const modelCatalogInputModalities = Array.isArray(executionContext.model_catalog?.input_modalities)
    ? executionContext.model_catalog?.input_modalities
      ?.filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : ['text'];
  const modelCatalogSupportsSearchTool = executionContext.model_catalog?.supports_search_tool === true;
  const modelCatalogSupportsParallelToolCalls = executionContext.model_catalog?.supports_parallel_tool_calls === true;
  const modelCatalogApplyPatchToolType =
    executionContext.model_catalog?.apply_patch_tool_type === 'freeform' ? 'freeform' : 'function';
  const executionWireApi = normalizeExecutionWireApi(executionContext.wire_api);
  const sessionStateResult = await ensureCodexSessionStateCompatible({
    codexDir: taskPaths.codexDir,
    taskId,
    model: payload.model ?? executionContext.model ?? 'gpt-5-codex',
    wireApi: executionWireApi,
    resourceProxyBase: endpointProxyBase,
    modelContextWindow,
    modelMaxOutputTokens,
    modelAutoCompactTokenLimit,
    modelCatalogSignature: JSON.stringify({
      input_modalities: modelCatalogInputModalities,
      supports_search_tool: modelCatalogSupportsSearchTool,
      supports_parallel_tool_calls: modelCatalogSupportsParallelToolCalls,
      apply_patch_tool_type: modelCatalogApplyPatchToolType,
    }),
  });
  debugLog('validated codex session state', {
    request_id: requestId,
    codex_dir: taskPaths.codexDir,
    reset_performed: sessionStateResult.resetPerformed,
    reason: sessionStateResult.reason,
    resume_allowed: sessionStateResult.resumeAllowed,
    model_max_output_tokens: modelMaxOutputTokens ?? null,
  });
  const resumeSession = sessionStateResult.resumeAllowed;
  // codex-cli >=0.104 no longer accepts wire_api=chat in provider config.
  const codexProviderWireApi = 'responses';

  const model = executionContext.model ?? payload.model ?? 'gpt-5-codex';
  const codexConfigDir = taskPaths.codexDir;
  await mkdir(codexConfigDir, { recursive: true });
  const modelCatalogPath = join(codexConfigDir, 'catalog.json');
  await writeFile(
    modelCatalogPath,
    buildTaskCodexModelCatalog({
      model,
      modelContextWindow: modelContextWindow ?? 128000,
      modelMaxOutputTokens,
      modelAutoCompactTokenLimit: modelAutoCompactTokenLimit ?? Math.floor((modelContextWindow ?? 128000) * 0.9),
      applyPatchToolType: modelCatalogApplyPatchToolType,
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
      wireApi: codexProviderWireApi,
      modelContextWindow,
      modelMaxOutputTokens,
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
    wire_api: executionWireApi,
    codex_provider_wire_api: codexProviderWireApi,
    resource_proxy_base: endpointProxyBase,
    proxy_source: 'request_execution_context',
    model_context_window: modelContextWindow ?? null,
    model_max_output_tokens: modelMaxOutputTokens ?? null,
    model_auto_compact_token_limit: modelAutoCompactTokenLimit ?? null,
    model_catalog_path: modelCatalogPath,
    model_input_modalities: modelCatalogInputModalities,
    model_supports_search_tool: modelCatalogSupportsSearchTool,
    model_supports_parallel_tool_calls: modelCatalogSupportsParallelToolCalls,
    model_apply_patch_tool_type: modelCatalogApplyPatchToolType,
    has_execution_ticket: Boolean(executionContext.execution_ticket && executionContext.execution_ticket.trim()),
    resume_session: resumeSession,
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
    wireApi: codexProviderWireApi,
    modelContextWindow,
    modelMaxOutputTokens,
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
      TASK_HOME: taskPaths.taskHome,
      WORKSPACE_PATH: taskPaths.workspaceDir,
      ARTIFACTS_PATH: taskPaths.artifactsDir,
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
    wire_api: executionWireApi,
    codex_provider_wire_api: codexProviderWireApi,
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
      wire_api: executionWireApi,
      codex_provider_wire_api: codexProviderWireApi,
      model_context_window: modelContextWindow ?? null,
      model_max_output_tokens: modelMaxOutputTokens ?? null,
      model_auto_compact_token_limit: modelAutoCompactTokenLimit ?? null,
      model_catalog_path: modelCatalogPath,
      model_input_modalities: modelCatalogInputModalities,
      model_supports_search_tool: modelCatalogSupportsSearchTool,
      model_supports_parallel_tool_calls: modelCatalogSupportsParallelToolCalls,
      yolo: codexYolo,
      task_inputs_count: taskInputs.length,
      builtin_skills_count: builtinSkillsResult.available.length,
      artifacts_dir: artifactsDir,
    },
  });
  sendTraceEvent(requestId, {
    category: 'progress',
    phase: 'start',
    status: 'running',
    name: 'runner.policy',
    summary: 'Agent task headless execution policy applied',
    details: {
      artifacts_dir: artifactsDir,
    },
  });

  let stdoutBuffer = '';
  const workspaceBeforeSnapshot = await scanWorkspaceFilesSnapshot(cwd, {
    runtimeRoot: taskPaths.runtimeRoot,
  });
  const artifactsBeforeRun = await scanArtifactsDirectory(taskPaths.artifactsDir, taskId);
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
    void releasePreparedTaskWorkspaceOnce();
    clearRequestRuntimeState(requestId);
  });

  child.on('close', (code, signal) => {
    stdoutBuffer = flushCodexStdoutBuffer(requestId, stdoutBuffer);
    const trailingLine = stdoutBuffer.trim();
    if (trailingLine.length > 0) {
      const rawTraceLine = shouldSuppressRawTraceText(trailingLine) ? undefined : trailingLine.slice(0, 4000);
      sendTraceEvent(requestId, {
        category: 'debug',
        phase: 'end',
        status: 'running',
        name: 'codex.stdout.trailing_non_json',
        summary: 'Ignored trailing non-JSON stdout from Codex',
        ...(rawTraceLine ? { raw: rawTraceLine } : {}),
      });
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
      try {
      if (workspaceBeforeSnapshot) {
        try {
          const workspaceAfterSnapshot = await scanWorkspaceFilesSnapshot(cwd, {
            runtimeRoot: taskPaths.runtimeRoot,
          });
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
        await scanArtifactsDirectory(taskPaths.artifactsDir, taskId),
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
        clearRequestRuntimeState(requestId);
        return;
      }
      if (terminalOutcome.finalStatus === 'success') {
        const finalCandidate = takeFinalAgentMessageCandidate(requestId);
        if (finalCandidate) {
          emitDeltaChunkAndTrackVisibleChars(requestId, finalCandidate);
        }
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
          clearRequestRuntimeState(requestId);
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
        clearRequestRuntimeState(requestId);
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
      clearRequestRuntimeState(requestId);
      } finally {
        await releasePreparedTaskWorkspaceOnce();
      }
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
      clearRequestRuntimeState(requestId);
    });
  });
  releaseHandledByCodexLifecycle = true;
  } finally {
    if (!releaseHandledByCodexLifecycle && releasePreparedTaskWorkspace) {
      await releasePreparedTaskWorkspace();
    }
  }
}

function decodeRawMessage(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf-8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf-8');
  return Buffer.from(raw).toString('utf-8');
}

function sendReadyFrame(socket: WebSocket): void {
  const connectionEpoch = readConnectionEpoch(socket);
  sendRawFrameOnSocket(socket, {
    type: 'agent.ready',
    timestamp: new Date().toISOString(),
    payload: {
      runner_instance_id: resolvedRunnerInstanceId,
      connection_epoch: connectionEpoch,
      runner_spec: AGENT_TASK_RUNNER_SPEC,
      capabilities: {
        streaming_completion: true,
        multimodal_completion: false,
        terminal_adopt: 'v1',
      },
      active_terminals: listActiveTerminalDescriptors(connectionEpoch),
      request_details: {
        executor: 'codex_cli',
        codex_provider_wire_api: 'responses',
      },
    },
  });
}

function handleServerMessage(socket: WebSocket, raw: RawData): void {
  if (socket !== activeWs) return;
  let message: AgentMessage;
  try {
    message = JSON.parse(decodeRawMessage(raw)) as AgentMessage;
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
    debugLog('received server hello', {
      protocol_version: payload?.protocol_version ?? null,
      heartbeat_interval_sec: payload?.heartbeat_interval_sec ?? null,
    });
    return;
  }

  if (message.type === 'server.ping') {
    sendRawFrameOnSocket(socket, {
      type: 'agent.pong',
      timestamp: new Date().toISOString(),
      payload: {},
    });
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
        const entry = activeTerminalBySessionId.get(message.terminal_session_id);
        if (entry) {
          entry.cols = cols;
          entry.rows = rows;
        }
      }
    }
    return;
  }

  if (message.type === 'server.terminal.close' && message.terminal_session_id) {
    void handleTerminalClose(message).catch((error) => {
      debugLog('terminal close handler failed', {
        terminal_session_id: message.terminal_session_id ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  if (message.type === 'server.terminal.adopt' && message.terminal_session_id) {
    handleTerminalAdopt(message);
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
    const rawPayload = isRecord(message.payload) ? message.payload : {};
    const runnerSessionId = resolveRunnerSessionId(message, rawPayload);
    const terminalPayload = rawPayload as {
      cols?: number;
      rows?: number;
      shell?: string;
      generation?: number;
      runner_session_id?: string;
      execution_context?: TerminalExecutionContext;
    };
    void runTerminalSession(message.terminal_session_id, terminalPayload, { runnerSessionId }).catch((error) => {
      runningTerminalBySessionId.delete(message.terminal_session_id!);
      activeTerminalBySessionId.delete(message.terminal_session_id!);
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
  } | undefined;
  debugLog('received start', {
    request_id: message.request_id,
    model: executionContext?.model ?? startPayload.model ?? null,
    wire_api: executionContext?.wire_api ?? null,
    task_id: executionContext?.task_id ?? null,
    workspace_binding_mode: executionContext?.workspace_binding_mode ?? null,
    workspace_file_library_id: executionContext?.workspace_file_library_id ?? null,
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
    clearRequestRuntimeState(message.request_id!);
  });
}

function connectWebSocket(): void {
  if (runnerIsShuttingDown) return;
  const socket = new WebSocket(wsUrl!, {
    headers: { Authorization: `Bearer ${key}` },
  });
  activeWs = socket;

  socket.on('open', () => {
    if (socket !== activeWs) return;
    assignConnectionEpoch(socket);
    reconnectAttempt = 0;
    writeRunnerLifecycleState('connected', 'websocket_open');
    process.stdout.write('[agent-task-runner] connected\n');
    debugLog('websocket open', { ws_url: wsUrl });
    sendReadyFrame(socket);
  });

  socket.on('message', (raw) => {
    handleServerMessage(socket, raw);
  });

  socket.on('close', () => {
    if (socket !== activeWs) return;
    activeWs = null;
    if (runnerIsShuttingDown) return;
    handleTransportLost('websocket_close');
  });

  socket.on('error', (error) => {
    process.stderr.write(`[agent-task-runner] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
  });
}

connectWebSocket();

process.once('SIGINT', () => {
  void shutdownRunner('sigint');
});

process.once('SIGTERM', () => {
  void shutdownRunner('sigterm');
});
