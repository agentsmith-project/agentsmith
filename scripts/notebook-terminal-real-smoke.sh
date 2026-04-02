#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

TASK_WS_ID="${TASK_WS_ID:-ws_default}"
TASK_PROJECT_ID="${TASK_PROJECT_ID:-proj_1775067184556_95890}"
TASK_ID="${TASK_ID:-task_4a307f2e08ad4a9ca6b5823abd4bc2aa}"
API_BASE="${API_BASE:-http://localhost:21000}"
TOKEN_FILE="${TOKEN_FILE:-${ROOT_DIR}/artifacts/backend-real/current/token.txt}"

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[notebook-terminal-smoke] missing token file: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(<"${TOKEN_FILE}")"

if [[ -z "${TOKEN}" ]]; then
  echo "[notebook-terminal-smoke] empty token" >&2
  exit 1
fi

echo "[notebook-terminal-smoke] workspace=${TASK_WS_ID} project=${TASK_PROJECT_ID} task=${TASK_ID}"

export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID TASK_ID

node <<'NODE'
const { WebSocket } = require('ws');

const token = process.env.TOKEN;
const apiBase = process.env.API_BASE;
const workspaceId = process.env.TASK_WS_ID;
const projectId = process.env.TASK_PROJECT_ID;
const taskId = process.env.TASK_ID;

function fail(message, extra) {
  console.error('[notebook-terminal-smoke] FAILED', message, extra ?? '');
  process.exit(1);
}

(async () => {
  const createUrl =
    `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/tasks/${encodeURIComponent(taskId)}/terminal/sessions`;

  const create = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ cols: 80, rows: 24 }),
  });
  const created = await create.json();
  if (!create.ok) fail(`create_session_${create.status}`, created);

  console.log('[notebook-terminal-smoke] created', created.session_id);

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
  }, 20000);

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
      }, 500);
      return;
    }

    if (message.type === 'output') {
      const chunk = typeof message.chunk === 'string' ? message.chunk : '';
      process.stdout.write(chunk);
      if (chunk.includes('/home/percy/ags-workspaces/')) sawPwd = true;
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
      console.log('\n[notebook-terminal-smoke] success', JSON.stringify({
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
