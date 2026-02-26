#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

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

async function main() {
  assertConfig();
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  const headers = { Authorization: `Bearer ${token}` };
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

  async function get(path) {
    const res = await withRetry(`GET ${path}`, () => fetch(base + path, { headers }));
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} -> ${res.status}: ${body.slice(0, 500)}`);
    }
    return asJson(res, `GET ${path}`);
  }

  async function post(path, body) {
    const res = await withRetry(`POST ${path}`, () => fetch(base + path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return asJson(res, `POST ${path}`);
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
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'text/plain' }), fileName);
    if (prefix) fd.append('prefix', prefix);
    const res = await withRetry(`POST source-libraries/${libraryId}/objects/upload`, () => fetch(`${base}/source-libraries/${libraryId}/objects/upload`, {
      method: 'POST',
      headers,
      body: fd,
    }));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST source-libraries/${libraryId}/objects/upload -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return asJson(res, 'uploadObject');
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

  process.stdout.write(`[inputrefs-loop] project=${PROJECT_ID} agent=${AGENT_ID}\n`);
  const task = await post('/tasks', {
    title: `inputrefs-loop-${Date.now()}`,
    agent_id: AGENT_ID,
  });
  const taskId = task.id;
  process.stdout.write(`[inputrefs-loop] task_id=${taskId}\n`);

  const defaultLibrary = await get('/source-libraries/default-personal');
  process.stdout.write(
    `[inputrefs-loop] default library=${defaultLibrary.id} kind=${defaultLibrary.system_managed_kind || 'n/a'}\n`,
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
      'Use notebook-inputs helper to list and fetch the URL input. Then create ./artifacts/url-summary.txt containing exactly the URL string only (no extra text). Reply with the filename only.',
  });
  await waitTaskTerminal(taskId);

  let summaryArtifact = null;
  for (let i = 1; i <= 15; i += 1) {
    const artifacts = await get(`/tasks/${taskId}/artifacts`);
    summaryArtifact = (Array.isArray(artifacts) ? artifacts : []).find((a) => a.title === 'url-summary.txt');
    process.stdout.write(
      `[inputrefs-loop] artifact poll ${i}: count=${Array.isArray(artifacts) ? artifacts.length : 0} found=${Boolean(summaryArtifact)}\n`,
    );
    if (summaryArtifact) break;
    await sleep(1000);
  }
  if (!summaryArtifact) {
    throw new Error('url-summary.txt artifact not found after waiting');
  }

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
    content: 'Use notebook-inputs helper to fetch the artifact input and reply exactly: url artifact loop ok',
  });
  const secondTurn = await waitTaskTerminal(taskId);
  const secondAgent = [...secondTurn.messages].reverse().find((m) => m.role === 'agent');
  const secondAgentContent = String(secondAgent?.content || '');
  if (!secondAgentContent.includes('url artifact loop ok')) {
    throw new Error('Second turn did not return expected final text');
  }

  process.stdout.write(`[inputrefs-loop] SCENARIO_OK task_id=${taskId}\n`);
}

main().catch((error) => {
  process.stderr.write(`[inputrefs-loop] SCENARIO_FAIL ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
