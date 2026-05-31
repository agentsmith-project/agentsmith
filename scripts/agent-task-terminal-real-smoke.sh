#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "${ROOT_DIR}/scripts/local-manual/require-monorepo-runner-diagnostic-opt-in.sh" "scripts/agent-task-terminal-real-smoke.sh"

source "${ROOT_DIR}/scripts/local-manual/common.sh"

init_local_manual_env
export ROOT_DIR

REAL_SMOKE_RESTARTED_RUNNER=0
cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" && "${REAL_SMOKE_RESTARTED_RUNNER}" == "1" ]]; then
    stop_pid_file_if_running "${RUNNER_PID_FILE}" "runner" || true
    rm -f "${RUNNER_READY_FILE}" || true
  fi
}
trap 'cleanup_on_exit $?' EXIT INT TERM

if [[ ! -f "${API_READY_FILE}" || ! -f "${WEB_READY_FILE}" || ! -f "${RUNNER_READY_FILE}" ]]; then
  bash "${ROOT_DIR}/scripts/local-manual/up.sh" >/dev/null
fi

if ! runner_socket_is_connected; then
  REAL_SMOKE_RESTARTED_RUNNER=1
  ensure_local_manual_runner_connected
fi

if [[ -z "$(state_get project.id)" || -z "$(state_get agent_runner.id)" ]]; then
  for attempt in 1 2 3 4; do
    if bash "${ROOT_DIR}/scripts/local-manual/seed-agent-task-diagnostics.sh" >/dev/null; then
      break
    fi
    if [[ "${attempt}" == "4" ]]; then
      echo "[agent-task-terminal-smoke] failed to prepare agent-task diagnostics after retries" >&2
      exit 1
    fi
    sleep $((attempt * 2))
  done
fi

TOKEN_FILE="${TOKEN_FILE:-${ROOT_DIR}/artifacts/backend-real/current/token.txt}"
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[agent-task-terminal-smoke] missing token file: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(<"${TOKEN_FILE}")"
if [[ -z "${TOKEN}" ]]; then
  echo "[agent-task-terminal-smoke] empty token" >&2
  exit 1
fi

TASK_WS_ID="${TASK_WS_ID:-${WORKSPACE_ID}}"
TASK_PROJECT_ID="${TASK_PROJECT_ID:-$(state_get project.id)}"
TASK_AGENT_RUNNER_ID="${TASK_AGENT_RUNNER_ID:-$(state_get agent_runner.id)}"
TASK_AGENT_RUNNER_PROVIDER="${TASK_AGENT_RUNNER_PROVIDER:-$(state_get agent_runner.runner_provider)}"
API_BASE="${API_BASE:-http://localhost:${PORT_API}}"

if [[ -z "${TASK_PROJECT_ID}" ]]; then
  echo "[agent-task-terminal-smoke] missing local-manual agent-task diagnostic state" >&2
  exit 1
fi
if [[ -z "${TASK_AGENT_RUNNER_ID}" || "${TASK_AGENT_RUNNER_PROVIDER}" != "developer" ]]; then
  echo "[agent-task-terminal-smoke] expected Developer runner diagnostic state for external smoke (runner=${TASK_AGENT_RUNNER_ID:-missing}, provider=${TASK_AGENT_RUNNER_PROVIDER:-missing})" >&2
  exit 1
fi

TASK_CREATE_RESULT="$(
  node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${TASK_PROJECT_ID}" "${API_BASE}" "${TASK_AGENT_RUNNER_ID}"
const [token, workspaceId, projectId, apiBase, agentRunnerId] = process.argv.slice(2);
const base = `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const request = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}:${text}`);
  return text ? JSON.parse(text) : null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let task = null;
