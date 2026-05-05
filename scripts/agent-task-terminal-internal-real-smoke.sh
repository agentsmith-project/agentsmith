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
ensure_agent_task_demo_seeded
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

if [[ -z "${TOKEN}" || -z "${PROJECT_ID}" ]]; then
  echo "[agent-task-terminal-internal-smoke] missing local-manual internal state" >&2
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

export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID="${PROJECT_ID}" TASK_ID

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

(async () => {
  const createUrl =
    `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/tasks/${encodeURIComponent(taskId)}/terminal/sessions`;

  async function requestJson(url, init = {}) {
    const response = await fetch(url, init);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
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
        body: JSON.stringify({ cols: 80, rows: 24 }),
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

  async function openSession({ label }) {
    const created = await createSession();
    console.log(`[agent-task-terminal-internal-smoke] created ${label}`, created.session_id);

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        created.ws_url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'),
      );
      const state = {
        label,
        sessionId: created.session_id,
        sawStarted: false,
        sawWizard: false,
        closed: false,
        exitCode: null,
        output: '',
      };
      let closedResolver = null;
      const closed = new Promise((resolveClosed) => {
        closedResolver = resolveClosed;
      });
      const deadline = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error(`timeout:${label}`));
      }, 30000);

      ws.on('message', (buffer) => {
        const message = JSON.parse(String(buffer));
        if (message.type === 'started') {
          state.sawStarted = true;
          clearTimeout(deadline);
          resolve({
            sessionId: created.session_id,
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
            async waitForClosed(timeoutMs = 30_000) {
              const timeout = new Promise((_, rejectTimeout) => {
                setTimeout(() => rejectTimeout(new Error(`close_timeout:${label}`)), timeoutMs);
              });
              await Promise.race([closed, timeout]);
            },
          });
        } else if (message.type === 'output') {
          const chunk = typeof message.chunk === 'string' ? message.chunk : '';
          state.output += chunk;
          process.stdout.write(chunk);
          if (
            chunk.includes('zsh-newuser-install') ||
            chunk.includes('You are seeing this message because you have no zsh startup files')
          ) {
            state.sawWizard = true;
          }
        } else if (message.type === 'error') {
          clearTimeout(deadline);
          reject(new Error(`terminal_error:${label}:${JSON.stringify(message)}`));
        } else if (message.type === 'exited' || message.type === 'closed') {
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
  first.send('pwd\nexport NOTEBOOK_SESSION_VAR=terminal_session_value\necho SESSION_VAR=$NOTEBOOK_SESSION_VAR\nsleep 120\n');
  await first.waitForOutput('SESSION_VAR=terminal_session_value');
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
  const listedIds = new Set((listedTogether?.items ?? []).map((item) => item.id));
  if (listedTogether?.total !== 2 || !listedIds.has(first.sessionId) || !listedIds.has(second.sessionId)) {
    fail('expected_two_sessions_listed', listedTogether);
  }

  await deleteSession(first.sessionId);
  await first.waitForClosed();
  const remainingAfterFirstClose = await listSessions();
  if (
    remainingAfterFirstClose?.total !== 1
    || remainingAfterFirstClose.items?.[0]?.id !== second.sessionId
  ) {
    fail('remaining_after_first_close', remainingAfterFirstClose);
  }

  second.send('echo SESSION_TWO_STILL_ACTIVE\n');
  await second.waitForOutput('SESSION_TWO_STILL_ACTIVE');

  await deleteSession(second.sessionId);
  await second.waitForClosed();
  const remainingAfterLastClose = await listSessions();
  if (remainingAfterLastClose?.total !== 0) {
    fail('remaining_after_last_close', remainingAfterLastClose);
  }

  console.log('\n[agent-task-terminal-internal-smoke] task released after last terminal session');
  console.log('\n[agent-task-terminal-internal-smoke] success', JSON.stringify({
    first_session_id: first.sessionId,
    second_session_id: second.sessionId,
    remaining_after_first_close: remainingAfterFirstClose.total,
    remaining_after_last_close: remainingAfterLastClose.total,
  }));
  process.exit(0);
})();
NODE
