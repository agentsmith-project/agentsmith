#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"
export ROOT_DIR
INTERNAL_RUNTIME_CLEANUP_MARKER="${LOCAL_MANUAL_INTERNAL_RUNTIME_CLEANUP_MARKER}"
export INTERNAL_RUNTIME_CLEANUP_MARKER

INTERNAL_RUNTIME_BOOTSTRAPPED=0
cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" && ( "${INTERNAL_RUNTIME_BOOTSTRAPPED}" == "1" || -f "${INTERNAL_RUNTIME_CLEANUP_MARKER}" ) ]]; then
    bash "${ROOT_DIR}/scripts/local-manual/internal-down.sh" --no-api-restart >/dev/null 2>&1 || true
  fi
  rm -f "${INTERNAL_RUNTIME_CLEANUP_MARKER}" >/dev/null 2>&1 || true
}
trap 'cleanup_on_exit $?' EXIT INT TERM

ensure_local_manual_ready
ensure_agent_task_diagnostics_ready
if [[ "${SKIP_INTERNAL_UP:-0}" != "1" ]]; then
  bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh" >/dev/null
  INTERNAL_RUNTIME_BOOTSTRAPPED=1
  mkdir -p "$(dirname "${INTERNAL_RUNTIME_CLEANUP_MARKER}")"
  : > "${INTERNAL_RUNTIME_CLEANUP_MARKER}"
fi

TOKEN="$(cat "$(backend_real_token_file)")"
PROJECT_ID="${TASK_PROJECT_ID:-$(state_get project.id)}"
API_BASE="${API_BASE:-http://localhost:${PORT_API}}"
TASK_WS_ID="${TASK_WS_ID:-${WORKSPACE_ID}}"
TASK_AGENT_RUNNER_PROVIDER="${TASK_AGENT_RUNNER_PROVIDER:-$(state_get agent_runner.runner_provider)}"

if [[ -z "${TOKEN}" || -z "${PROJECT_ID}" ]]; then
  echo "[agent-task-terminal-internal-smoke] missing local-manual internal state" >&2
  exit 1
fi
if [[ "${TASK_AGENT_RUNNER_PROVIDER}" != "managed" ]]; then
  echo "[agent-task-terminal-internal-smoke] expected managed runner diagnostic state for internal smoke (provider=${TASK_AGENT_RUNNER_PROVIDER:-missing})" >&2
  exit 1
fi

TASK_ID="$(
  node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${PROJECT_ID}" "${API_BASE}"
const [token, workspaceId, projectId, apiBase] = process.argv.slice(2);
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
        title: `Internal Terminal Smoke ${Date.now()}`,
        workspace_mode: 'create_new',
      }),
    });
    break;
  } catch (error) {
    lastError = error;
    await sleep(1500 * (attempt + 1));
  }
}

if (!task?.id) throw lastError ?? new Error('task_id_missing');
process.stdout.write(task.id);
NODE
)"

echo "[agent-task-terminal-internal-smoke] workspace=${TASK_WS_ID} project=${PROJECT_ID} task=${TASK_ID}"

node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${PROJECT_ID}" "${TASK_ID}" "${API_BASE}"
const [token, workspaceId, projectId, taskId, apiBase] = process.argv.slice(2);
const base = `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;
const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}/runs`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    intent: 'Reply exactly: internal terminal warmup ok',
  }),
});
if (!res.ok) {
  const text = await res.text();
  throw new Error(`warmup_run_failed:${res.status}:${text}`);
}
NODE

WORKLOAD_ID="$(node - <<'NODE' "${TASK_ID}"
const id = process.argv[2];
const normalized = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
process.stdout.write(normalized || 'workload');
NODE
)"

for _ in $(seq 1 90); do
  POD_NAME="$(kubectl get pods -n "${K8S_NAMESPACE}" -l "workload_id=${WORKLOAD_ID}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${POD_NAME}" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "${POD_NAME:-}" ]]; then
  echo "[agent-task-terminal-internal-smoke] FAILED workload_pod_not_observed task=${TASK_ID}" >&2
  exit 1
fi

export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID="${PROJECT_ID}" TASK_ID POD_NAME K8S_NAMESPACE

node <<'NODE'
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');

const token = process.env.TOKEN;
const apiBase = process.env.API_BASE;
const workspaceId = process.env.TASK_WS_ID;
const projectId = process.env.TASK_PROJECT_ID;
const taskId = process.env.TASK_ID;
const rootDir = process.env.ROOT_DIR || process.cwd();
const terminalCols = 80;
const terminalRows = 24;
const cleanupMarker =
  process.env.INTERNAL_RUNTIME_CLEANUP_MARKER ||
  path.join(rootDir, 'artifacts/runtime/lines/local-manual/current/local-manual-internal-runtime.cleanup');

function fail(message, extra) {
  console.error('[agent-task-terminal-internal-smoke] FAILED', message, extra ?? '');
  process.exit(1);
}

