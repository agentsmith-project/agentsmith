#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"

ensure_local_manual_ready
ensure_notebook_demo_seeded
if [[ "${SKIP_INTERNAL_UP:-0}" != "1" ]]; then
  bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh" >/dev/null
fi

TOKEN="$(cat "$(backend_real_token_file)")"
PROJECT_ID="${TASK_PROJECT_ID:-$(state_get project.id)}"
AGENT_ID="${TASK_AGENT_ID:-$(state_get internal_agent.id)}"
API_BASE="${API_BASE:-http://localhost:${PORT_API}}"
TASK_WS_ID="${TASK_WS_ID:-${WORKSPACE_ID}}"

if [[ -z "${TOKEN}" || -z "${PROJECT_ID}" || -z "${AGENT_ID}" ]]; then
  echo "[notebook-terminal-internal-smoke] missing local-manual internal state" >&2
  exit 1
fi

TASK_ID="$(
  node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${PROJECT_ID}" "${AGENT_ID}" "${API_BASE}"
const [token, workspaceId, projectId, agentId, apiBase] = process.argv.slice(2);
const base = `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const request = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}:${text}`);
  return text ? JSON.parse(text) : null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tasks = await request(`${base}/tasks`, {
  headers: { Authorization: `Bearer ${token}` },
});

