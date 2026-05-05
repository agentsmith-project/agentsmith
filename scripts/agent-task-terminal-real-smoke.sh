#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
    if bash "${ROOT_DIR}/scripts/local-manual/seed-agent-task-demo.sh" >/dev/null; then
      break
    fi
    if [[ "${attempt}" == "4" ]]; then
      echo "[agent-task-terminal-smoke] failed to seed agent-task demo after retries" >&2
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
API_BASE="${API_BASE:-http://localhost:${PORT_API}}"

if [[ -z "${TASK_PROJECT_ID}" ]]; then
  echo "[agent-task-terminal-smoke] missing local-manual agent-task demo state" >&2
  exit 1
fi

TASK_ID="$(
  node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${TASK_PROJECT_ID}" "${API_BASE}"
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
        title: `External Terminal Smoke ${Date.now()}`,
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

export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID TASK_ID

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
const expectedWorkspaceRoot = `${process.env.HOME || ''}/ags-workspace/${taskId}`;

function fail(message, extra) {
  console.error('[agent-task-terminal-smoke] FAILED', message, extra ?? '');
  process.exit(1);
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
    console.log(`[agent-task-terminal-smoke] created ${label}`, created.session_id);

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
  if (!first.state.output.includes(expectedWorkspaceRoot)) {
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

  console.log('\n[agent-task-terminal-smoke] task released after last terminal session');
  console.log('\n[agent-task-terminal-smoke] success', JSON.stringify({
    first_session_id: first.sessionId,
    second_session_id: second.sessionId,
    remaining_after_first_close: remainingAfterFirstClose.total,
    remaining_after_last_close: remainingAfterLastClose.total,
  }));
  process.exit(0);
})();
NODE