function restartInternalRuntime() {
  execFileSync('bash', [path.join(rootDir, 'scripts/local-manual/internal-up.sh')], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  fs.mkdirSync(path.dirname(cleanupMarker), { recursive: true });
  fs.writeFileSync(cleanupMarker, '1\n', 'utf8');
}

const podName = process.env.POD_NAME || '';
const k8sNamespace = process.env.K8S_NAMESPACE || 'default';

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

function isWorkloadGoneKubectlExecError(stderr) {
  const text = String(stderr || '');
  return [
    /\bpod\b.*\bnot found\b/i,
    /\bpods?\b.*\bnot found\b/i,
    /\bcontainer\b.*\bnot found\b/i,
    /\btask\b.*\bnot found\b/i,
    /\bcontainer\b.*\bnot running\b/i,
    /\bcontainer\b.*\bis not running\b/i,
  ].some((pattern) => pattern.test(text));
}

function readExecErrorStream(error, key, outputIndex) {
  const value = error?.[key] ?? (Array.isArray(error?.output) ? error.output[outputIndex] : null);
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function markerProbeDiagnostics(probe) {
  return {
    label: probe?.label ?? null,
    marker: probe?.marker ?? null,
    probe_classification: probe?.classification ?? null,
    pod_name: probe?.pod_name || podName,
    namespace: probe?.namespace || k8sNamespace,
    process_count: probe?.process_count ?? null,
    processes: probe?.processes ?? [],
    stderr: probe?.stderr ?? '',
    stdout: probe?.stdout ?? '',
    error: probe?.error ?? '',
    status: probe?.status ?? null,
  };
}

function probeMarkerProcesses(marker, label) {
  if (!podName) {
    fail('marker_process_pod_name_missing', { label, marker, pod_name: podName });
  }
  try {
    const output = execFileSync('kubectl', [
      'exec',
      '-n',
      k8sNamespace,
      podName,
      '--',
      'ps',
      '-eo',
      'pid=,ppid=,args=',
    ], {
      cwd: rootDir,
      env: process.env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const processes = parseProcessTable(output).filter((entry) => entry.command.includes(marker));
    if (processes.length > 0) {
      return {
        classification: 'present',
        label,
        marker,
        pod_name: podName,
        namespace: k8sNamespace,
        process_count: processes.length,
        processes,
      };
    }
    return {
      classification: 'absent',
      label,
      marker,
      pod_name: podName,
      namespace: k8sNamespace,
      process_count: 0,
      processes,
    };
  } catch (error) {
    const stderr = readExecErrorStream(error, 'stderr', 2);
    const stdout = readExecErrorStream(error, 'stdout', 1);
    const message = error instanceof Error ? error.message : String(error);
    const combinedErrorText = [stderr, stdout, message].filter(Boolean).join('\n');
    if (isWorkloadGoneKubectlExecError(combinedErrorText)) {
      return {
        classification: 'workload_gone',
        label,
        marker,
        pod_name: podName,
        namespace: k8sNamespace,
        process_count: null,
        processes: [],
        stderr,
        stdout,
        error: message,
        status: typeof error?.status === 'number' ? error.status : null,
      };
    }
    return {
      classification: 'exec_error',
      label,
      marker,
      pod_name: podName,
      namespace: k8sNamespace,
      process_count: null,
      processes: [],
      stderr,
      stdout,
      error: message,
      status: typeof error?.status === 'number' ? error.status : null,
    };
  }
}

function findMarkerProcesses(marker) {
  const probe = probeMarkerProcesses(marker, 'find-marker-processes');
  if (probe.classification === 'present' || probe.classification === 'absent') {
    return probe.processes;
  }
  fail('marker_process_probe_unexpected_classification', markerProbeDiagnostics(probe));
}

async function waitForMarkerProcessPresent(marker, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastProbe = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastProbe = probeMarkerProcesses(marker, label);
    if (lastProbe.classification === 'present') return lastProbe;
    if (lastProbe.classification === 'workload_gone') {
      fail('marker_process_workload_gone_before_observed', markerProbeDiagnostics(lastProbe));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('marker_process_not_observed', {
    label,
    marker,
    probe_classification: lastProbe?.classification ?? null,
    pod_name: podName,
    last_probe: markerProbeDiagnostics(lastProbe),
  });
}

function normalizeMarkerGoneContext(labelOrContext, contextOrTimeoutMs, timeoutMs) {
  let context = {};
  let resolvedTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 60_000;
  if (labelOrContext && typeof labelOrContext === 'object') {
    context = { ...labelOrContext };
    if (typeof contextOrTimeoutMs === 'number') {
      resolvedTimeoutMs = contextOrTimeoutMs;
    }
  } else {
    context = contextOrTimeoutMs && typeof contextOrTimeoutMs === 'object'
      ? { ...contextOrTimeoutMs }
      : {};
    context.label = String(labelOrContext || context.label || 'session');
    if (typeof contextOrTimeoutMs === 'number') {
      resolvedTimeoutMs = contextOrTimeoutMs;
    }
  }
  if (!context.label) context.label = 'session';
  return { context, timeoutMs: resolvedTimeoutMs };
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

async function waitForMarkerProcessGone(marker, labelOrContext, contextOrTimeoutMs = {}, timeoutMs = 60_000) {
  const normalized = normalizeMarkerGoneContext(labelOrContext, contextOrTimeoutMs, timeoutMs);
  const context = normalized.context;
  const label = context.label;
  const expectedRemainingSessions = context.expectedRemainingSessions;
  const finalTruth = context.finalTruth;
  const startedAt = Date.now();
  let lastProbe = null;
  while (Date.now() - startedAt < normalized.timeoutMs) {
    lastProbe = probeMarkerProcesses(marker, label);
    if (lastProbe.classification === 'absent') return lastProbe;
    if (lastProbe.classification === 'workload_gone') {
      const finalTruthOutcome = finalTruth?.outcome || isTerminalSessionFinalTruth(finalTruth);
      if (expectedRemainingSessions === 0 && finalTruthOutcome) {
        console.log(
          `[agent-task-terminal-internal-smoke] marker probe ${label} workload_gone`,
          JSON.stringify(markerProbeDiagnostics(lastProbe)),
        );
        return { ...lastProbe, final_truth_outcome: finalTruthOutcome };
      }
      if (typeof expectedRemainingSessions === 'number' && expectedRemainingSessions > 0) {
        fail('workload_gone_with_live_terminal_session', {
          ...markerProbeDiagnostics(lastProbe),
          expected_remaining_sessions: expectedRemainingSessions,
          live_terminal_session_id: context.liveTerminalSessionId ?? null,
          final_truth_outcome: finalTruthOutcome || null,
        });
      }
      fail('workload_gone_without_final_session_truth', {
        ...markerProbeDiagnostics(lastProbe),
        expected_remaining_sessions: expectedRemainingSessions ?? null,
        final_truth_outcome: finalTruthOutcome || null,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (lastProbe?.classification === 'exec_error') {
    fail('marker_process_exec_error_after_close', {
      label,
      marker,
      probe_classification: lastProbe.classification,
      pod_name: podName,
      last_probe: markerProbeDiagnostics(lastProbe),
    });
  }
  fail('marker_process_still_running_after_close', {
    label,
    marker,
    probe_classification: lastProbe?.classification ?? null,
    pod_name: podName,
    last_probe: markerProbeDiagnostics(lastProbe),
  });
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
        restartInternalRuntime();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      if (response.status === 400 && payload?.message === 'sandbox_startup_timeout') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      if (response.status === 409 && payload?.message === 'task_terminal_internal_runtime_unavailable') {
        restartInternalRuntime();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      if (response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      fail(`create_session_${response.status}`, payload);
    }
    fail('create_session_timeout_waiting_for_warmup_run');
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
    console.log(`[agent-task-terminal-internal-smoke] created ${label}`, terminalSessionId);

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
  if (!first.state.output.includes('/workspace')) {
    fail('session_one_workspace_missing', first.state.output);
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
  const remainingAfterFirstClose = await listSessions();
  const remainingSessionId = readListedTerminalSessionId(remainingAfterFirstClose?.items?.[0]);
  if (
    remainingAfterFirstClose?.total !== 1
    || remainingSessionId !== second.sessionId
  ) {
    fail('remaining_after_first_close', remainingAfterFirstClose);
  }
  const firstGoneProbe = await waitForMarkerProcessGone(firstMarker, {
    label: 'session-one',
    expectedRemainingSessions: remainingAfterFirstClose?.total,
    liveTerminalSessionId: second.sessionId,
    finalTruth: firstCloseTruth,
  });

  second.send('echo SESSION_TWO_STILL_ACTIVE\n');
  await second.waitForOutput('SESSION_TWO_STILL_ACTIVE');

  const secondMarker = makeCloseMarker('session-two');
  second.send(`${buildMarkerForegroundCommand(secondMarker)}\n`);
  await second.waitForOutput(`${secondMarker}_STARTED`);
  await waitForMarkerProcessPresent(secondMarker, 'session-two');

  await deleteSession(second.sessionId);
  const secondBrowserSocketClosed = await second.waitForBrowserSocketClosed().then(() => true, () => false);
  const secondCloseTruth = await waitForSessionFinalTruth(second.sessionId, 'session-two');
  const remainingAfterLastClose = await listSessions();
  if (remainingAfterLastClose?.total !== 0) {
    fail('remaining_after_last_close', remainingAfterLastClose);
  }
  const secondGoneProbe = await waitForMarkerProcessGone(secondMarker, {
    label: 'session-two',
    expectedRemainingSessions: remainingAfterLastClose?.total,
    finalTruth: secondCloseTruth,
  });

  console.log('\n[agent-task-terminal-internal-smoke] task released after last terminal session');
  console.log('\n[agent-task-terminal-internal-smoke] success', JSON.stringify({
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
    marker_probe: {
      session_one: markerProbeDiagnostics(firstGoneProbe),
      session_two: markerProbeDiagnostics(secondGoneProbe),
    },
  }));
  process.exit(0);
})();
NODE