let task = null;
let lastError = null;
for (let attempt = 0; attempt < 4; attempt += 1) {
  try {
    task = await request(`${base}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Internal Terminal Smoke ${Date.now()}`,
        agent_id: agentId,
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

echo "[notebook-terminal-internal-smoke] workspace=${TASK_WS_ID} project=${PROJECT_ID} task=${TASK_ID}"

node - <<'NODE' "${TOKEN}" "${TASK_WS_ID}" "${PROJECT_ID}" "${TASK_ID}" "${API_BASE}"
const [token, workspaceId, projectId, taskId, apiBase] = process.argv.slice(2);
const base = `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;
const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}/messages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    role: 'user',
    content: 'Reply exactly: internal terminal warmup ok',
  }),
});
if (!res.ok) {
  const text = await res.text();
  throw new Error(`warmup_message_failed:${res.status}:${text}`);
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
  echo "[notebook-terminal-internal-smoke] FAILED workload_pod_not_observed task=${TASK_ID}" >&2
  exit 1
fi

export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID="${PROJECT_ID}" TASK_ID

node <<'NODE'
const { WebSocket } = require('ws');

const token = process.env.TOKEN;
const apiBase = process.env.API_BASE;
const workspaceId = process.env.TASK_WS_ID;
const projectId = process.env.TASK_PROJECT_ID;
const taskId = process.env.TASK_ID;

function fail(message, extra) {
  console.error('[notebook-terminal-internal-smoke] FAILED', message, extra ?? '');
  process.exit(1);
}

(async () => {
  const createUrl =
    `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/tasks/${encodeURIComponent(taskId)}/terminal/sessions`;

  async function createSession() {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const create = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      });
      const payload = await create.json();
      if (create.ok) {
        return payload;
      }
      if (create.status === 409 && payload?.message === 'task_run_in_progress') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (create.status === 400 && payload?.message === 'sandbox_startup_timeout') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      if (
        create.status >= 500
        || (create.status === 409 && payload?.message === 'task_terminal_internal_runtime_unavailable')
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      fail(`create_session_${create.status}`, payload);
    }
    fail('create_session_timeout_waiting_for_warmup_run');
  }

  async function runSession({
    label,
    onStarted,
    onOutput,
    validate,
  }) {
    const created = await createSession();
    console.log(`[notebook-terminal-internal-smoke] created ${label}`, created.session_id);

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        created.ws_url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'),
      );
      const state = {
        sawStarted: false,
        sawWizard: false,
        exitCode: null,
      };
      const deadline = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error(`timeout:${label}`));
      }, 30000);

      ws.on('message', (buffer) => {
        const message = JSON.parse(String(buffer));
        if (message.type === 'started') {
          state.sawStarted = true;
          onStarted(ws);
          return;
        }
        if (message.type === 'output') {
          const chunk = typeof message.chunk === 'string' ? message.chunk : '';
          process.stdout.write(chunk);
          if (
            chunk.includes('zsh-newuser-install') ||
            chunk.includes('You are seeing this message because you have no zsh startup files')
          ) {
            state.sawWizard = true;
          }
          onOutput(chunk, ws, state);
          return;
        }
        if (message.type === 'error') {
          clearTimeout(deadline);
          reject(new Error(`terminal_error:${label}:${JSON.stringify(message)}`));
          return;
        }
        if (message.type === 'exited' || message.type === 'closed') {
          clearTimeout(deadline);
          state.exitCode = message.exit_code ?? null;
          try {
            validate(state);
            resolve({ sessionId: created.session_id, exitCode: state.exitCode });
          } catch (error) {
            reject(error);
          }
        }
      });

      ws.on('error', (error) => {
        clearTimeout(deadline);
        reject(new Error(`socket_error:${label}:${error.message}`));
      });
    });
  }

  const firstState = {
    sawPwd: false,
    sawSessionVar: false,
    sawInterrupted: false,
  };
  const first = await runSession({
    label: 'session-one',
    onStarted: (ws) => {
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'terminal.stdin',
          data: 'pwd\nexport NOTEBOOK_SESSION_VAR=terminal_session_value\necho SESSION_VAR=$NOTEBOOK_SESSION_VAR\nsleep 30\n',
        }));
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'terminal.stdin', data: '\u0003' }));
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: 'terminal.stdin',
              data: 'echo INTERRUPTED_OK\nexit\n',
            }));
          }, 300);
        }, 1000);
      }, 750);
    },
    onOutput: (chunk) => {
      if (chunk.includes('/workspace')) {
        firstState.sawPwd = true;
      }
      if (chunk.includes('SESSION_VAR=terminal_session_value')) {
        firstState.sawSessionVar = true;
      }
      if (chunk.includes('INTERRUPTED_OK')) {
        firstState.sawInterrupted = true;
      }
    },
    validate: (state) => {
      if (!state.sawStarted || !firstState.sawPwd || !firstState.sawSessionVar || !firstState.sawInterrupted || state.sawWizard) {
        fail('unexpected_terminal_result', {
          label: 'session-one',
          sawStarted: state.sawStarted,
          sawPwd: firstState.sawPwd,
          sawSessionVar: firstState.sawSessionVar,
          sawInterrupted: firstState.sawInterrupted,
          sawWizard: state.sawWizard,
          exitCode: state.exitCode,
        });
      }
    },
  });

  const secondState = {
    sawSessionReset: false,
  };
  const second = await runSession({
    label: 'session-two',
    onStarted: (ws) => {
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'terminal.stdin',
          data: 'echo SESSION_VAR_SECOND=${NOTEBOOK_SESSION_VAR:-unset}\nexit\n',
        }));
      }, 750);
    },
    onOutput: (chunk) => {
      if (chunk.includes('SESSION_VAR_SECOND=unset')) {
        secondState.sawSessionReset = true;
      }
    },
    validate: (state) => {
      if (!state.sawStarted || !secondState.sawSessionReset || state.sawWizard) {
        fail('unexpected_terminal_result', {
          label: 'session-two',
          sawStarted: state.sawStarted,
          sawSessionReset: secondState.sawSessionReset,
          sawWizard: state.sawWizard,
          exitCode: state.exitCode,
        });
      }
    },
  });

  console.log('\n[notebook-terminal-internal-smoke] success', JSON.stringify({
    first_session_id: first.sessionId,
    second_session_id: second.sessionId,
    exit_code: second.exitCode ?? first.exitCode ?? null,
  }));
  process.exit(0);
})();
NODE
