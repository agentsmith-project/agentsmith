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

  let created = null;
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
      created = payload;
      break;
    }
    if (
      create.status === 409 && payload?.message === 'task_run_in_progress'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (
      create.status === 400 && payload?.message === 'sandbox_startup_timeout'
    ) {
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
    if (!(
      create.status === 409 && payload?.message === 'task_run_in_progress'
    )) {
      fail(`create_session_${create.status}`, payload);
    }
  }
  if (!created) fail('create_session_timeout_waiting_for_warmup_run');

  console.log('[notebook-terminal-internal-smoke] created', created.session_id);

  const ws = new WebSocket(
    created.ws_url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'),
  );

  let sawStarted = false;
  let sawPwd = false;
  let sawEcho = false;
  let sawWizard = false;

  const deadline = setTimeout(() => {
    try { ws.close(); } catch {}
    fail('timeout', { sawStarted, sawPwd, sawEcho, sawWizard });
  }, 30000);

  ws.on('message', (buffer) => {
    const message = JSON.parse(String(buffer));
    if (message.type === 'started') {
      sawStarted = true;
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'terminal.stdin',
          data: 'pwd\necho NOTEBOOK_TERMINAL_READY\n',
        }));
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'terminal.stdin',
            data: 'exit\n',
          }));
        }, 500);
      }, 750);
      return;
    }

    if (message.type === 'output') {
      const chunk = typeof message.chunk === 'string' ? message.chunk : '';
      process.stdout.write(chunk);
      if (chunk.includes('/workspace')) sawPwd = true;
      if (chunk.includes('NOTEBOOK_TERMINAL_READY')) sawEcho = true;
      if (
        chunk.includes('zsh-newuser-install') ||
        chunk.includes('You are seeing this message because you have no zsh startup files')
      ) {
        sawWizard = true;
      }
      return;
    }

    if (message.type === 'exited' || message.type === 'closed') {
      clearTimeout(deadline);
      if (!sawStarted || !sawPwd || !sawEcho || sawWizard) {
        fail('unexpected_terminal_result', {
          sawStarted,
          sawPwd,
          sawEcho,
          sawWizard,
          event: message.type,
          exitCode: message.exit_code ?? null,
        });
      }
      console.log('\n[notebook-terminal-internal-smoke] success', JSON.stringify({
        session_id: created.session_id,
        exit_code: message.exit_code ?? null,
      }));
      process.exit(0);
    }

    if (message.type === 'error') {
      clearTimeout(deadline);
      fail('terminal_error', message);
    }
  });

  ws.on('error', (error) => {
    clearTimeout(deadline);
    fail('socket_error', error.message);
  });
})();
NODE
