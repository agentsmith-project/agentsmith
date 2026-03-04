import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { buildCodexExecArgs, buildTaskCodexConfig } from './codex-command-builder.js';
import { sanitizeAgentDeltaChunk, sanitizeStderrChunk, type RunnerFilterStats } from './codex-output-filter.js';
import {
  buildNotebookHeadlessPreamble,
  prepareNotebookWorkspaceAssets,
} from './notebook-assets.js';
import {
  diffWorkspaceFileSnapshots,
  filterNewArtifactsForCwd,
  scanArtifactsDirectory,
  scanWorkspaceFilesSnapshot,
} from './artifact-scan.js';
import { resolveTaskCwd, shouldResumeNotebookSession } from './workspace-runtime.js';
import { applyRuntimeContextFiles, type RuntimeContextFileItem } from './runtime-context-files.js';
import { resolveBuiltinSkillsConfig, syncBuiltinSkills } from './builtin-skills.js';

type ServerStartPayload = {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  runtime_context?: {
    workspace_id?: string;
    project_id?: string;
    task_id?: string;
    run_id?: string;
    username?: string;
    session_id?: string;
    api_base?: string;
    user_bearer_token?: string;
    wire_api?: 'chat' | 'responses';
    model?: string;
    notebook_mode?: boolean;
    task_inputs?: Array<{
      kind?: 'source' | 'library_object' | 'artifact' | 'url';
      source_id?: string;
      library_id?: string;
      key?: string;
      task_id?: string;
      artifact_id?: string;
      task_relative_path?: string;
      url?: string;
      imported_library_id?: string;
      imported_key?: string;
      filename?: string;
      file_type?: string;
      file_size?: number;
      ai_ready_status?: string;
    }>;
    credential_files?: RuntimeContextFileItem[];
  };
};

type ServerHelloPayload = {
  resource_proxy?: {
    base_url?: string;
  };
};

type AgentMessage = {
  type?: string;
  request_id?: string;
  payload?: ServerStartPayload | ServerHelloPayload;
};

const wsUrl = process.env.MBOS_AGENT_WS_URL;
const key = process.env.MBOS_AGENT_KEY;
const codexBin = process.env.CODEX_BIN ?? 'codex';
const runnerDebug = process.env.MBOS_AGENT_RUNNER_DEBUG === '1';
const codexYolo = process.env.MBOS_AGENT_CODEX_YOLO === '1';
// Keep runner watchdog below api-entry-node's current per-request timeout (60s default)
// so the user sees a deterministic runner timeout instead of the generic runtime timeout.
const taskTimeoutSec = Math.max(5, Number(process.env.MBOS_AGENT_TASK_TIMEOUT_SEC ?? '55') || 55);

if (!wsUrl || !key) {
  process.stderr.write(
    'Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx [CODEX_BIN=codex] npm run dev -w @mbos/agent-codex-runner\n',
  );
  process.exit(1);
}

const ws = new WebSocket(wsUrl, {
  headers: { Authorization: `Bearer ${key}` },
});

type RunningProcess = ChildProcessByStdio<null, Readable, Readable>;
const runningByRequestId = new Map<string, RunningProcess>();
const timeoutByRequestId = new Map<string, NodeJS.Timeout>();
const hardKillTimeoutByRequestId = new Map<string, NodeJS.Timeout>();
const timedOutRequestIds = new Set<string>();
const traceSeqByRequestId = new Map<string, number>();
const codexSessionReadyByCwd = new Set<string>();
const reportedArtifactsByCwd = new Map<string, Set<string>>();
let connectedResourceProxyBase = '';
type FilterStats = RunnerFilterStats;
const filterStatsByRequestId = new Map<string, FilterStats>();

function getFilterStats(requestId: string): FilterStats {
  let existing = filterStatsByRequestId.get(requestId);
  if (existing) return existing;
  existing = {
    stderr_superpowers_skill_missing: 0,
    model_metadata_warning: 0,
    delta_metadata_warning_event: 0,
    delta_empty_error_shell: 0,
  };
  filterStatsByRequestId.set(requestId, existing);
  return existing;
}

function sanitizePathPart(input: string | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || fallback;
}