let lastError = null;
for (let attempt = 0; attempt < 4; attempt += 1) {
  try {
    task = await request(`${base}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `External Terminal Smoke ${Date.now()}`,
        workspace_mode: 'create_new',
        bound_runner_id: agentRunnerId,
      }),
    });
    break;
  } catch (error) {
    lastError = error;
    await sleep(1500 * (attempt + 1));
  }
}

if (!task?.id) throw lastError ?? new Error('task_id_missing');

function readStringValue(source, segments) {
  let value = source;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }
    value = value[segment];
  }
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

process.stdout.write(JSON.stringify({
  task_id: task.id,
  task_home_segment: firstNonEmpty(
    readStringValue(task, ['task_home_segment']),
    readStringValue(task, ['runtime_paths', 'task_home_segment']),
  ),
  task_home_path: firstNonEmpty(
    readStringValue(task, ['task_home_path']),
    readStringValue(task, ['runtime_paths', 'task_home_path']),
    readStringValue(task, ['execution_context', 'task_home_path']),
  ),
  workspace_path: firstNonEmpty(
    readStringValue(task, ['workspace_path']),
    readStringValue(task, ['runtime_paths', 'workspace_path']),
    readStringValue(task, ['execution_context', 'workspace_path']),
  ),
}));
NODE
)"

read_task_create_field() {
  local field="$1"
  node - <<'NODE' "${TASK_CREATE_RESULT}" "${field}"
const [raw, field] = process.argv.slice(2);
let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  payload = {};
}
const value = payload && typeof payload[field] === 'string' ? payload[field].trim() : '';
process.stdout.write(value);
NODE
}

TASK_ID="$(read_task_create_field task_id)"
TASK_HOME_SEGMENT="$(read_task_create_field task_home_segment)"
TASK_HOME_PATH="$(read_task_create_field task_home_path)"
TASK_WORKSPACE_PATH="$(read_task_create_field workspace_path)"

if [[ -z "${TASK_ID}" ]]; then
  echo "[agent-task-terminal-smoke] task create response missing task_id: ${TASK_CREATE_RESULT}" >&2
  exit 1
fi

echo "[agent-task-terminal-smoke] workspace=${TASK_WS_ID} project=${TASK_PROJECT_ID} task=${TASK_ID}"

node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${TASK_PROJECT_ID}" "${TASK_ID}" "${API_BASE}"
const [token, workspaceId, projectId, taskId, apiBase] = process.argv.slice(2);
const base = `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;
const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}/runs`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    intent: 'Reply exactly: external terminal warmup ok',
  }),
});
if (!res.ok) {
  const text = await res.text();
  throw new Error(`warmup_run_failed:${res.status}:${text}`);
}
NODE

export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID TASK_ID TASK_HOME_SEGMENT TASK_HOME_PATH TASK_WORKSPACE_PATH

node <<'NODE'
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { WebSocket } = require('ws');

const token = process.env.TOKEN;
const apiBase = process.env.API_BASE;
const workspaceId = process.env.TASK_WS_ID;
const projectId = process.env.TASK_PROJECT_ID;
const taskId = process.env.TASK_ID;
const rootDir = process.env.ROOT_DIR || process.cwd();
const taskHomeSegment = process.env.TASK_HOME_SEGMENT || '';
const taskHomePathFromApi = process.env.TASK_HOME_PATH || '';
const workspacePathFromApi = process.env.TASK_WORKSPACE_PATH || '';
const terminalCols = 80;
const terminalRows = 24;

function withoutTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function resolveDeveloperWorkspaceRoot() {
  const configured = withoutTrailingSlash(process.env.MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT || '');
  if (configured) return configured;
  const home = withoutTrailingSlash(process.env.HOME || '');
  return home ? `${home}/ags-workspace` : '';
}

function resolveExpectedTaskHome() {
  if (taskHomePathFromApi.trim()) {
    return withoutTrailingSlash(taskHomePathFromApi.trim());
  }
  const developerRoot = resolveDeveloperWorkspaceRoot();
  if (developerRoot && taskHomeSegment) {
    return `${developerRoot}/${taskHomeSegment}`;
  }
  return '';
}

function resolveExpectedWorkspaceRoot() {
  if (workspacePathFromApi.trim()) {
    return withoutTrailingSlash(workspacePathFromApi.trim());
  }
  const expectedTaskHome = resolveExpectedTaskHome();
  return expectedTaskHome ? `${expectedTaskHome}/workspace` : '';
}

const expectedTaskHome = resolveExpectedTaskHome();
const expectedWorkspaceRoot = resolveExpectedWorkspaceRoot();
const forbiddenHostHome = taskHomeSegment ? `/home/${taskHomeSegment}` : '';

function fail(message, extra) {
  console.error('[agent-task-terminal-smoke] FAILED', message, extra ?? '');
  process.exit(1);
}

if (!expectedWorkspaceRoot) {
  fail('task_workspace_truth_missing', {
    task_id: taskId,
    task_home_segment: taskHomeSegment,
    task_home_path: taskHomePathFromApi,
    workspace_path: workspacePathFromApi,
  });
}
if (/^\/home\/(?:task_|taskhash-)/.test(expectedTaskHome)) {
  fail('developer_task_home_resolved_to_host_home', {
    task_id: taskId,
    task_home_segment: taskHomeSegment,
    task_home_path: expectedTaskHome,
  });
}

function runnerSocketHealthState() {
  const output = execFileSync(
    'bash',
    [
      '-lc',
      `set -euo pipefail
source "${path.join(rootDir, 'scripts/local-manual/common.sh')}"
runner_socket_health_state`,
    ],
    {
      cwd: rootDir,
      env: process.env,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
  return output.trim();
}

function ensureLocalManualRunnerConnected() {
  if (runnerSocketHealthState() === 'connected') {
    return;
  }
  execFileSync('bash', [path.join(rootDir, 'scripts/local-manual/start-runner.sh')], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
}

function makeCloseMarker(label) {
  const normalizedLabel = String(label || 'session').replace(/[^a-zA-Z0-9_]/g, '_');
  return `AGENTSMITH_TERMINAL_CLOSE_${normalizedLabel}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function buildMarkerForegroundCommand(marker) {
  return `bash -lc 'echo ${marker}_STARTED; exec -a ${marker} sleep 120'`;
}

function parseProcessTable(output) {
  return String(output || '')
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      };
    })
    .filter((entry) => entry && Number.isFinite(entry.pid) && entry.pid > 0);
}

