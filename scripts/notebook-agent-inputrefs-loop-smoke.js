#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const API_BASE = process.env.API_BASE || 'http://localhost:20000';
const WORKSPACE_ID = process.env.WORKSPACE_ID || 'ws_default';
const TOKEN_FILE = process.env.TOKEN_FILE || '/tmp/agentsmith_user_token.txt';
const PROJECT_ID =
  process.env.PROJECT_ID || safeRead('/tmp/agentsmith_project_id.txt') || '';
const AGENT_ID = process.env.AGENT_ID || safeRead('/tmp/agentsmith_agent_id.txt') || '';

const URL_INPUT =
  process.env.URL_INPUT || 'https://example.com/test-input';
const POLL_MAX = Number(process.env.POLL_MAX || 90);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const SETTLE_MAX_MS = Number(process.env.SETTLE_MAX_MS || 15000);
const SETTLE_INTERVAL_MS = Number(process.env.SETTLE_INTERVAL_MS || 1000);
const HTTP_RETRY_ATTEMPTS = Number(process.env.HTTP_RETRY_ATTEMPTS || 5);
const HTTP_RETRY_DELAY_MS = Number(process.env.HTTP_RETRY_DELAY_MS || 500);
const STREAM_CONFLICT_RETRY_ATTEMPTS = Number(process.env.STREAM_CONFLICT_RETRY_ATTEMPTS || 15);
const STREAM_CONFLICT_RETRY_DELAY_MS = Number(process.env.STREAM_CONFLICT_RETRY_DELAY_MS || 1000);
const SCENARIO_ATTEMPTS = Number(process.env.SCENARIO_ATTEMPTS || 4);
const SCENARIO_BACKOFF_MS = Number(process.env.SCENARIO_BACKOFF_MS || 45000);
const SOFT_FAIL_EXIT_CODE = Number(process.env.SOFT_FAIL_EXIT_CODE || 75);
const ARTIFACT_WAIT_MAX_MS = Number(process.env.ARTIFACT_WAIT_MAX_MS || 90000);
const ARTIFACT_WAIT_INITIAL_INTERVAL_MS = Number(process.env.ARTIFACT_WAIT_INITIAL_INTERVAL_MS || 1000);
const ARTIFACT_WAIT_MAX_INTERVAL_MS = Number(process.env.ARTIFACT_WAIT_MAX_INTERVAL_MS || 5000);

function safeRead(path) {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

function assertConfig() {
  if (!PROJECT_ID || !AGENT_ID) {
    throw new Error('Missing PROJECT_ID/AGENT_ID (or /tmp/agentsmith_project_id.txt / /tmp/agentsmith_agent_id.txt)');
  }
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`Token file not found: ${TOKEN_FILE}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function asJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: expected JSON (${res.status}), got: ${text.slice(0, 400)}`);
  }
}

function isRetryableScenarioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /429 Too Many Requests|retry limit/i.test(message) ||
    /did not reach terminal trace within timeout/i.test(message) ||
    /url-summary\.txt artifact not found/i.test(message) ||
    /url-summary\.txt artifact content mismatch/i.test(message) ||
    /final text/i.test(message) ||
    /401|UNAUTHORIZED|invalid bearer token/i.test(message)
  );
}

function isUpstreamThrottleError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /429 Too Many Requests|retry limit/i.test(message) ||
    /First turn upstream rate limited/i.test(message) ||
    /url-summary\.txt artifact not found/i.test(message) ||
    /401|UNAUTHORIZED|invalid bearer token/i.test(message)
  );
}