function sendFrame(type: string, requestId: string, payload: Record<string, unknown>) {
  ws.send(
    JSON.stringify({
      type,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      payload,
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

function debugLog(message: string, extra?: Record<string, unknown>): void {
  if (!runnerDebug) return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-codex-runner][debug] ${message}${payload}\n`);
}

function clearRequestTimers(requestId: string): void {
  const timeout = timeoutByRequestId.get(requestId);
  if (timeout) {
    clearTimeout(timeout);
    timeoutByRequestId.delete(requestId);
  }
  const hardKill = hardKillTimeoutByRequestId.get(requestId);
  if (hardKill) {
    clearTimeout(hardKill);
    hardKillTimeoutByRequestId.delete(requestId);
  }
}

function extractPrompt(messages: Array<{ role?: string; content?: unknown }> | undefined): string {
  if (!messages || messages.length === 0) return '';
  const lastUser = [...messages].reverse().find((item) => item.role === 'user');
  const content = lastUser?.content;
  if (typeof content === 'string') return content;
  return JSON.stringify(content ?? '');
}

function maybeEmitDeltaChunk(requestId: string, chunk: string): void {
  const trimmed = sanitizeAgentDeltaChunk(chunk, () => getFilterStats(requestId)).replace(/\r/g, '');
  if (!trimmed.trim()) return;
  sendFrame('agent.response.delta', requestId, { delta: trimmed });
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
  if (type === 'item.completed') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'end',
      status: 'success',
      name: 'codex.item',
      summary: itemType ? `Item completed: ${itemType}` : 'Item completed',
      details: itemType ? { item_type: itemType } : undefined,
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
    maybeEmitDeltaChunk(requestId, line);
  }
  remaining = tail;

  const parsed = extractJsonObjectsFromBuffer(remaining);
  for (const jsonObject of parsed.objects) {
    const line = jsonObject.trim();
    if (!line) continue;
    maybeEmitTraceFromStdoutLine(requestId, line);
    maybeEmitDeltaChunk(requestId, line);
  }
  return parsed.rest;
}

async function runCodexRequest(requestId: string, payload: ServerStartPayload): Promise<void> {
  const runtimeContext = payload.runtime_context ?? {};
  const taskId = sanitizePathPart(runtimeContext.task_id, `task_${requestId.slice(0, 8)}`);
  const username = sanitizePathPart(runtimeContext.username, 'unknown_user');
  const cwdResult = resolveTaskCwd({
    workspacePath: process.env.WORKSPACE_PATH,
    username,
    taskId,
  });
  const cwd = cwdResult.cwd;
  await mkdir(cwd, { recursive: true });
  const builtinSkillsConfig = resolveBuiltinSkillsConfig();
  const builtinSkillsResult = await syncBuiltinSkills({
    cwd,
    sourceDir: builtinSkillsConfig.sourceDir,
    skills: builtinSkillsConfig.skills,
    required: builtinSkillsConfig.required,
  });
  const isNotebookMode = runtimeContext.notebook_mode === true;
  const userPrompt = extractPrompt(payload.messages);
  const taskInputs = Array.isArray(runtimeContext.task_inputs) ? runtimeContext.task_inputs : [];
  const credentialFiles = Array.isArray(runtimeContext.credential_files)
    ? runtimeContext.credential_files
    : [];
  let artifactsDir = join(cwd, 'artifacts');
  let taskInputsManifestPath = join(cwd, '.mbos', 'task-inputs.json');
  if (isNotebookMode) {
    const preparedAssets = await prepareNotebookWorkspaceAssets({
      cwd,
      runtimeContext,
      taskInputs,
    });
    artifactsDir = preparedAssets.artifactsDir;
    taskInputsManifestPath = preparedAssets.taskInputsManifestPath;
  }
  const runtimeFilesResult = await applyRuntimeContextFiles(cwd, credentialFiles);
  const prompt = isNotebookMode
    ? `${buildNotebookHeadlessPreamble({
      artifactsDir,
      taskInputsManifestPath,
      taskInputsCount: taskInputs.length,
    })}User request:\n${userPrompt}`
    : userPrompt;
  const endpointProxyBase = connectedResourceProxyBase;
  if (!endpointProxyBase) {
    throw new Error('resource_proxy_base_missing');
  }
  // codex-cli >=0.104 no longer accepts wire_api=chat in provider config.
  const wireApi = 'responses';

  const model = runtimeContext.model ?? payload.model ?? 'gpt-5-codex';
  const resumeDecision = shouldResumeNotebookSession({
    isNotebookMode,
    cwd,
    hasSessionInMemory: codexSessionReadyByCwd.has(cwd),
  });
  const resumeLast = resumeDecision.resumeLast;
  const codexConfigDir = join(cwd, '.codex');
  await mkdir(codexConfigDir, { recursive: true });
  await writeFile(
    join(codexConfigDir, 'config.toml'),
    buildTaskCodexConfig({
      model,
      endpointProxyBase,
      wireApi,
      userBearerToken: runtimeContext.user_bearer_token,
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
    has_user_bearer_token: Boolean(runtimeContext.user_bearer_token && runtimeContext.user_bearer_token.trim()),
    notebook_mode: isNotebookMode,
    task_inputs_count: taskInputs.length,
    credential_files_count: runtimeFilesResult.written,
    credential_files_bytes: runtimeFilesResult.totalBytes,
    builtin_skills_source_dir: builtinSkillsResult.sourceDir,
    builtin_skills_mounted: builtinSkillsResult.mounted,
    artifacts_dir: isNotebookMode ? artifactsDir : null,
    resume_last: resumeLast,
    cwd_source: cwdResult.source,
    resume_source: resumeDecision.source,
  });

  const codexArgs = buildCodexExecArgs({
    model,
    prompt,
    cwd,
    endpointProxyBase,
    wireApi,
    userBearerToken: runtimeContext.user_bearer_token,
    resumeLast,
    yolo: codexYolo,
  });

  const child = spawn(
    codexBin,
    codexArgs,
    {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(isNotebookMode ? {
          MBOS_NOTEBOOK_API_BASE: runtimeContext.api_base ?? '',
          MBOS_NOTEBOOK_WORKSPACE_ID: runtimeContext.workspace_id ?? '',
          MBOS_NOTEBOOK_PROJECT_ID: runtimeContext.project_id ?? '',
          MBOS_NOTEBOOK_USER_BEARER_TOKEN: runtimeContext.user_bearer_token ?? '',
          MBOS_NOTEBOOK_TASK_INPUTS_MANIFEST: './.mbos/task-inputs.json',
        } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  debugLog('spawned codex', {
    request_id: requestId,
    yolo: codexYolo,
    cmd: codexBin,
    argv: codexArgs.map((arg) => {
      if (arg === prompt) return '<prompt>';
      if (arg.includes('experimental_bearer_token=')) return 'model_providers.proxy.experimental_bearer_token="<redacted>"';
      return arg;
    }),
  });
  runningByRequestId.set(requestId, child);
  sendTraceEvent(requestId, {
    category: 'progress',
    phase: 'start',
    status: 'running',
    name: 'codex.exec',
    summary: 'Starting Codex execution',
    details: {
      model,
      wire_api: wireApi,
      yolo: codexYolo,
      notebook_mode: isNotebookMode,
      task_inputs_count: taskInputs.length,
      credential_files_count: runtimeFilesResult.written,
      builtin_skills_count: builtinSkillsResult.mounted.length,
      artifacts_dir: isNotebookMode ? 'artifacts/' : null,
    },
  });
  if (isNotebookMode) {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'start',
      status: 'running',
      name: 'runner.policy',
      summary: 'Notebook headless execution policy applied',
      details: {
        task_inputs_manifest: '.mbos/task-inputs.json',
        artifacts_dir: 'artifacts/',
      },
    });
  }

  const timeoutHandle = setTimeout(() => {
    if (child.exitCode !== null) return;
    timedOutRequestIds.add(requestId);
    debugLog('task watchdog timeout', {
      request_id: requestId,
      timeout_sec: taskTimeoutSec,
    });
    sendFrame('agent.response.error', requestId, {
      error_code: 'AGENT_TIMEOUT',
      error_message: `codex_task_timeout_${taskTimeoutSec}s`,
    });
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.exec',
      summary: `Execution timeout (${taskTimeoutSec}s)`,
    });
    child.kill('SIGTERM');
    const hardKillHandle = setTimeout(() => {
      if (child.exitCode === null) {
        debugLog('task watchdog hard kill', { request_id: requestId });
        child.kill('SIGKILL');
      }
    }, 3_000);
    hardKillTimeoutByRequestId.set(requestId, hardKillHandle);
  }, taskTimeoutSec * 1000);
  timeoutByRequestId.set(requestId, timeoutHandle);

  let stdoutBuffer = '';
  const workspaceBeforeSnapshot = isNotebookMode ? await scanWorkspaceFilesSnapshot(cwd) : null;
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
    maybeEmitDeltaChunk(requestId, `[stderr] ${text}\n`);
  });

  child.on('error', (error) => {
    clearRequestTimers(requestId);
    runningByRequestId.delete(requestId);
    if (timedOutRequestIds.has(requestId)) {
      timedOutRequestIds.delete(requestId);
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
      return;
    }
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
    if (runnerDebug) {
      const stats = filterStatsByRequestId.get(requestId);
      if (stats) debugLog('filter stats', { request_id: requestId, ...stats });
    }
    filterStatsByRequestId.delete(requestId);
  });

  child.on('close', (code, signal) => {
    clearRequestTimers(requestId);
    stdoutBuffer = flushCodexStdoutBuffer(requestId, stdoutBuffer);
    const trailingLine = stdoutBuffer.trim();
    if (trailingLine.length > 0) {
      // Final fallback for residual non-JSON text without trailing newline.
      maybeEmitTraceFromStdoutLine(requestId, trailingLine);
      maybeEmitDeltaChunk(requestId, trailingLine);
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
    runningByRequestId.delete(requestId);
    if (timedOutRequestIds.has(requestId)) {
      timedOutRequestIds.delete(requestId);
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
      return;
    }
    void (async () => {
      if (isNotebookMode && workspaceBeforeSnapshot) {
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
      const artifacts = isNotebookMode
        ? filterNewArtifactsForCwd(reportedArtifactsByCwd, cwd, await scanArtifactsDirectory(cwd))
        : [];
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
      if (code === 0) {
        if (isNotebookMode) {
          codexSessionReadyByCwd.add(cwd);
        }
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
        filterStatsByRequestId.delete(requestId);
        return;
      }
      sendTraceEvent(requestId, {
        category: signal ? 'warning' : 'error',
        phase: 'end',
        status: signal ? 'cancelled' : 'error',
        name: 'codex.exec',
        summary: signal ? `Codex terminated (${signal})` : `Codex exited with code ${String(code ?? 'unknown')}`,
        details: {
          ...(signal ? { signal } : {}),
          ...(code !== null ? { exit_code: code } : {}),
        },
      });
      sendFrame('agent.response.error', requestId, {
        error_code: signal ? 'AGENT_CANCELLED' : 'AGENT_UPSTREAM_ERROR',
        error_message: signal ? `codex_terminated_${signal}` : `codex_exit_code_${String(code ?? 'unknown')}`,
      });
      if (isNotebookMode && !resumeLast && code !== null && code > 0) {
        // Keep first-run failures from incorrectly enabling resume for subsequent turns.
        codexSessionReadyByCwd.delete(cwd);
      }
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
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
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
    });
  });
}

ws.on('open', () => {
  process.stdout.write('[agent-codex-runner] connected\n');
  debugLog('websocket open', { ws_url: wsUrl });
  ws.send(
    JSON.stringify({
      type: 'agent.ready',
      timestamp: new Date().toISOString(),
      payload: {
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
        runtime: {
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
      sendTraceEvent(message.request_id, {
        category: 'warning',
        phase: 'end',
        status: 'cancelled',
        name: 'codex.exec',
        summary: 'Execution cancelled by server',
      });
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 3000);
    }
    clearRequestTimers(message.request_id);
    return;
  }

  if (message.type !== 'server.request.start' || !message.request_id || !message.payload) {
    return;
  }
  const startPayload = message.payload as ServerStartPayload;
  debugLog('received start', {
    request_id: message.request_id,
    model: startPayload.runtime_context?.model ?? startPayload.model ?? null,
    wire_api: startPayload.runtime_context?.wire_api ?? null,
    task_id: startPayload.runtime_context?.task_id ?? null,
  });

  void runCodexRequest(message.request_id, startPayload).catch((error) => {
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
  });
});

ws.on('close', () => {
  process.stdout.write('[agent-codex-runner] disconnected\n');
  for (const child of runningByRequestId.values()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
  runningByRequestId.clear();
  connectedResourceProxyBase = '';
  for (const requestId of timeoutByRequestId.keys()) {
    clearRequestTimers(requestId);
  }
  timedOutRequestIds.clear();
  traceSeqByRequestId.clear();
});

ws.on('error', (error) => {
  process.stderr.write(`[agent-codex-runner] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
});