function findMarkerProcesses(marker) {
  const output = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], {
    cwd: rootDir,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return parseProcessTable(output).filter((entry) => entry.command.includes(marker));
}

async function waitForMarkerProcessPresent(marker, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastProcesses = [];
  while (Date.now() - startedAt < timeoutMs) {
    lastProcesses = findMarkerProcesses(marker);
    if (lastProcesses.length > 0) return lastProcesses;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('marker_process_not_observed', { label, marker, processes: lastProcesses });
}

async function waitForMarkerProcessGone(marker, label, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastProcesses = [];
  while (Date.now() - startedAt < timeoutMs) {
    lastProcesses = findMarkerProcesses(marker);
    if (lastProcesses.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('marker_process_still_running_after_close', { label, marker, processes: lastProcesses });
}

(async () => {
  const createUrl =
    `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/tasks/${encodeURIComponent(taskId)}/terminal/sessions`;

  async function requestJson(url, init = {}) {
    const response = await fetch(url, init);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    return { response, payload, text };
  }

  async function createSession() {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const { response, payload } = await requestJson(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cols: terminalCols, rows: terminalRows }),
      });
      if (response.ok) {
        return payload;
      }
      if (response.status === 409 && payload?.message === 'task_run_in_progress') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (response.status === 409 && payload?.message === 'task_runner_offline') {
        ensureLocalManualRunnerConnected();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      fail(`create_session_${response.status}`, payload);
    }
    fail('create_session_timeout_waiting_for_runner');
  }

  async function listSessions() {
    const { response, payload, text } = await requestJson(createUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      fail(`list_sessions_${response.status}`, text);
    }
    return payload;
  }

  async function readSessionListForTruth() {
    const { response, payload, text } = await requestJson(createUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      payload,
      text,
    };
  }

  async function readSessionById(sessionId) {
    const { response, payload, text } = await requestJson(`${createUrl}/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      payload,
      text,
    };
  }

  function readListedTerminalSessionId(item) {
    if (!item || typeof item !== 'object') return '';
    if (typeof item.terminal_session_id === 'string' && item.terminal_session_id.trim()) {
      return item.terminal_session_id.trim();
    }
    return typeof item.id === 'string' ? item.id.trim() : '';
  }

  function readCanonicalListedTerminalSessionId(item) {
    if (!item || typeof item !== 'object') return '';
    return typeof item.terminal_session_id === 'string' ? item.terminal_session_id.trim() : '';
  }

  function readStringField(source, key) {
    if (!source || typeof source !== 'object') return '';
    return typeof source[key] === 'string' ? source[key].trim() : '';
  }

  function summarizeCloseTruth(sessionId, listed, readResult, listResult, lastError = null) {
    const session = readResult?.ok && readResult.payload && typeof readResult.payload === 'object'
      ? readResult.payload
      : null;
    const listPayload = listResult?.ok && listResult.payload && typeof listResult.payload === 'object'
      ? listResult.payload
      : null;
    const diagnosticSource = session || listed || null;
    return {
      session_id: sessionId,
      list_total: typeof listPayload?.total === 'number' ? listPayload.total : null,
      list_status: listResult?.status ?? null,
      get_status: readResult?.status ?? null,
      status: readStringField(diagnosticSource, 'status'),
      close_state: readStringField(diagnosticSource, 'close_state'),
      close_result: readStringField(diagnosticSource, 'close_result'),
      close_deadline_at: readStringField(diagnosticSource, 'close_deadline_at'),
      close_attempt_id: readStringField(diagnosticSource, 'close_attempt_id'),
      close_request_id: readStringField(diagnosticSource, 'close_request_id'),
      failure_kind: readStringField(diagnosticSource, 'failure_kind'),
      close_reason: readStringField(diagnosticSource, 'close_reason'),
      listed_session: listed,
      session,
      last_error: lastError,
    };
  }

  async function readTerminalSessionTruth(sessionId) {
    let listResult = null;
    let readResult = null;
    let lastError = null;
    try {
      listResult = await readSessionListForTruth();
      if (!listResult.ok) {
        lastError = `list_status:${listResult.status}:${listResult.text}`;
      }
    } catch (error) {
      lastError = `list:${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      readResult = await readSessionById(sessionId);
    } catch (error) {
      lastError = [lastError, `get:${error instanceof Error ? error.message : String(error)}`]
        .filter(Boolean)
        .join(';');
    }
    const listPayload = listResult?.ok && listResult.payload && typeof listResult.payload === 'object'
      ? listResult.payload
      : null;
    const listed = Array.isArray(listPayload?.items)
      ? listPayload.items.find((item) => readCanonicalListedTerminalSessionId(item) === sessionId) || null
      : null;
    return summarizeCloseTruth(sessionId, listed, readResult, listResult, lastError);
  }

  function isTerminalSessionFinalTruth(truth) {
    const status = String(truth?.status || '').toLowerCase();
    const closeState = String(truth?.close_state || '').toLowerCase();
    if (status === 'closed') {
      return 'closed';
    }
    if (status === 'failed' || closeState === 'expired') {
      return 'failed';
    }
    if (truth?.get_status === 404 && truth?.list_total !== null && !truth?.listed_session) {
      return 'closed';
    }
    return '';
  }

  async function waitForSessionFinalTruth(sessionId, label) {
    const timeoutMs = 60_000;
    const startedAt = Date.now();
    let lastTruth = null;
    while (Date.now() - startedAt < timeoutMs) {
      lastTruth = await readTerminalSessionTruth(sessionId);
      const outcome = isTerminalSessionFinalTruth(lastTruth);
      if (outcome) {
        return { ...lastTruth, outcome };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    fail('terminal_session_close_truth_timeout', {
      label,
      session_id: sessionId,
      last_session_truth: lastTruth,
      close_state: lastTruth?.close_state ?? null,
      close_result: lastTruth?.close_result ?? null,
      close_deadline_at: lastTruth?.close_deadline_at ?? null,
      close_attempt_id: lastTruth?.close_attempt_id ?? null,
      failure_kind: lastTruth?.failure_kind ?? null,
      close_reason: lastTruth?.close_reason ?? null,
    });
  }

  async function deleteSession(sessionId) {
    const { response, text } = await requestJson(`${createUrl}/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 204) {
      fail(`delete_session_${response.status}`, text);
    }
  }

  function readTerminalState(message) {
    if (!message || typeof message !== 'object') return '';
    if (typeof message.state === 'string' && message.state.trim()) return message.state.trim();
    return typeof message.status === 'string' ? message.status.trim() : '';
  }

  function isTerminalReadyHandshake(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'terminal.replay_end') {
      return message.input_enabled === true;
    }
    if (message.type === 'terminal.state') {
      const terminalState = readTerminalState(message);
      return (terminalState === 'ready' || terminalState === 'active' || terminalState === 'connected') && message.input_enabled === true;
    }
    return false;
  }

  function isTerminalWaitingHandshake(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'terminal.state') {
      const terminalState = readTerminalState(message);
      return terminalState === 'recovering' || terminalState === 'starting' || terminalState === 'pending' || terminalState === 'waiting';
    }
    return false;
  }

  function isTerminalFailureHandshake(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'terminal.error' || message.type === 'error') return true;
    if (message.type === 'terminal.state') {
      const terminalState = readTerminalState(message);
      return terminalState === 'failed' || terminalState === 'unavailable' || terminalState === 'attach_unavailable';
    }
    return false;
  }

  function readTerminalOutput(message) {
    if (!message || typeof message !== 'object') return '';
    if (message.type === 'terminal.output' || message.type === 'output') {
      if (typeof message.chunk === 'string') return message.chunk;
      if (typeof message.data !== 'string') return '';
      if (message.encoding === 'base64') {
        return Buffer.from(message.data, 'base64').toString('utf8');
      }
      return message.data;
    }
    return '';
  }

  function isTerminalClosedMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'exited' || message.type === 'closed') return true;
    if (message.type !== 'terminal.state') return false;
    const terminalState = readTerminalState(message);
    return terminalState === 'closed' || terminalState === 'session_ended';
  }

  async function openSession({ label }) {
    const created = await createSession();
    const terminalSessionId =
      typeof created.terminal_session_id === 'string' ? created.terminal_session_id.trim() : '';
    if (!terminalSessionId) {
      fail('create_session_missing_terminal_session_id', created);
    }
    console.log(`[agent-task-terminal-smoke] created ${label}`, terminalSessionId);

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        created.ws_url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'),
      );
      const state = {
        label,
        sessionId: terminalSessionId,
        sawReady: false,
        inputEnabled: false,
        lastHandshake: null,
        sawWizard: false,
        closed: false,
        exitCode: null,
        output: '',
      };
      let closedResolver = null;
      const closed = new Promise((resolveClosed) => {
        closedResolver = resolveClosed;
      });
      let resolved = false;

      const deadline = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error(`timeout:${label}`));
      }, 30000);

      function resolveReady(handshakeType) {
        if (resolved) return;
        resolved = true;
        state.sawReady = true;
        state.lastHandshake = handshakeType;
        clearTimeout(deadline);
        resolve({
          sessionId: terminalSessionId,
          ws,
          state,
          send(data) {
            ws.send(JSON.stringify({ type: 'terminal.stdin', data }));
          },
          async waitForOutput(fragment, timeoutMs = 30_000) {
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
              if (state.output.includes(fragment)) return;
              await new Promise((resume) => setTimeout(resume, 100));
            }
            throw new Error(`output_timeout:${label}:${fragment}`);
          },
          async waitForBrowserSocketClosed(timeoutMs = 10_000) {
            const timeout = new Promise((_, rejectTimeout) => {
              setTimeout(() => rejectTimeout(new Error(`browser_socket_close_timeout:${label}`)), timeoutMs);
            });
            await Promise.race([closed, timeout]);
          },
        });
      }

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'terminal.reconnect',
          terminal_session_id: terminalSessionId,
          cols: terminalCols,
          rows: terminalRows,
        }));
      });

      ws.on('message', (buffer) => {
        const message = JSON.parse(String(buffer));
        if (isTerminalReadyHandshake(message)) {
          state.inputEnabled = true;
          resolveReady(message.type);
          return;
        }
        if (isTerminalWaitingHandshake(message)) {
          state.inputEnabled = false;
          state.lastHandshake = message.type;
          return;
        }
        if (isTerminalFailureHandshake(message)) {
          clearTimeout(deadline);
          reject(new Error(`terminal_error:${label}:${JSON.stringify(message)}`));
          return;
        }
        const chunk = readTerminalOutput(message);
        if (chunk) {
          state.output += chunk;
          process.stdout.write(chunk);
          if (
            chunk.includes('zsh-newuser-install') ||
            chunk.includes('You are seeing this message because you have no zsh startup files')
          ) {
            state.sawWizard = true;
          }
          return;
        }
        if (isTerminalClosedMessage(message)) {
          state.closed = true;
          state.exitCode = message.exit_code ?? null;
          if (closedResolver) closedResolver();
        }
      });

      ws.on('error', (error) => {
        clearTimeout(deadline);
        reject(new Error(`socket_error:${label}:${error.message}`));
      });

      ws.on('close', () => {
        state.closed = true;
        if (closedResolver) closedResolver();
      });
    });
  }

  const first = await openSession({ label: 'session-one' });
  const firstMarker = makeCloseMarker('session-one');
  first.send(
    'pwd\n' +
    'export NOTEBOOK_SESSION_VAR=terminal_session_value\n' +
    'echo SESSION_VAR=$NOTEBOOK_SESSION_VAR\n' +
    `${buildMarkerForegroundCommand(firstMarker)}\n`,
  );
  await first.waitForOutput('SESSION_VAR=terminal_session_value');
  await first.waitForOutput(`${firstMarker}_STARTED`);
  await waitForMarkerProcessPresent(firstMarker, 'session-one');
  if (!first.state.output.includes(expectedWorkspaceRoot)) {
    fail('session_one_workspace_missing', first.state.output);
  }
  if (forbiddenHostHome && first.state.output.includes(forbiddenHostHome)) {
    fail('session_one_forbidden_host_home_path', {
      forbidden_host_home: forbiddenHostHome,
      output: first.state.output,
    });
  }
  if (first.state.sawWizard) {
    fail('session_one_unexpected_shell_wizard');
  }

  const second = await openSession({ label: 'session-two' });
  second.send('echo SESSION_VAR_SECOND=${NOTEBOOK_SESSION_VAR:-unset}\n');
  await second.waitForOutput('SESSION_VAR_SECOND=unset');
  if (second.state.sawWizard) {
    fail('session_two_unexpected_shell_wizard');
  }

  const listedTogether = await listSessions();
  const listedIds = new Set((listedTogether?.items ?? []).map(readListedTerminalSessionId));
  if (listedTogether?.total !== 2 || !listedIds.has(first.sessionId) || !listedIds.has(second.sessionId)) {
    fail('expected_two_sessions_listed', listedTogether);
  }

  await deleteSession(first.sessionId);
  const firstBrowserSocketClosed = await first.waitForBrowserSocketClosed().then(() => true, () => false);
  const firstCloseTruth = await waitForSessionFinalTruth(first.sessionId, 'session-one');
  await waitForMarkerProcessGone(firstMarker, 'session-one');
  const remainingAfterFirstClose = await listSessions();
  const remainingSessionId = readListedTerminalSessionId(remainingAfterFirstClose?.items?.[0]);
  if (
    remainingAfterFirstClose?.total !== 1
    || remainingSessionId !== second.sessionId
  ) {
    fail('remaining_after_first_close', remainingAfterFirstClose);
  }

  second.send('echo SESSION_TWO_STILL_ACTIVE\n');
  await second.waitForOutput('SESSION_TWO_STILL_ACTIVE');

  const secondMarker = makeCloseMarker('session-two');
  second.send(`${buildMarkerForegroundCommand(secondMarker)}\n`);
  await second.waitForOutput(`${secondMarker}_STARTED`);
  await waitForMarkerProcessPresent(secondMarker, 'session-two');

  await deleteSession(second.sessionId);
  const secondBrowserSocketClosed = await second.waitForBrowserSocketClosed().then(() => true, () => false);
  const secondCloseTruth = await waitForSessionFinalTruth(second.sessionId, 'session-two');
  await waitForMarkerProcessGone(secondMarker, 'session-two');
  const remainingAfterLastClose = await listSessions();
  if (remainingAfterLastClose?.total !== 0) {
    fail('remaining_after_last_close', remainingAfterLastClose);
  }

  console.log('\n[agent-task-terminal-smoke] task released after last terminal session');
  console.log('\n[agent-task-terminal-smoke] success', JSON.stringify({
    first_session_id: first.sessionId,
    second_session_id: second.sessionId,
    first_close_outcome: firstCloseTruth.outcome,
    second_close_outcome: secondCloseTruth.outcome,
    browser_socket_closed: {
      session_one: firstBrowserSocketClosed,
      session_two: secondBrowserSocketClosed,
    },
    remaining_after_first_close: remainingAfterFirstClose.total,
    remaining_after_last_close: remainingAfterLastClose.total,
  }));
  process.exit(0);
})();
NODE