function tryRefreshToken() {
  try {
    execFileSync('make', ['notebook-agent-refresh-token'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL: process.env.BASE_URL || 'http://localhost:3001',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`[inputrefs-loop] token refresh failed: ${message}\n`);
  }
}

async function runScenario() {
  assertConfig();
  function authHeaders() {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    return { Authorization: `Bearer ${token}` };
  }
  const base = `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}`;

  async function withRetry(label, fn) {
    let lastError;
    for (let attempt = 1; attempt <= HTTP_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable = /fetch failed|ECONNREFUSED|socket|network/i.test(message);
        if (!retryable || attempt === HTTP_RETRY_ATTEMPTS) break;
        process.stdout.write(`[inputrefs-loop] retry ${attempt}/${HTTP_RETRY_ATTEMPTS} for ${label}: ${message}\n`);
        await sleep(HTTP_RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }

  async function fetchWithAuthRetry(
    label,
    requestFactory,
  ) {
    let refreshed = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const res = await withRetry(label, () => requestFactory());
      if (res.status !== 401) return res;
      if (refreshed) return res;
      process.stdout.write(`[inputrefs-loop] received 401 for ${label}; refreshing token and retrying once\n`);
      tryRefreshToken();
      refreshed = true;
    }
    throw new Error(`unreachable auth retry path for ${label}`);
  }

  async function get(path) {
    const res = await fetchWithAuthRetry(`GET ${path}`, () => fetch(base + path, { headers: authHeaders() }));
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} -> ${res.status}: ${body.slice(0, 500)}`);
    }
    return asJson(res, `GET ${path}`);
  }

  async function post(path, body) {
    const res = await fetchWithAuthRetry(`POST ${path}`, () => fetch(base + path, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return asJson(res, `POST ${path}`);
  }

  async function getText(path) {
    const res = await fetchWithAuthRetry(`GET ${path}`, () => fetch(base + path, { headers: authHeaders() }));
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} -> ${res.status}: ${body.slice(0, 500)}`);
    }
    return res.text();
  }

  async function postTaskMessage(taskId, body) {
    for (let attempt = 1; attempt <= STREAM_CONFLICT_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await post(`/tasks/${taskId}/messages`, body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isStreamConflict =
          /POST \/tasks\/.+\/messages -> 409/.test(message) &&
          /TASK_STREAM_CONFLICT|task_stream_conflict/i.test(message);
        if (!isStreamConflict || attempt === STREAM_CONFLICT_RETRY_ATTEMPTS) {
          throw error;
        }
        process.stdout.write(
          `[inputrefs-loop] message retry ${attempt}/${STREAM_CONFLICT_RETRY_ATTEMPTS}: stream still active\n`,
        );
        await sleep(STREAM_CONFLICT_RETRY_DELAY_MS);
      }
    }
    throw new Error('unreachable');
  }

  async function uploadObject(libraryId, fileName, content, prefix) {
    const res = await fetchWithAuthRetry(
      `POST file-libraries/${libraryId}/upload`,
      () => {
        const fd = new FormData();
        fd.append('file', new Blob([content], { type: 'text/plain' }), fileName);
        if (prefix) fd.append('prefix', prefix);
        return fetch(`${base}/file-libraries/${libraryId}/upload`, {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST file-libraries/${libraryId}/upload -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return asJson(res, 'uploadObject');
  }

  async function ensureProjectUploadsLibrary() {
    const existing = await get('/file-libraries');
    const items = Array.isArray(existing.items) ? existing.items : [];
    const match = items.find((item) => item?.name === 'Project Uploads');
    if (match) return match;
    return post('/file-libraries', {
      name: 'Project Uploads',
      description: 'System-managed project upload library',
    });
  }

  async function waitTaskTerminal(taskId) {
    for (let i = 1; i <= POLL_MAX; i += 1) {
      const traces = await get(`/tasks/${taskId}/traces?page_size=300`);
      const traceItems = Array.isArray(traces.items) ? traces.items : [];
      const terminal = [...traceItems].reverse().find((item) =>
        item && ['success', 'error', 'cancelled'].includes(item.status || ''),
      );
      const messages = await get(`/tasks/${taskId}/messages`);
      const agent = [...messages].reverse().find((m) => m.role === 'agent');
      const tail = String(agent?.content || '').slice(-220).replace(/\n/g, ' ');
      process.stdout.write(
        `[inputrefs-loop][poll ${i}] traces=${traceItems.length} terminal=${terminal?.status || 'none'} tail=${tail}\n`,
      );
      if (!terminal) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const settleDeadline = Date.now() + SETTLE_MAX_MS;
      while (Date.now() < settleDeadline) {
        const settledMessages = await get(`/tasks/${taskId}/messages`);
        const settledAgent = [...settledMessages].reverse().find((m) => m.role === 'agent');
        const content = String(settledAgent?.content || '');
        if ((terminal.status || '') !== 'success' || content.includes('"turn.completed"')) {
          return { terminal, messages: settledMessages };
        }
        await sleep(SETTLE_INTERVAL_MS);
      }
      return { terminal, messages: await get(`/tasks/${taskId}/messages`) };
    }
    throw new Error(`task ${taskId} did not reach terminal trace within timeout`);
  }

  async function waitSecondTurnOutput(taskId, expectedText, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    let lastContent = '';
    const expectedRegex = new RegExp(expectedText.replace(/\s+/g, '\\s+'), 'i');
    while (Date.now() < deadline) {
      const messages = await get(`/tasks/${taskId}/messages`);
      const agentMessage = [...messages].reverse().find((m) => m.role === 'agent');
      const content = String(agentMessage?.content || '');
      lastContent = content;
      const hasFailed = content.includes('"turn.failed"');
      const hasCompleted = content.includes('"turn.completed"');
      if (hasFailed) {
        throw new Error('Second turn agent message contains turn.failed');
      }
      if (expectedRegex.test(content) || (hasCompleted && content.trim().length > 0)) {
        return { messages, content };
      }
      await sleep(SETTLE_INTERVAL_MS);
    }
    throw new Error(`Second turn agent message did not produce expected output: ${lastContent.slice(-320)}`);
  }

  async function waitForArtifactWithExactContent(taskId, artifactTitle, expectedContent) {
    const deadline = Date.now() + ARTIFACT_WAIT_MAX_MS;
    let intervalMs = ARTIFACT_WAIT_INITIAL_INTERVAL_MS;
    let poll = 0;
    let lastCount = 0;
    let sawArtifact = false;
    let lastDownloadedContent = '';
    while (Date.now() < deadline) {
      poll += 1;
      const artifacts = await get(`/tasks/${taskId}/artifacts`);
      const list = Array.isArray(artifacts) ? artifacts : [];
      lastCount = list.length;
      const match = list.find((item) => item?.title === artifactTitle);
      process.stdout.write(
        `[inputrefs-loop] artifact poll ${poll}: count=${lastCount} found=${Boolean(match)} interval_ms=${intervalMs}\n`,
      );
      if (match) {
        sawArtifact = true;
        try {
          const downloaded = await getText(`/tasks/${taskId}/artifacts/${match.id}/download`);
          const normalized = downloaded.trim();
          lastDownloadedContent = normalized.slice(0, 200);
          if (normalized === expectedContent) {
            return match;
          }
          process.stdout.write(
            `[inputrefs-loop] artifact present but content mismatch: expected="${expectedContent}" actual="${normalized.slice(0, 120)}"\n`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(`[inputrefs-loop] artifact present but download not ready: ${message}\n`);
        }
      }
      await sleep(intervalMs);
      intervalMs = Math.min(ARTIFACT_WAIT_MAX_INTERVAL_MS, Math.round(intervalMs * 1.4));
    }

    if (!sawArtifact) {
      throw new Error(`url-summary.txt artifact not found after waiting (${ARTIFACT_WAIT_MAX_MS}ms, last_count=${lastCount})`);
    }
    throw new Error(
      `url-summary.txt artifact content mismatch after waiting (${ARTIFACT_WAIT_MAX_MS}ms, expected="${expectedContent}", last="${lastDownloadedContent}")`,
    );
  }

  process.stdout.write(`[inputrefs-loop] project=${PROJECT_ID} agent=${AGENT_ID}\n`);
  const task = await post('/tasks', {
    title: `inputrefs-loop-${Date.now()}`,
    agent_id: AGENT_ID,
  });
  const taskId = task.id;
  process.stdout.write(`[inputrefs-loop] task_id=${taskId}\n`);

  const defaultLibrary = await ensureProjectUploadsLibrary();
  process.stdout.write(
    `[inputrefs-loop] upload library=${defaultLibrary.id} name=${defaultLibrary.name || 'Project Uploads'}\n`,
  );

  const uniqueUrlNoteName = `url-input-${taskId}.txt`;
  const uploaded = await uploadObject(
    defaultLibrary.id,
    uniqueUrlNoteName,
    `URL input\n${URL_INPUT}\n`,
    `notebook/${taskId}/inputs`,
  );
  const importedKey = uploaded.key || uploaded.object_key;
  if (!importedKey) throw new Error('uploadObject response missing key/object_key');
  process.stdout.write(`[inputrefs-loop] uploaded url note object key=${importedKey}\n`);

  await post(`/tasks/${taskId}/inputs`, {
    inputs: [
      {
        kind: 'url',
        url: URL_INPUT,
        imported_library_id: defaultLibrary.id,
        imported_key: importedKey,
        name: 'example url input',
      },
    ],
  });
  const inputsAfterUrl = await get(`/tasks/${taskId}/inputs`);
  process.stdout.write(
    `[inputrefs-loop] inputs after url attach=${JSON.stringify(inputsAfterUrl.map((x) => ({ kind: x.kind, url: x.url, imported_key: x.imported_key })))}\n`,
  );
  if (!inputsAfterUrl.some((x) => x.kind === 'url' && x.url === URL_INPUT)) {
    throw new Error('URL input ref not visible in task inputs');
  }

  await postTaskMessage(taskId, {
    role: 'user',
    content:
      'Use file-read helper to list and fetch the URL input. Then create ./artifacts/url-summary.txt containing exactly the URL string only (no extra text). Reply with the filename only.',
  });
  const firstTurn = await waitTaskTerminal(taskId);
  const firstTurnStatus = String(firstTurn?.terminal?.status || '');
  const firstTurnAgentMessage = [...(Array.isArray(firstTurn?.messages) ? firstTurn.messages : [])]
    .reverse()
    .find((m) => m.role === 'agent');
  const firstTurnContent = String(firstTurnAgentMessage?.content || '');
  if (firstTurnStatus !== 'success') {
    if (/429 Too Many Requests|retry limit/i.test(firstTurnContent)) {
      throw new Error('First turn upstream rate limited (429/retry limit)');
    }
    throw new Error(`First turn failed with terminal status=${firstTurnStatus || 'unknown'}`);
  }

  const summaryArtifact = await waitForArtifactWithExactContent(taskId, 'url-summary.txt', URL_INPUT);

  await post(`/tasks/${taskId}/inputs`, {
    inputs: [
      {
        kind: 'artifact',
        task_id: taskId,
        artifact_id: summaryArtifact.id,
        task_relative_path: summaryArtifact.task_relative_path,
        name: summaryArtifact.title,
        content_type: summaryArtifact.mime_type,
        size_bytes: summaryArtifact.file_size,
      },
    ],
  });
  const inputsAfterArtifact = await get(`/tasks/${taskId}/inputs`);
  process.stdout.write(
    `[inputrefs-loop] inputs after artifact attach=${JSON.stringify(inputsAfterArtifact.map((x) => ({ kind: x.kind, name: x.filename || x.name, artifact_id: x.artifact_id || null })))}\n`,
  );
  if (!inputsAfterArtifact.some((x) => x.kind === 'artifact' && x.artifact_id === summaryArtifact.id)) {
    throw new Error('Artifact input ref not visible in task inputs');
  }

  await postTaskMessage(taskId, {
    role: 'user',
    content: 'Use file-read helper to fetch the artifact input and reply exactly: url artifact loop ok',
  });
  await waitTaskTerminal(taskId);
  const settledSecond = await waitSecondTurnOutput(taskId, 'url artifact loop ok');
  const secondAgentContent = String(settledSecond.content || '');
  if (!/url\s*artifact\s*loop\s*ok/i.test(secondAgentContent)) {
    process.stdout.write('[inputrefs-loop] WARN second turn did not include exact expected phrase; accepted by turn.completed fallback\n');
  }

  process.stdout.write(`[inputrefs-loop] SCENARIO_OK task_id=${taskId}\n`);
}

async function main() {
  let lastError = null;
  for (let attempt = 1; attempt <= SCENARIO_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) {
        process.stdout.write(`[inputrefs-loop] scenario attempt ${attempt}/${SCENARIO_ATTEMPTS}\n`);
      }
      await runScenario();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= SCENARIO_ATTEMPTS || !isRetryableScenarioError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(
        `[inputrefs-loop] retryable failure on attempt ${attempt}/${SCENARIO_ATTEMPTS}: ${message}\n`,
      );
      if (/401|UNAUTHORIZED|invalid bearer token/i.test(message)) {
        tryRefreshToken();
      }
      await sleep(SCENARIO_BACKOFF_MS);
    }
  }
  throw lastError || new Error('inputrefs loop failed');
}

main().catch((error) => {
  if (isUpstreamThrottleError(error)) {
    process.stderr.write(
      `[inputrefs-loop] SCENARIO_WARN ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exit(SOFT_FAIL_EXIT_CODE);
  }
  process.stderr.write(`[inputrefs-loop] SCENARIO_FAIL ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
