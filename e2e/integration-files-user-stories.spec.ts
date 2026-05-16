import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIResponse, type Locator, type Page, type Request, type Response } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createProjectInWorkspace,
  createTerminalSessionViaApi,
  deleteTerminalSessionViaApi,
  expectTerminalSessionRunnerEvidenceViaApi,
  keycloakLoginToWorkspace,
  readAgentTaskViaApi,
  runTerminalCommandInSession,
  startAgentTaskRunViaApi,
  waitForAgentTaskRunFinalStateViaApi,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const WORKSPACE_ID = 'ws_default';
const DEMO_PROJECT_NAME = 'Codex Agent Regression';
const MANY_LIBRARY_COUNT = 16;
const CREATE_NEW_TASK_REQUEST_TIMEOUT_MS = 60_000;
const MULTI_SELECT_MODIFIER: 'Control' | 'Meta' = process.platform === 'darwin' ? 'Meta' : 'Control';

type FileLibraryListItem = {
  id: string;
  name: string;
  status?: string | null;
  task_home_binding_status?: 'unbound' | 'bound' | null;
  bound_task_id?: string | null;
  bound_task_title?: string | null;
  bound_task_status?: 'active' | 'archived' | null;
  bound_task_visible?: boolean | null;
};

type CreatedAgentTaskWithLibrary = {
  taskId: string;
  workspaceFileLibraryId: string;
};

type FileObjectListItem = {
  kind: 'directory' | 'file';
  path: string;
  name: string;
};

type TaskArtifactListItem = {
  id?: string;
  task_relative_path?: string;
};

type SavePointListItemProjection = {
  id: string | null;
  message: string | null;
};

type SavePointEvidence = {
  ok: boolean;
  status: number;
  body: string;
  payload: unknown;
};

type TaskHistoryEvidence = {
  activityIds: string[];
  runnerOutputs: string[];
  traceKeys: string[];
  terminalSuccessTraceKeys: string[];
  taskRunState: string | null;
  taskRunStatus: string | null;
  activeRunStatus: string | null;
};

type AgentTaskRunStartEvidence = {
  runnerOutputActivityId: string;
  runId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBlockerCodes(record: Record<string, unknown>): string[] {
  const blockers = record.blockers;
  if (!Array.isArray(blockers)) return [];
  return blockers
    .map((blocker) => asRecord(blocker))
    .map((blocker) => (blocker ? readStringField(blocker, 'code') : null))
    .filter((code): code is string => code !== null);
}

function normalizeEvidenceStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isSuccessEvidenceStatus(value: string | null | undefined): boolean {
  return ['completed', 'complete', 'succeeded', 'success'].includes(normalizeEvidenceStatus(value));
}

function isTerminalSuccessTraceRecord(record: Record<string, unknown>): boolean {
  if (!isSuccessEvidenceStatus(readStringField(record, 'status'))) return false;
  const phase = normalizeEvidenceStatus(readStringField(record, 'phase'));
  if (['end', 'complete', 'completed'].includes(phase)) return true;
  const name = normalizeEvidenceStatus(readStringField(record, 'name'));
  return [
    'run.completed',
    'run.complete',
    'run.lifecycle',
    'run.summary',
    'execution.terminal',
    'codex.exec',
  ].includes(name);
}

function resolveCreatedAgentTaskFields(payload: unknown): { taskId: string | null; workspaceFileLibraryId: string | null } {
  const candidates: Record<string, unknown>[] = [];
  const root = asRecord(payload);
  if (root) {
    candidates.push(root);
    const data = asRecord(root.data);
    if (data) {
      candidates.push(data);
      const dataTask = asRecord(data.task);
      if (dataTask) candidates.push(dataTask);
    }
    const task = asRecord(root.task);
    if (task) candidates.push(task);
  }

  return {
    taskId: candidates.map((candidate) => readStringField(candidate, 'id')).find(Boolean) ?? null,
    workspaceFileLibraryId: candidates
      .map((candidate) => readStringField(candidate, 'workspace_file_library_id'))
      .find(Boolean) ?? null,
  };
}

function parseCreatedAgentTaskWithLibrary(body: string): CreatedAgentTaskWithLibrary {
  const fields = resolveCreatedAgentTaskFields(JSON.parse(body) as unknown);
  if (!fields.taskId) {
    throw new Error('agent_task_id_not_found_after_storage_ready_create');
  }
  if (!fields.workspaceFileLibraryId) {
    throw new Error(`agent_task_workspace_file_library_id_not_found:${fields.taskId}`);
  }
  return {
    taskId: fields.taskId,
    workspaceFileLibraryId: fields.workspaceFileLibraryId,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSineSvgContent(token: string): string {
  const points = Array.from({ length: 41 }, (_, index) => {
    const x = 20 + index * 7;
    const y = 60 - Math.sin((index / 40) * Math.PI * 2) * 32;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120" role="img" aria-label="Agent generated sine artifact">',
    '  <rect width="320" height="120" fill="#ffffff"/>',
    '  <line x1="20" y1="60" x2="300" y2="60" stroke="#d1d5db" stroke-width="1"/>',
    `  <polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    `  <text x="20" y="104" font-family="monospace" font-size="10" fill="#111827">${token}</text>`,
    '</svg>',
  ].join('\n');
}

function buildPythonImageAssetSvgContent(token: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="Deterministic Agent Task asset">',
    '  <rect width="320" height="180" rx="18" fill="#f8fafc"/>',
    '  <rect x="24" y="24" width="272" height="132" rx="14" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>',
    '  <polyline points="44,122 92,74 140,104 188,54 236,92 276,40" fill="none" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
    '  <circle cx="92" cy="74" r="8" fill="#f59e0b"/>',
    '  <circle cx="188" cy="54" r="8" fill="#ef4444"/>',
    `  <text x="44" y="146" font-family="monospace" font-size="11" fill="#0f172a">${token}</text>`,
    '</svg>',
    '',
  ].join('\n');
}

function buildPythonImageAssetNoteContent(args: {
  token: string;
  assetFolderName: string;
}): string {
  return [
    '# Agent Task Image Asset Save Point',
    '',
    `Business token: ${args.token}`,
    `Asset folder: ${args.assetFolderName}`,
    'Restore check text: image asset note restored',
    'Purpose: verify Files save point restore keeps generated image assets and task history intact.',
    '',
  ].join('\n');
}

function readBackendRealEnvValue(key: string): string | null {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  try {
    const envText = readFileSync(resolve(process.cwd(), '.env.backend-real'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      if (trimmed.slice(0, separator).trim() !== key) continue;
      return trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '') || null;
    }
  } catch {
    return null;
  }
  return null;
}

function isPlaceholderModel(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return !normalized || normalized === 'placeholder-model';
}

async function authHeaders(page: Page): Promise<{ Authorization: string }> {
  const token = await readStoredAuthToken(page);
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

function truncateEvidence(value: string, maxLength = 1600): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...<truncated>` : value;
}

function parseJsonEvidence(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function parseKeyValueEvidence(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    fields[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return fields;
}

async function createFileLibraryViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  name: string;
}): Promise<FileLibraryListItem> {
  const headers = await authHeaders(args.page);
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 18; attempt += 1) {
    try {
      const response = await args.page.request.post(
        `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries`,
        {
          timeout: 60_000,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          data: {
            name: args.name,
            description: 'Created by Files user-story e2e coverage.',
          },
        },
      );
      lastStatus = response.status();
      lastBody = await response.text();
      if (response.ok()) {
        const payload = JSON.parse(lastBody) as Partial<FileLibraryListItem>;
        const id = payload.id?.trim();
        if (!id) {
          throw new Error('file_library_id_missing_after_api_create');
        }
        return {
          id,
          name: payload.name?.trim() || args.name,
          status: payload.status,
        };
      }
    } catch (error) {
      lastStatus = 0;
      lastBody = error instanceof Error ? error.message : String(error);
      const maybeCreated = (await listFileLibraries(args).catch(() => []))
        .find((library) => library.name === args.name);
      if (maybeCreated) {
        return maybeCreated;
      }
    }
    const projectStorageStillBootstrapping =
      lastStatus === 409
      && /PROJECT_STORAGE_PENDING|project_storage_pending/.test(lastBody);
    const requestTimedOut = /Timeout \d+ms exceeded/i.test(lastBody);
    if (!projectStorageStillBootstrapping && !requestTimedOut) {
      break;
    }
    await args.page.waitForTimeout(Math.min(10_000, 1_000 * (attempt + 1)));
  }
  throw new Error(`create_file_library_failed:${lastStatus}:${lastBody}`);
}

async function listFileLibraries(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
}): Promise<FileLibraryListItem[]> {
  const headers = await authHeaders(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries?page=1&page_size=100`,
    { headers },
  );
  if (!response.ok()) {
    throw new Error(`list_file_libraries_failed:${response.status()}:${await response.text()}`);
  }
  const payload = (await response.json()) as { items?: FileLibraryListItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

function splitFilePath(path: string): { prefix: string; fileName: string } {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  const fileName = parts.at(-1);
  if (!fileName) {
    throw new Error(`file_path_missing_name:${path}`);
  }
  const folderParts = parts.slice(0, -1);
  return {
    prefix: folderParts.length > 0 ? `${folderParts.join('/')}/` : '',
    fileName,
  };
}

function buildTextUploadMultipartBody(args: {
  prefix: string;
  fileName: string;
  content: string;
  overwrite: boolean;
}): { boundary: string; body: Buffer } {
  const boundary = `agentsmith-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fields = [
    ...(args.prefix ? [{ name: 'prefix', value: args.prefix }] : []),
    ...(args.overwrite ? [{ name: 'overwrite', value: 'true' }] : []),
  ];
  const fieldParts = fields.map((field) => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${field.name}"`,
    '',
    field.value,
  ].join('\r\n'));
  const filePart = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${args.fileName.replace(/"/g, '\\"')}"`,
    'Content-Type: text/plain',
    '',
    args.content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return {
    boundary,
    body: Buffer.from([...fieldParts, filePart].join('\r\n'), 'utf8'),
  };
}

async function uploadTextFileViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
  content: string;
  overwrite?: boolean;
}): Promise<void> {
  const headers = await authHeaders(args.page);
  const { prefix, fileName } = splitFilePath(args.path);
  const { boundary, body } = buildTextUploadMultipartBody({
    prefix,
    fileName,
    content: args.content,
    overwrite: args.overwrite ?? true,
  });
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/upload`,
    {
      headers: {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      data: body,
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function createFolderViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<void> {
  const headers = await authHeaders(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/folders`,
    {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      data: {
        path: args.path,
      },
    },
  );
  const body = await response.text();
  expect(response.ok() || response.status() === 409, body).toBe(true);
}

async function deleteFilePathViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<void> {
  const headers = await authHeaders(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/delete`,
    {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      data: {
        paths: [args.path],
      },
    },
  );
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
  const payload = JSON.parse(body) as { results?: Array<{ path?: string; status?: string }> };
  expect(payload.results?.some((item) => item.path === args.path && item.status === 'deleted')).toBe(true);
}

async function listFileEntriesViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  prefix?: string;
}): Promise<FileObjectListItem[]> {
  const headers = await authHeaders(args.page);
  const query = args.prefix ? `?path=${encodeURIComponent(args.prefix)}` : '';
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/entries${query}`,
    { headers },
  );
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
  const payload = JSON.parse(body) as { items?: FileObjectListItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

async function waitForFileEntryViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
  timeoutMs?: number;
}): Promise<void> {
  const { prefix, fileName } = splitFilePath(args.path);
  await expect.poll(async () => {
    const entries = await listFileEntriesViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      libraryId: args.libraryId,
      prefix,
    });
    return entries.some((item) => item.kind === 'file' && item.name === fileName && item.path === args.path);
  }, {
    timeout: args.timeoutMs ?? 120_000,
    intervals: [1_000, 2_000, 5_000],
    message: `file entry did not become visible: ${args.path}`,
  }).toBe(true);
}

async function expectFileEntryMissingViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
  timeoutMs?: number;
}): Promise<void> {
  const { prefix, fileName } = splitFilePath(args.path);
  await expect.poll(async () => {
    const entries = await listFileEntriesViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      libraryId: args.libraryId,
      prefix,
    });
    return entries.some((item) => item.kind === 'file' && item.name === fileName && item.path === args.path);
  }, {
    timeout: args.timeoutMs ?? 60_000,
    intervals: [1_000, 2_000, 5_000],
    message: `file entry unexpectedly remained visible: ${args.path}`,
  }).toBe(false);
}

async function downloadTextFileViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<string> {
  const headers = await authHeaders(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/download?path=${encodeURIComponent(args.path)}`,
    { headers },
  );
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
  return body;
}

async function waitForTextFileContentViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
  expectedContent: string;
  timeoutMs?: number;
}): Promise<void> {
  await expect.poll(async () => (
    await downloadTextFileViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      libraryId: args.libraryId,
      path: args.path,
    })
  ).trim(), {
    timeout: args.timeoutMs ?? 120_000,
    intervals: [1_000, 2_000, 5_000],
    message: `file content did not reach expected state: ${args.path}`,
  }).toBe(args.expectedContent);
}

async function waitForLibraryStatus(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  expected: RegExp;
  timeoutMs?: number;
}): Promise<string> {
  let latestStatus = '';
  await expect.poll(async () => {
    const libraries = await listFileLibraries(args);
    latestStatus = libraries.find((library) => library.id === args.libraryId)?.status ?? '';
    return latestStatus;
  }, {
    timeout: args.timeoutMs ?? 120_000,
    intervals: [1_000, 2_000, 5_000],
    message: `file library ${args.libraryId} did not reach ${args.expected}; latest=${latestStatus}`,
  }).toMatch(args.expected);
  return latestStatus;
}

async function waitForLibraryBindingStatus(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  expected: 'unbound' | 'bound';
  timeoutMs?: number;
}): Promise<FileLibraryListItem> {
  let latestLibrary: FileLibraryListItem | undefined;
  await expect.poll(async () => {
    latestLibrary = (await listFileLibraries(args))
      .find((library) => library.id === args.libraryId);
    return latestLibrary?.task_home_binding_status ?? '';
  }, {
    timeout: args.timeoutMs ?? 120_000,
    intervals: [1_000, 2_000, 5_000],
    message: `file library ${args.libraryId} did not reach binding ${args.expected}`,
  }).toBe(args.expected);
  if (!latestLibrary) {
    throw new Error(`file_library_missing_while_waiting_binding:${args.libraryId}`);
  }
  return latestLibrary;
}

async function deleteFileLibraryViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  libraryName: string;
}): Promise<void> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files`);
  const libraryItem = args.page.getByTestId(`files__library-item--${args.libraryId}`);
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await libraryItem.click();
  await args.page.getByTestId(`files__library-delete-inline--${args.libraryId}`).click();

  const deleteDialog = args.page.getByTestId('files__dialog__library-delete');
  await expect(deleteDialog).toBeVisible({ timeout: 10_000 });
  await deleteDialog.getByTestId('files__library-delete__confirm').fill(args.libraryName);

  const deleteResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'DELETE'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}`)
  ));
  await deleteDialog.getByTestId('files__library-delete__submit').click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.ok()).toBeTruthy();
}

async function deleteAgentTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<void> {
  const response = await args.page.request.delete(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}`,
    { headers: await authHeaders(args.page) },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function resolveDemoProjectAndRunner(page: Page): Promise<{
  projectId: string;
  runnerId: string;
  endpointId: string;
  model: string;
}> {
  const headers = await authHeaders(page);
  const projectsResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects?page=1&page_size=100`,
    { headers },
  );
  expect(projectsResponse.ok()).toBeTruthy();
  const projectsPayload = (await projectsResponse.json()) as {
    items?: Array<{ id: string; name: string }>;
  };
  const projectId = projectsPayload.items?.find((item) => item.name === DEMO_PROJECT_NAME)?.id?.trim();
  expect(projectId).toBeTruthy();

  const runnersResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-runners?page=1&page_size=100`,
    { headers },
  );
  expect(runnersResponse.ok()).toBeTruthy();
  const runnersPayload = (await runnersResponse.json()) as {
    items?: Array<{
      id: string;
      is_default?: boolean;
      status?: string | null;
      default_endpoint_id?: string | null;
    }>;
  };
  const runner = runnersPayload.items?.find((item) => item.is_default === true) ?? runnersPayload.items?.[0];
  expect(runner?.id).toBeTruthy();
  expect(runner?.status ?? 'ready').toMatch(/ready|connected/);

  const settingResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-task-model-setting`,
    { headers },
  );
  expect(settingResponse.ok(), await settingResponse.text()).toBeTruthy();
  const settingPayload = (await settingResponse.json()) as {
    readiness?: { state?: string | null };
    setting?: {
      endpoint_id?: string | null;
      default_model?: string | null;
      default_model_id?: string | null;
    } | null;
  };
  expect(settingPayload.readiness?.state ?? 'ready').toMatch(/^ready$/i);
  const endpointId = settingPayload.setting?.endpoint_id?.trim()
    || runner?.default_endpoint_id?.trim()
    || '';
  expect(endpointId).toBeTruthy();

  const endpointsResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/endpoints?page=1&page_size=100`,
    { headers },
  );
  expect(endpointsResponse.ok(), await endpointsResponse.text()).toBeTruthy();
  const endpointsPayload = (await endpointsResponse.json()) as {
    items?: Array<{
      id?: string;
      model?: string | null;
      status?: string | null;
      base_url?: string | null;
    }>;
  };
  const endpoint = endpointsPayload.items?.find((item) => item.id === endpointId);
  expect(endpoint?.id).toBe(endpointId);
  expect(endpoint?.status ?? 'active').toMatch(/active|ready|connected/i);
  const model = endpoint?.model?.trim()
    || settingPayload.setting?.default_model?.trim()
    || settingPayload.setting?.default_model_id?.trim()
    || '';
  const configuredModelHint = readBackendRealEnvValue('BACKEND_REAL_MODEL')
    || readBackendRealEnvValue('PRESET_ENDPOINT_MODEL')
    || readBackendRealEnvValue('BACKEND_REAL_OPENAI_MODEL');
  expect(
    configuredModelHint,
    'seeded real endpoint model must come from backend-real/local-real config',
  ).toBeTruthy();
  expect(
    isPlaceholderModel(model),
    `seeded real endpoint model must not be placeholder; env_model_hint=${configuredModelHint ?? 'unset'}`,
  ).toBe(false);
  expect(model, 'seeded endpoint model must match backend-real/local-real config')
    .toBe(configuredModelHint);
  const endpointBaseUrl = endpoint?.base_url?.trim().replace(/\/+$/, '') ?? '';
  const configuredBaseUrls = [
    readBackendRealEnvValue('PRESET_ANTHROPIC_ENDPOINT_BASE_URL'),
    readBackendRealEnvValue('PRESET_OPENAI_ENDPOINT_BASE_URL'),
    readBackendRealEnvValue('BACKEND_REAL_OPENAI_BASE_URL'),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\/+$/, ''));
  expect(endpointBaseUrl, 'seeded endpoint base URL must come from local-real/backend-real config')
    .not.toMatch(/provider\.example/i);
  if (configuredBaseUrls.length > 0) {
    expect(configuredBaseUrls).toContain(endpointBaseUrl);
  }

  return {
    projectId: projectId ?? '',
    runnerId: runner?.id ?? '',
    endpointId,
    model,
  };
}

async function createAgentTaskAfterProjectStorageReady(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  workspaceName: string;
}): Promise<CreatedAgentTaskWithLibrary> {
  const headers = await authHeaders(args.page);
  let lastStatus = 0;
  let lastBody = '';
  await expect.poll(async () => {
    let response: Awaited<ReturnType<Page['request']['post']>>;
    try {
      response = await args.page.request.post(
        `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
        {
          timeout: CREATE_NEW_TASK_REQUEST_TIMEOUT_MS,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          data: {
            title: args.title,
            workspace_mode: 'create_new',
            workspace_name: args.workspaceName,
          },
        },
      );
    } catch (error) {
      lastStatus = 0;
      lastBody = error instanceof Error ? error.message : String(error);
      if (/Timeout \d+ms exceeded/i.test(lastBody)) {
        return null;
      }
      throw error;
    }
    lastStatus = response.status();
    lastBody = await response.text();
    if (!response.ok()) {
      const projectStoragePending =
        response.status() === 409
        && /PROJECT_STORAGE_PENDING|project_storage_pending/.test(lastBody);
      if (projectStoragePending) {
        return null;
      }
      throw new Error(`create_agent_task_failed:${response.status()}:${lastBody}`);
    }

    return resolveCreatedAgentTaskFields(JSON.parse(lastBody) as unknown).taskId;
  }, {
    timeout: 180_000,
    intervals: [1_000, 2_000, 5_000],
    message: `agent task creation never became ready; last status=${lastStatus}, body=${lastBody}`,
  }).not.toBeNull();

  return parseCreatedAgentTaskWithLibrary(lastBody);
}

async function postCreateAgentTaskUsingExistingFileLibraryViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  fileLibraryId: string;
}): Promise<APIResponse> {
  return args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
    {
      timeout: CREATE_NEW_TASK_REQUEST_TIMEOUT_MS,
      headers: {
        ...(await authHeaders(args.page)),
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        workspace_mode: 'use_existing',
        workspace_file_library_id: args.fileLibraryId,
      },
    },
  );
}

async function unpublishTaskFileTemplateViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  templateId: string;
}): Promise<void> {
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/task-file-templates/${args.templateId}/unpublish`,
    { headers: await authHeaders(args.page) },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function deleteTaskFileTemplateViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  templateId: string;
}): Promise<void> {
  const response = await args.page.request.delete(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/task-file-templates/${args.templateId}`,
    { headers: await authHeaders(args.page) },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

function resolveTaskFileTemplateIdFromPublishResponse(response: APIResponse, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const root = asRecord(parsed);
    const candidates = [
      root,
      root ? asRecord(root.data) : null,
      root ? asRecord(root.template) : null,
    ].filter((candidate): candidate is Record<string, unknown> => candidate !== null);
    const id = candidates.map((candidate) => readStringField(candidate, 'id')).find(Boolean);
    if (id) return id;
  } catch {
    // Fall back to the canonical REST path below.
  }
  const match = /\/task-file-templates\/([^/]+)\/publish(?:$|[?#])/.exec(response.url());
  if (match?.[1]) return decodeURIComponent(match[1]);
  throw new Error(`task_file_template_id_not_found_after_publish:${response.url()}:${body}`);
}

async function listTaskArtifactsViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<TaskArtifactListItem[]> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts`,
    { headers: await authHeaders(args.page) },
  );
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
  const payload = JSON.parse(body) as unknown;
  if (Array.isArray(payload)) return payload as TaskArtifactListItem[];
  const root = asRecord(payload);
  const items = root && Array.isArray(root.items) ? root.items : [];
  return items as TaskArtifactListItem[];
}

async function openWorkspaceFilesRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<string> {
  const rootEntriesResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/entries`)
    && fileEntriesResponseMatchesPrefix(response, '')
    && response.ok()
  ), { timeout: 30_000 });
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files?library_id=${encodeURIComponent(args.libraryId)}`);
  await expect(args.page).toHaveURL(new RegExp(`[?&]library_id=${escapeRegex(args.libraryId)}(?:&|$)`), {
    timeout: 30_000,
  });
  await expectFilesCurrentPrefix(args.page, '', { timeoutMs: 30_000 });
  const libraryItem = args.page.getByTestId(`files__library-item--${args.libraryId}`);
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await expect(libraryItem).toHaveClass(/bg-accent\/10/, { timeout: 30_000 });
  await rootEntriesResponsePromise;
  await expect(args.page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
  return args.libraryId;
}

function getObjectRowByName(page: Page, name: string): Locator {
  return page.getByTestId('files__object-row').filter({ hasText: name }).first();
}

function normalizeFilesBrowsePrefix(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  const withoutLeading = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  return withoutLeading.endsWith('/') ? withoutLeading : `${withoutLeading}/`;
}

function currentFilesBrowsePrefix(page: Page): string {
  return normalizeFilesBrowsePrefix(new URL(page.url()).searchParams.get('prefix'));
}

function fileEntriesResponseMatchesPrefix(response: Response, expectedPrefix: string): boolean {
  const url = new URL(response.url());
  if (!url.pathname.endsWith('/entries')) return false;
  return normalizeFilesBrowsePrefix(url.searchParams.get('path')) === normalizeFilesBrowsePrefix(expectedPrefix);
}

async function expectFilesCurrentPrefix(
  page: Page,
  expectedPrefix: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const normalizedExpectedPrefix = normalizeFilesBrowsePrefix(expectedPrefix);
  await expect.poll(() => currentFilesBrowsePrefix(page), {
    timeout: options?.timeoutMs ?? 10_000,
    intervals: [100, 250, 500, 1_000],
    message: `Files did not navigate to prefix ${normalizedExpectedPrefix || '<root>'}`,
  }).toBe(normalizedExpectedPrefix);
}

async function readPrefixFromFolderRow(row: Locator, folderName: string): Promise<string> {
  const rowId = await row.getAttribute('data-row-id');
  if (!rowId?.startsWith('p:')) {
    throw new Error(`files_folder_row_missing_prefix:${folderName}:${rowId ?? '<missing>'}`);
  }
  return normalizeFilesBrowsePrefix(rowId.slice(2));
}

async function selectObjectRowByName(page: Page, name: string): Promise<Locator> {
  await closeVisibleDialog(page);
  const row = getObjectRowByName(page, name);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button').click();
  return row;
}

async function selectObjectAndDownloadViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  fileName: string;
  expectedPath: string;
  expectedContent: string;
}): Promise<void> {
  const row = args.page.getByTestId('files__object-row').filter({ hasText: args.fileName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button').click();
  const downloadResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/download`)
    && response.status() === 200
  ));
  await args.page.getByTestId('files__download').click();
  const downloadResponse = await downloadResponsePromise;
  expect(downloadResponse.url()).toContain(`path=${encodeURIComponent(args.expectedPath)}`);

  const verifiedDownload = await args.page.request.get(downloadResponse.url(), {
    headers: await authHeaders(args.page),
  });
  expect(verifiedDownload.ok()).toBeTruthy();
  expect((await verifiedDownload.text()).trim()).toBe(args.expectedContent);
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  await closeVisibleDialog(page);
  let expectedPrefix = '';
  let lastPrefix = currentFilesBrowsePrefix(page);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const folderRow = getObjectRowByName(page, name);
    await expect(folderRow).toBeVisible({ timeout: 30_000 });
    expectedPrefix = await readPrefixFromFolderRow(folderRow, name);
    if (lastPrefix === expectedPrefix) {
      await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
      return;
    }

    const targetEntriesResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.ok()
      && fileEntriesResponseMatchesPrefix(response, expectedPrefix)
    ), { timeout: 10_000 }).catch(() => null);
    const button = folderRow.getByRole('button').first();
    if (await button.isVisible().catch(() => false)) {
      await button.dblclick();
    } else {
      await folderRow.dblclick();
    }

    const opened = await expectFilesCurrentPrefix(page, expectedPrefix, { timeoutMs: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) {
      await targetEntriesResponsePromise;
      await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
      await expect(getObjectRowByName(page, name)).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
      return;
    }

    lastPrefix = currentFilesBrowsePrefix(page);
    await clearFilesSelectionIfNeeded(page);
    await page.waitForTimeout(250);
  }
  throw new Error(
    `files_folder_open_failed:${name}:expected_prefix=${expectedPrefix || '<unknown>'}:actual_prefix=${lastPrefix || '<root>'}`,
  );
}

async function closeVisibleDialog(page: Page): Promise<void> {
  const visibleDialog = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
  if (await visibleDialog.isVisible().catch(() => false)) {
    const closeButton = visibleDialog.getByRole('button', { name: /^Close$/i }).last();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(visibleDialog).toBeHidden({ timeout: 10_000 });
  }
}

async function expectAnyLocatorVisible(candidates: Locator[], message: string): Promise<void> {
  await expect.poll(async () => {
    for (const candidate of candidates) {
      if (await candidate.first().isVisible().catch(() => false)) return true;
    }
    return false;
  }, {
    timeout: 30_000,
    intervals: [500, 1_000, 2_000],
    message,
  }).toBe(true);
}

function fileObjectTestIdSegment(name: string): string {
  return name.trim().replace(/^\./, 'dot-').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

async function expectRuntimeFolderBadgeVisible(row: Locator, folderName: string): Promise<void> {
  const safeFolderName = fileObjectTestIdSegment(folderName);
  await expectAnyLocatorVisible([
    row.getByTestId(`files__runtime-folder-badge--${folderName}`),
    row.getByTestId(`files__runtime-folder-badge--${safeFolderName}`),
    row.getByTestId(`files__system-folder-badge--${folderName}`),
    row.getByTestId(`files__system-folder-badge--${safeFolderName}`),
    row.getByTestId(`files__protected-folder-badge--${folderName}`),
    row.getByTestId(`files__protected-folder-badge--${safeFolderName}`),
    row.getByTestId(`files__object-runtime-badge--${safeFolderName}`),
    row.getByTestId('files__runtime-folder-badge'),
    row.getByTestId('files__system-folder-badge'),
    row.getByTestId('files__protected-folder-badge'),
    row.getByTestId('files__object-runtime-badge'),
    row.getByTestId('files__object-system-badge'),
    row.getByText(/runtime|system|protected|managed/i),
  ], `runtime/system badge was not visible for ${folderName}`);
}

async function expectRuntimeFolderGuardVisible(dialog: Locator, folderName: string): Promise<void> {
  const safeFolderName = fileObjectTestIdSegment(folderName);
  await expectAnyLocatorVisible([
    dialog.getByTestId(`files__runtime-folder-guard--${folderName}`),
    dialog.getByTestId(`files__runtime-folder-guard--${safeFolderName}`),
    dialog.getByTestId(`files__system-folder-guard--${folderName}`),
    dialog.getByTestId(`files__system-folder-guard--${safeFolderName}`),
    dialog.getByTestId(`files__protected-folder-guard--${folderName}`),
    dialog.getByTestId(`files__protected-folder-guard--${safeFolderName}`),
    dialog.getByTestId('files__runtime-folder-guard'),
    dialog.getByTestId('files__system-folder-guard'),
    dialog.getByTestId('files__protected-folder-guard'),
    dialog.getByTestId('files__destructive-runtime-folder-guard'),
    dialog.getByText(/runtime|system|protected|managed folder|agent runtime|internal folder/i),
  ], `runtime/system guard was not visible for ${folderName}`);
}

async function cancelDialog(dialog: Locator): Promise<void> {
  const cancelButton = dialog.getByRole('button', { name: /^Cancel$/i }).last();
  await expect(cancelButton).toBeVisible({ timeout: 10_000 });
  await cancelButton.click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

async function expectVisibleSavePointListHasRestoreActions(fileStatesDialog: Locator): Promise<void> {
  const visibleRestoreActions = await fileStatesDialog
    .locator('[data-testid^="files__save-point__restore--"]')
    .count();
  expect(visibleRestoreActions).toBeGreaterThan(0);
}

async function openFilePathFromRoot(args: {
  page: Page;
  path: string;
}) {
  const { fileName } = splitFilePath(args.path);
  const folders = args.path.split('/').map((part) => part.trim()).filter(Boolean).slice(0, -1);
  for (const folder of folders) {
    await openFolderByName(args.page, folder);
  }
  const fileRow = getObjectRowByName(args.page, fileName);
  await expect(fileRow).toBeVisible({ timeout: 30_000 });
  await fileRow.getByRole('button').click();
  return fileRow;
}

async function downloadSelectedTextFileViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<string> {
  await expect(args.page.getByTestId('files__download')).toBeEnabled({ timeout: 10_000 });
  const downloadResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/download`)
    && response.url().includes('/download')
    && response.status() === 200
  ), { timeout: 30_000 });
  await args.page.getByTestId('files__download').click();
  const downloadResponse = await downloadResponsePromise;
  expect(downloadResponse.url()).toContain(`path=${encodeURIComponent(args.path)}`);
  const verifiedDownload = await args.page.request.get(downloadResponse.url(), {
    headers: await authHeaders(args.page),
  });
  expect(verifiedDownload.ok()).toBeTruthy();
  return verifiedDownload.text();
}

async function downloadSelectedBinaryFileViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<Buffer> {
  await expect(args.page.getByTestId('files__download')).toBeEnabled({ timeout: 10_000 });
  const downloadResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/download`)
    && response.url().includes('/download')
    && response.status() === 200
  ), { timeout: 30_000 });
  await args.page.getByTestId('files__download').click();
  const downloadResponse = await downloadResponsePromise;
  expect(downloadResponse.url()).toContain(`path=${encodeURIComponent(args.path)}`);
  const verifiedDownload = await args.page.request.get(downloadResponse.url(), {
    headers: await authHeaders(args.page),
  });
  expect(verifiedDownload.ok()).toBeTruthy();
  return verifiedDownload.body();
}

async function openFileFromLibraryRootAndDownloadText(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<string> {
  await openWorkspaceFilesRoot(args);
  await closeVisibleDialog(args.page);
  await openFilePathFromRoot({
    page: args.page,
    path: args.path,
  });
  return downloadSelectedTextFileViaUi(args);
}

async function openFileFromLibraryRootAndDownloadBinary(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  path: string;
}): Promise<Buffer> {
  await openWorkspaceFilesRoot(args);
  await closeVisibleDialog(args.page);
  await openFilePathFromRoot({
    page: args.page,
    path: args.path,
  });
  return downloadSelectedBinaryFileViaUi(args);
}

function expectSvgContentMatchesArtifact(args: {
  svgContent: string;
  token: string;
}): void {
  expect(args.svgContent).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(args.svgContent).toContain('<polyline');
  expect(args.svgContent).toContain(args.token);
}

async function clearFilesSelectionIfNeeded(page: Page): Promise<void> {
  const clearSelection = page.getByTestId('files__clear-selection');
  if (await clearSelection.isEnabled().catch(() => false)) {
    await clearSelection.click();
  }
}

async function selectFilesInCurrentFolderViaUi(page: Page, fileNames: string[]): Promise<void> {
  await closeVisibleDialog(page);
  await clearFilesSelectionIfNeeded(page);
  for (const [index, fileName] of fileNames.entries()) {
    const row = getObjectRowByName(page, fileName);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button').click(index === 0 ? {} : { modifiers: [MULTI_SELECT_MODIFIER] });
  }
  await expect(page.getByTestId('files__selection-summary')).toContainText(String(fileNames.length), {
    timeout: 10_000,
  });
}

async function deleteFilesInCurrentFolderViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  fileNames: string[];
}): Promise<void> {
  await selectFilesInCurrentFolderViaUi(args.page, args.fileNames);
  await expect(args.page.getByTestId('files__delete')).toBeEnabled({ timeout: 10_000 });
  await args.page.getByTestId('files__delete').click();
  const dialog = args.page.getByTestId('files__dialog__delete');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText(String(args.fileNames.length));
  const deleteResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/delete`)
  ), { timeout: 120_000 });
  await dialog.getByTestId('files__delete__submit').click();
  const deleteResponse = await deleteResponsePromise;
  const deleteBody = await deleteResponse.text();
  expect(deleteResponse.ok(), deleteBody).toBe(true);
  const batchResult = args.page.getByTestId('files__dialog__batch-result');
  await expect(batchResult).toHaveCount(0, { timeout: 10_000 });
  for (const fileName of args.fileNames) {
    await expect(getObjectRowByName(args.page, fileName)).toBeHidden({ timeout: 30_000 });
  }
}

async function openWorkspaceArtifactsFolder(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<void> {
  await openWorkspaceFilesRoot(args);
  await openFolderByName(args.page, 'workspace');
  await openFolderByName(args.page, '.artifacts');
}

function taskTraceKey(item: Record<string, unknown>): string {
  return [
    readStringField(item, 'id'),
    readStringField(item, 'message_id'),
    readStringField(item, 'run_id'),
    readStringField(item, 'category'),
    readStringField(item, 'phase'),
    readStringField(item, 'status'),
    readStringField(item, 'name'),
    readStringField(item, 'summary'),
  ].filter(Boolean).join('|');
}

async function readTaskHistoryEvidence(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runId?: string;
}): Promise<TaskHistoryEvidence> {
  const headers = await authHeaders(args.page);
  const [activityResponse, tracesResponse, taskResponse] = await Promise.all([
    args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/activity`,
      { headers },
    ),
    args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/traces?page_size=100${
        args.runId ? `&run_id=${encodeURIComponent(args.runId)}` : ''
      }`,
      { headers },
    ),
    args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}`,
      { headers },
    ),
  ]);
  expect(activityResponse.ok(), await activityResponse.text()).toBe(true);
  expect(tracesResponse.ok(), await tracesResponse.text()).toBe(true);
  expect(taskResponse.ok(), await taskResponse.text()).toBe(true);

  const activityPayload = await activityResponse.json() as unknown;
  const activityRoot = asRecord(activityPayload);
  const activityItems = Array.isArray(activityPayload)
    ? activityPayload
    : activityRoot && Array.isArray(activityRoot.items)
      ? activityRoot.items
      : [];
  const activityRecords = activityItems
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  const tracesPayload = await tracesResponse.json() as unknown;
  const tracesRoot = asRecord(tracesPayload);
  const traceItems = Array.isArray(tracesPayload)
    ? tracesPayload
    : tracesRoot && Array.isArray(tracesRoot.items)
      ? tracesRoot.items
      : [];
  const traceRecords = traceItems
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  const taskPayload = await taskResponse.json() as unknown;
  const taskRecord = asRecord(taskPayload);
  const activeRunRecord = taskRecord ? asRecord(taskRecord.active_run) : null;

  return {
    activityIds: activityRecords
      .map((item) => readStringField(item, 'id'))
      .filter((id): id is string => Boolean(id)),
    runnerOutputs: activityRecords
      .filter((item) => readStringField(item, 'kind') === 'runner_output')
      .map((item) => readStringField(item, 'content') ?? ''),
    traceKeys: traceRecords.map(taskTraceKey).filter(Boolean),
    terminalSuccessTraceKeys: traceRecords
      .filter(isTerminalSuccessTraceRecord)
      .map(taskTraceKey)
      .filter(Boolean),
    taskRunState: taskRecord ? readStringField(taskRecord, 'run_state') : null,
    taskRunStatus: taskRecord ? readStringField(taskRecord, 'run_status') : null,
    activeRunStatus: activeRunRecord ? readStringField(activeRunRecord, 'status') : null,
  };
}

function hasExplicitTaskSuccessEvidence(history: TaskHistoryEvidence): boolean {
  return history.terminalSuccessTraceKeys.length > 0
    || isSuccessEvidenceStatus(history.taskRunStatus)
    || isSuccessEvidenceStatus(history.activeRunStatus);
}

function expectTaskHistoryPreservedAfterRestore(args: {
  before: TaskHistoryEvidence;
  after: TaskHistoryEvidence;
  pythonExecutionMarker: string;
  token: string;
}): void {
  expect(args.before.activityIds.length).toBeGreaterThan(0);
  expect(args.before.traceKeys.length).toBeGreaterThan(0);
  expect(hasExplicitTaskSuccessEvidence(args.before)).toBe(true);
  expect(args.before.runnerOutputs.some((output) => output.includes(args.token))).toBe(true);
  expect(args.before.runnerOutputs.some((output) => output.includes(args.pythonExecutionMarker))).toBe(true);
  expect(args.after.runnerOutputs.some((output) => output.includes(args.token))).toBe(true);
  expect(args.after.runnerOutputs.some((output) => output.includes(args.pythonExecutionMarker))).toBe(true);
  expect(args.after.activityIds).toEqual(expect.arrayContaining(args.before.activityIds));
  expect(args.after.traceKeys).toEqual(expect.arrayContaining(args.before.traceKeys));
  expect(args.after.taskRunState).toBe('idle');
  expect(hasExplicitTaskSuccessEvidence(args.after)).toBe(true);
}

async function openTaskCreateDialog(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks`);
  await expect(page.getByTestId('agent-tasks__create-task-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('agent-tasks__create-task-btn').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
}

async function selectUseTaskFileTemplateMode(page: Page): Promise<void> {
  await page.getByRole('radio').nth(2).click();
  await expect(page.getByTestId('task-create__task-file-template')).toBeVisible({ timeout: 10_000 });
}

async function createTaskFromTemplateViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  templateName: string;
}): Promise<CreatedAgentTaskWithLibrary> {
  const { page, workspaceId, projectId, title, templateName } = args;
  await openTaskCreateDialog(page, workspaceId, projectId);
  const dialog = page.getByRole('dialog');
  await dialog.locator('#task-title').fill(title);
  await selectUseTaskFileTemplateMode(page);
  await page.getByTestId('task-create__task-file-template').click();
  await page.getByRole('option', { name: templateName }).click();

  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes(`/workspaces/${workspaceId}/projects/${projectId}/tasks`)
  ), { timeout: 60_000 });
  const submit = dialog.locator('button[type="submit"]');
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
  const createResponse = await createResponsePromise;
  const body = await createResponse.text();
  expect(createResponse.ok(), body).toBe(true);
  const createdTask = parseCreatedAgentTaskWithLibrary(body);
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks/${createdTask.taskId}(?:[/?#]|$)`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('agent-task__task-header')).toContainText(title, { timeout: 30_000 });
  await expect(page.getByTestId('agent-task__task-header-workspace-library')).toBeVisible({ timeout: 30_000 });
  return createdTask;
}

async function createTaskUsingExistingLibraryViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  libraryName: string;
}): Promise<CreatedAgentTaskWithLibrary> {
  const { page, workspaceId, projectId, title, libraryName } = args;
  await openTaskCreateDialog(page, workspaceId, projectId);
  const dialog = page.getByRole('dialog');
  await dialog.locator('#task-title').fill(title);
  await page.getByRole('radio').nth(1).click();
  await page.getByTestId('task-create__file-library').click();
  await page.getByRole('option', { name: libraryName }).click();

  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes(`/workspaces/${workspaceId}/projects/${projectId}/tasks`)
  ), { timeout: 60_000 });
  const submit = dialog.locator('button[type="submit"]');
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
  const createResponse = await createResponsePromise;
  const body = await createResponse.text();
  expect(createResponse.ok(), body).toBe(true);
  const createdTask = parseCreatedAgentTaskWithLibrary(body);
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks/${createdTask.taskId}(?:[/?#]|$)`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('agent-task__task-header')).toContainText(title, { timeout: 30_000 });
  await expect(page.getByTestId('agent-task__task-header-workspace-library')).toBeVisible({ timeout: 30_000 });
  return createdTask;
}

async function sendAgentTaskMessageViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  content: string;
}): Promise<AgentTaskRunStartEvidence> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/agent-tasks/${args.taskId}`);
  await expect(args.page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0, { timeout: 30_000 });

  const input = args.page.getByTestId('agent-tasks__conversation-input').locator('textarea').first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill(args.content);

  const runResponsePromise = args.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST'
      && url.pathname.endsWith(
        `/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/runs`,
      );
  }, { timeout: 60_000 });
  await expect(args.page.getByTestId('agent-tasks__send-btn')).toBeEnabled({ timeout: 10_000 });
  await args.page.getByTestId('agent-tasks__send-btn').click();

  const runResponse = await runResponsePromise;
  const body = await runResponse.text();
  expect(runResponse.ok(), body).toBe(true);
  const payload = asRecord(parseJsonEvidence(body));
  const runnerOutputActivityId = payload ? readStringField(payload, 'id') : null;
  expect(runnerOutputActivityId).toBeTruthy();
  if (!runnerOutputActivityId) {
    throw new Error('agent_task_ui_run_response_missing_runner_output_id');
  }
  expect(payload ? readStringField(payload, 'kind') : null).toBe('runner_output');
  expect(payload ? readStringField(payload, 'actor') : null).toBe('runner');
  const runId = payload ? readStringField(payload, 'run_id') : null;

  return {
    runnerOutputActivityId,
    ...(runId ? { runId } : {}),
  };
}

async function waitForTaskArtifact(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  expectedPath: string;
}): Promise<void> {
  const headers = await authHeaders(args.page);
  await expect.poll(async () => {
    const response = await args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts`,
      { headers },
    );
    if (!response.ok()) return false;
    const payload = await response.json() as unknown;
    const root = asRecord(payload);
    const items = Array.isArray(payload)
      ? payload
      : root && Array.isArray(root.items)
        ? root.items
        : [];
    return items
      .map((item) => asRecord(item))
      .some((item) => item?.task_relative_path === args.expectedPath);
  }, {
    timeout: 120_000,
    intervals: [1_000, 2_000, 5_000],
  }).toBe(true);
}

async function createSavePointViaFilesUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  message: string;
}): Promise<string> {
  await openWorkspaceFilesRoot(args);
  await args.page.getByTestId('files__file-states').click();
  const fileStatesDialog = args.page.getByTestId('files__dialog__file-states');
  await expect(fileStatesDialog).toBeVisible({ timeout: 10_000 });
  const savePointsTab = fileStatesDialog.getByRole('tab', { name: /^Save points$/i });
  await expect(savePointsTab).toBeVisible();
  if ((await savePointsTab.getAttribute('aria-selected')) !== 'true') {
    await savePointsTab.click();
  }

  const savePointId = await createSavePointFromOpenDialogWithPendingAssertions({
    page: args.page,
    dialog: fileStatesDialog,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    libraryId: args.libraryId,
    message: args.message,
  });
  await fileStatesDialog.getByLabel('Close', { exact: true }).click();
  await expect(fileStatesDialog).toBeHidden({ timeout: 10_000 });
  return savePointId;
}

function isSavePointCollectionRequest(args: {
  request: Request;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  method: 'GET' | 'POST';
}): boolean {
  return args.request.method() === args.method
    && args.request
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/save-points`);
}

function trackSavePointListResponses(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  const evidence: SavePointEvidence[] = [];
  const onResponse = (response: Response) => {
    if (!isSavePointCollectionRequest({
      request: response.request(),
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      libraryId: args.libraryId,
      method: 'GET',
    })) {
      return;
    }

    void response.text()
      .then((body) => {
        evidence.push({
          ok: response.ok(),
          status: response.status(),
          body: truncateEvidence(body),
          payload: parseJsonEvidence(body),
        });
      })
      .catch((error: unknown) => {
        evidence.push({
          ok: false,
          status: response.status(),
          body: error instanceof Error ? error.message : String(error),
          payload: null,
        });
      });
  };

  args.page.on('response', onResponse);
  return {
    dispose: () => args.page.off('response', onResponse),
    evidence,
    findByMessage: (message: string) => evidence
      .filter((item) => item.ok)
      .map((item) => savePointListFindByMessage(item.payload, message))
      .find((item): item is SavePointListItemProjection => Boolean(item?.id)) ?? null,
    hasSavePoint: (savePointId: string, message: string) => evidence
      .some((item) => item.ok && savePointListContains(item.payload, savePointId, message)),
  };
}

async function createSavePointFromOpenDialogWithPendingAssertions(args: {
  page: Page;
  dialog: Locator;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  message: string;
}): Promise<string> {
  const messageInput = args.dialog.getByTestId('files__save-point__message');
  const createButton = args.dialog.getByTestId('files__save-point__create');
  const listResponseTracker = trackSavePointListResponses(args);
  let createPostCount = 0;
  const onCreateRequest = (request: Request) => {
    if (isSavePointCollectionRequest({
      request,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      libraryId: args.libraryId,
      method: 'POST',
    })) {
      createPostCount += 1;
    }
  };
  args.page.on('request', onCreateRequest);

  try {
    await messageInput.fill(args.message);
    await expect(createButton).toBeEnabled({ timeout: 30_000 });
    const savePointResponsePromise = args.page.waitForResponse((response) => (
      isSavePointCollectionRequest({
        request: response.request(),
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        libraryId: args.libraryId,
        method: 'POST',
      })
    ), { timeout: 120_000 });
    await createButton.click();
    const savePointResponse = await savePointResponsePromise;
    const savePointBody = await savePointResponse.text();
    const savePointPayload = parseJsonEvidence(savePointBody);
    expect(createPostCount).toBe(1);

    if (savePointResponse.ok()) {
      const savePointRecord = asRecord(savePointPayload);
      const savePointId = savePointRecord ? readStringField(savePointRecord, 'id') : null;
      expect(savePointId).toBeTruthy();
      await expect(args.dialog.getByText(args.message)).toBeVisible({ timeout: 10_000 });
      return savePointId ?? '';
    }

    const pendingEvidence = {
      status: savePointResponse.status(),
      body: truncateEvidence(savePointBody),
      payload: savePointPayload,
    };
    if (!isFileLibraryOperationPendingEvidence(pendingEvidence)) {
      throw new Error(`create_save_point_failed:${JSON.stringify(pendingEvidence)}`);
    }

    await expect(args.dialog.getByTestId('files__save-point__pending')).toBeVisible({
      timeout: 10_000,
    });
    await expect(args.dialog.getByTestId('files__save-point__error')).toHaveCount(0);
    await expect(args.dialog.getByTestId('files__save-point__list-error')).toHaveCount(0);
    await expect(messageInput).toHaveValue(args.message);
    await expect(messageInput).toBeDisabled();
    await expect(createButton).toBeDisabled();
    await expect.poll(() => createPostCount, {
      timeout: 1_000,
      message: 'pending save-point create should not issue a duplicate POST after one click',
    }).toBe(1);

    await expect(args.dialog.getByText(args.message)).toBeVisible({ timeout: 120_000 });
    await expect(args.dialog.getByTestId('files__save-point__pending')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(messageInput).toHaveValue('');
    await expect(createButton).toBeEnabled({ timeout: 10_000 });
    let savePoint = listResponseTracker.findByMessage(args.message);
    await expect.poll(() => {
      savePoint = listResponseTracker.findByMessage(args.message);
      return savePoint?.id ?? null;
    }, {
      timeout: 10_000,
      intervals: [250, 500, 1_000],
      message: `UI save-point list response did not include pending create result: ${JSON.stringify(listResponseTracker.evidence)}`,
    }).toBeTruthy();
    if (!savePoint?.id) {
      throw new Error(`ui_save_point_list_missing_pending_create_result:${JSON.stringify(listResponseTracker.evidence)}`);
    }
    return savePoint.id;
  } finally {
    args.page.off('request', onCreateRequest);
    listResponseTracker.dispose();
  }
}

async function readSavePointsEvidence(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<SavePointEvidence> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/save-points`,
    { headers: await authHeaders(args.page) },
  );
  const body = await response.text();
  return {
    ok: response.ok(),
    status: response.status(),
    body: truncateEvidence(body),
    payload: parseJsonEvidence(body),
  };
}

function readSavePointListItems(payload: unknown): SavePointListItemProjection[] {
  const root = asRecord(payload);
  const rawItems = Array.isArray(payload)
    ? payload
    : root && Array.isArray(root.items)
      ? root.items
      : [];
  return rawItems
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      id: readStringField(item, 'id'),
      message: readStringField(item, 'message'),
    }));
}

function savePointListContains(payload: unknown, savePointId: string, message: string): boolean {
  return readSavePointListItems(payload)
    .some((item) => item.id === savePointId && item.message === message);
}

function savePointListFindByMessage(payload: unknown, message: string): SavePointListItemProjection | null {
  return readSavePointListItems(payload)
    .find((item) => item.message === message) ?? null;
}

function isFileLibraryOperationPendingEvidence(evidence: {
  status: number;
  body: string;
  payload?: unknown;
}): boolean {
  if (evidence.status !== 409) return false;
  if (/\b(?:AFSCP_[A-Z0-9_]+|REPO_[A-Z0-9_]+|E_REPO_BUSY)\b|repo_[a-z0-9_]+|jvs/i.test(evidence.body)) return false;
  const payload = evidence.payload ?? parseJsonEvidence(evidence.body);
  const record = asRecord(payload);
  if (!record) return false;
  const errorCode = readStringField(record, 'error_code') ?? readStringField(record, 'errorCode');
  const operationStatus = readStringField(record, 'operation_status') ?? readStringField(record, 'operationStatus');
  const retryAfterMs = readNumberField(record, 'retry_after_ms') ?? readNumberField(record, 'retryAfterMs');

  return errorCode === 'FILE_LIBRARY_OPERATION_PENDING'
    && operationStatus === 'pending'
    && retryAfterMs !== null
    && retryAfterMs > 0;
}

function isActiveWriterBlockedRestoreBody(body: string): boolean {
  if (/wmb_|ns_|repo_|mount|credential|control_root|jvs/i.test(body)) return false;
  const record = asRecord(parseJsonEvidence(body));
  const errorCode = record ? readStringField(record, 'error_code') : null;
  const message = record ? readStringField(record, 'message') : null;
  const blockerCodes = record ? readBlockerCodes(record) : [];
  return (
    errorCode === 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED'
    || message === 'file_library_active_writer_blocked'
  ) && blockerCodes.includes('active_writer_sessions');
}

function isRuntimeAccessReleaseConfirmedPayload(payload: Record<string, unknown> | null): boolean {
  const status = payload ? readStringField(payload, 'runtime_access_status') : null;
  return status === 'released' || payload?.released === true;
}

function isRuntimeAccessReleasePendingPayload(payload: Record<string, unknown> | null): boolean {
  const status = payload ? readStringField(payload, 'runtime_access_status') : null;
  return status === 'release_pending' && payload?.released === false;
}

async function expectSavePointListPendingUiNotFatal(fileStatesDialog: Locator): Promise<void> {
  await expect(fileStatesDialog.getByTestId('files__save-point__list-recovering')).toBeVisible({
    timeout: 10_000,
  });
  await expect(fileStatesDialog.getByTestId('files__save-point__retry')).toBeVisible();
  await expect(fileStatesDialog.getByTestId('files__save-point__message')).toBeDisabled();
  await expect(fileStatesDialog.getByTestId('files__save-point__create')).toBeDisabled();
  await expect(fileStatesDialog.getByTestId('files__save-point__list-error')).toHaveCount(0);
  await expect(fileStatesDialog.getByText(/^Could not load save points$/i)).toHaveCount(0);
}

async function expectRestoreConfirmVisibleWithoutPreparingStep(args: {
  page: Page;
  dialog: Locator;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<void> {
  const confirm = args.page.getByTestId('files__restore-confirm');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await expect(confirm.getByTestId('files__restore-confirm-submit')).toBeEnabled({ timeout: 10_000 });
  await expect(args.dialog.getByTestId('files__restore-operation')).toHaveCount(0);
}

async function waitForRestoreOperationTerminalIfVisible(fileStatesDialog: Locator): Promise<void> {
  const operation = fileStatesDialog.getByTestId('files__restore-operation');
  if (!(await operation.isVisible().catch(() => false))) return;
  const failurePattern = /Restore failed|恢复失败/i;
  const terminalPattern = /Files restored|文件已恢复|Restore state refreshed|No active restore is running now|恢复状态已刷新|当前没有正在运行的恢复操作/i;
  const startedAt = Date.now();
  let lastText = '';
  while (Date.now() - startedAt < 180_000) {
    const title = await operation.getByTestId('files__restore-operation-title').textContent().catch(() => '');
    const summary = await operation.getByTestId('files__restore-operation-summary').textContent().catch(() => '');
    lastText = `${title ?? ''}\n${summary ?? ''}`;
    if (failurePattern.test(lastText)) {
      throw new Error(`files_restore_operation_failed:${lastText}`);
    }
    if (terminalPattern.test(lastText)) {
      await expect(operation).not.toContainText(failurePattern);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`files_restore_operation_timeout:${lastText}`);
}

async function releaseRuntimeAccessUntilConfirmedViaFilesUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  dialog: Locator;
}): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastReleaseBody = '';
  let attempt = 0;

  while (Date.now() < deadline) {
    await expect(args.dialog.getByTestId('files__restore-blocker-release')).toBeVisible({ timeout: 10_000 });
    await expect(args.dialog.getByTestId('files__restore-blocker-release')).toBeEnabled({ timeout: 30_000 });
    const releaseResponsePromise = args.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST'
        && url.pathname.endsWith(`/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/runtime-access/release`);
    }, { timeout: 120_000 });
    await args.dialog.getByTestId('files__restore-blocker-release').click();
    const releaseResponse = await releaseResponsePromise;
    lastReleaseBody = await releaseResponse.text();
    expect(releaseResponse.ok(), lastReleaseBody).toBe(true);
    expect(lastReleaseBody).not.toMatch(/wmb_|ns_|repo_|mount|credential|control_root|jvs/i);
    const releasePayload = asRecord(parseJsonEvidence(lastReleaseBody));

    if (isRuntimeAccessReleaseConfirmedPayload(releasePayload)) {
      await expect(args.dialog.getByTestId('files__restore-release-error')).toHaveCount(0);
      await expect(args.dialog.getByTestId('files__restore-release-pending')).toHaveCount(0);
      await expect(args.dialog.getByTestId('files__restore-blocker-release')).toHaveCount(0, {
        timeout: 30_000,
      });
      return;
    }

    if (!isRuntimeAccessReleasePendingPayload(releasePayload)) {
      throw new Error(`files_restore_runtime_release_unexpected:${lastReleaseBody}`);
    }

    await expect(args.dialog.getByTestId('files__restore-release-error')).toHaveCount(0);
    await expect(args.dialog.getByTestId('files__restore-release-pending')).toBeVisible({ timeout: 10_000 });
    await expect(args.dialog.getByTestId('files__restore-release-pending')).toContainText(/release|释放|稍后|moment/i);
    attempt += 1;
    await args.page.waitForTimeout(Math.min(5_000, 1_000 * attempt));
  }

  throw new Error(`files_restore_runtime_release_timeout:${lastReleaseBody}`);
}

async function restoreSavePointViaFilesUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  savePointId: string;
  message: string;
}): Promise<void> {
  await openWorkspaceFilesRoot(args);
  await args.page.getByTestId('files__file-states').click();
  const fileStatesDialog = args.page.getByTestId('files__dialog__file-states');
  await expect(fileStatesDialog).toBeVisible({ timeout: 10_000 });
  await expect(fileStatesDialog.getByText(args.message)).toBeVisible({ timeout: 10_000 });

  const forbiddenRestoreRequests: string[] = [];
  const onRestoreRequest = (request: Request) => {
    const url = request.url();
    if (
      (
        request.method() === 'POST'
        && url.includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/save-points`)
      )
      ||
      url.includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/restore-`)
      || request.postData()?.includes('restore_' + 'preview_id')
    ) {
      forbiddenRestoreRequests.push(`${request.method()} ${url}`);
    }
  };
  args.page.on('request', onRestoreRequest);
  try {
    const submitRestoreOnce = async () => {
      await fileStatesDialog.getByTestId(`files__save-point__restore--${args.savePointId}`).click();
      await expectRestoreConfirmVisibleWithoutPreparingStep({
        ...args,
        dialog: fileStatesDialog,
      });
      expect(forbiddenRestoreRequests).toEqual([]);
      const restoreResponsePromise = args.page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'POST'
          && url.pathname.endsWith(`/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/restore`);
      }, { timeout: 120_000 });
      await args.page.getByTestId('files__restore-confirm-submit').click();
      const restoreResponse = await restoreResponsePromise;
      const restoreBody = await restoreResponse.text();
      return { restoreResponse, restoreBody };
    };

    let { restoreResponse, restoreBody } = await submitRestoreOnce();
    while (!restoreResponse.ok() && isActiveWriterBlockedRestoreBody(restoreBody)) {
      await expect(fileStatesDialog.getByTestId('files__restore-operation-title')).toContainText(/Restore blocked|恢复被阻止/i, {
        timeout: 10_000,
      });
      await expect(fileStatesDialog.getByTestId('files__restore-blocker-release')).toBeVisible({ timeout: 10_000 });
      await releaseRuntimeAccessUntilConfirmedViaFilesUi({
        ...args,
        dialog: fileStatesDialog,
      });
      ({ restoreResponse, restoreBody } = await submitRestoreOnce());
    }

    expect(restoreResponse.ok(), restoreBody).toBe(true);
    const restorePayload = JSON.parse(restoreBody) as { status?: string };
    expect(restorePayload.status).toMatch(/^(pending|restoring|succeeded)$/);
    await expect(fileStatesDialog.getByTestId('files__restore-operation')).toBeVisible({ timeout: 10_000 });
    await waitForRestoreOperationTerminalIfVisible(fileStatesDialog);
    expect(forbiddenRestoreRequests).toEqual([]);
  } finally {
    args.page.off('request', onRestoreRequest);
  }
}

test.describe.serial('@lane-real files user stories', () => {
  test('many file libraries keep the left list scrollable and scannable', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 640 });

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Files Many Libraries');
    const namePrefix = `Scan Library ${Date.now()}`;
    const libraries: FileLibraryListItem[] = [];
    for (let index = 0; index < MANY_LIBRARY_COUNT; index += 1) {
      libraries.push(await createFileLibraryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        name: `${namePrefix} ${String(index + 1).padStart(2, '0')}`,
      }));
    }

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/files`);
    const listScroll = page.getByTestId('files__library-list-scroll');
    await expect(listScroll).toBeVisible({ timeout: 30_000 });

    const firstLibrary = libraries[0];
    const middleLibrary = libraries[Math.floor(libraries.length / 2)];
    const lastLibrary = libraries[libraries.length - 1];

    await expect(page.getByTestId(`files__library-item--${firstLibrary.id}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`files__library-status--${firstLibrary.id}`)).toBeVisible({ timeout: 30_000 });

    await expect.poll(async () => listScroll.evaluate((element) => element.scrollHeight > element.clientHeight + 8), {
      timeout: 30_000,
      intervals: [500, 1_000],
      message: 'files library list never became vertically scrollable',
    }).toBe(true);

    await listScroll.evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight / 2);
    });
    await expect(page.getByTestId(`files__library-item--${middleLibrary.id}`)).toContainText(middleLibrary.name);
    await expect(page.getByTestId(`files__library-status--${middleLibrary.id}`)).toBeVisible();

    await listScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.getByTestId(`files__library-item--${lastLibrary.id}`)).toContainText(lastLibrary.name);
    await expect(page.getByTestId(`files__library-status--${lastLibrary.id}`)).toBeVisible();
  });

  test('deleting an empty file library reaches a terminal visible state', async ({ page }) => {
    test.setTimeout(240_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Files Delete Terminal');
    const libraryName = `Delete Terminal Library ${Date.now()}`;
    const createdLibrary = await createFileLibraryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      name: libraryName,
    });
    const libraryId = createdLibrary.id;
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      expected: /^ready$/i,
    });

    await deleteFileLibraryViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      libraryName,
    });

    await expect.poll(async () => {
      const library = (await listFileLibraries({ page, workspaceId: WORKSPACE_ID, projectId }))
        .find((item) => item.id === libraryId);
      if (!library) return 'removed';
      return library.status ?? '';
    }, {
      timeout: 180_000,
      intervals: [1_000, 2_000, 5_000],
      message: 'deleted file library remained in a non-terminal deleting state',
    }).toMatch(/^(removed|deleted|failed)$/i);

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/files`);
    const deletedItem = page.getByTestId(`files__library-item--${libraryId}`);
    if (await deletedItem.count()) {
      await expect(page.getByTestId(`files__library-status--${libraryId}`)).not.toContainText(/deleting/i);
    } else {
      await expect(page.getByText(libraryName)).toHaveCount(0);
    }
  });

  test('File states save point reloads from backend list after refresh', async ({ page }) => {
    test.setTimeout(240_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Files Save Point Reload');
    const timestamp = Date.now();
    const libraryName = `Save Point Reload Library ${timestamp}`;
    const savePointMessage = `Reload save point ${timestamp}`;
    const createdLibrary = await createFileLibraryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      name: libraryName,
    });
    const libraryId = createdLibrary.id;
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      expected: /^ready$/i,
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: `reload-save-point-${timestamp}.txt`,
      content: `save-point-source:${timestamp}`,
    });
    await waitForFileEntryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: `reload-save-point-${timestamp}.txt`,
    });

    await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
    });
    await page.getByTestId('files__file-states').click();
    const fileStatesDialog = page.getByTestId('files__dialog__file-states');
    await expect(fileStatesDialog).toBeVisible({ timeout: 10_000 });
    const savePointId = await createSavePointFromOpenDialogWithPendingAssertions({
      page,
      dialog: fileStatesDialog,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      message: savePointMessage,
    });
    await fileStatesDialog.getByLabel('Close', { exact: true }).click();
    await expect(fileStatesDialog).toBeHidden({ timeout: 10_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId(`files__library-item--${libraryId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });

    const listResponseTracker = trackSavePointListResponses({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
    });
    const savePointListResponsePromise = page.waitForResponse((response) => (
      isSavePointCollectionRequest({
        request: response.request(),
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        method: 'GET',
      })
    ), { timeout: 120_000 });
    await page.getByTestId('files__file-states').click();
    const reopenedDialog = page.getByTestId('files__dialog__file-states');
    await expect(reopenedDialog).toBeVisible({ timeout: 10_000 });
    const savePointListResponse = await savePointListResponsePromise;
    const savePointListBody = await savePointListResponse.text();
    const savePointListEvidence = {
      ok: savePointListResponse.ok(),
      status: savePointListResponse.status(),
      body: truncateEvidence(savePointListBody),
      payload: parseJsonEvidence(savePointListBody),
    };

    try {
      if (isFileLibraryOperationPendingEvidence(savePointListEvidence)) {
        await expectSavePointListPendingUiNotFatal(reopenedDialog);
        await expect(reopenedDialog.getByText(savePointMessage)).toBeVisible({ timeout: 120_000 });
        await expect(reopenedDialog.getByTestId('files__save-point__list-recovering')).toHaveCount(0, {
          timeout: 10_000,
        });
        await expect.poll(() => listResponseTracker.hasSavePoint(savePointId, savePointMessage), {
          timeout: 10_000,
          intervals: [250, 500, 1_000],
          message: `UI save-point list responses did not include ${savePointId}: ${JSON.stringify(listResponseTracker.evidence)}`,
        }).toBe(true);
      } else {
        expect(savePointListResponse.ok(), savePointListBody).toBe(true);
        expect(
          savePointListContains(savePointListEvidence.payload, savePointId, savePointMessage),
          JSON.stringify(savePointListEvidence),
        ).toBe(true);
      }

      await expect(reopenedDialog.getByTestId('files__save-point__list-error')).toHaveCount(0);
      await expect(reopenedDialog.getByText(savePointMessage)).toBeVisible({ timeout: 30_000 });
    } finally {
      listResponseTracker.dispose();
    }
  });

  test('File states direct restore round trip and task template clone independence stay in one user loop', async ({ page }) => {
    test.setTimeout(360_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await resolveDemoProjectAndRunner(page);
    const timestamp = Date.now();
    const libraryName = `State Loop Library ${timestamp}`;
    const savePointMessage = `Before direct restore ${timestamp}`;
    const templateName = `State Loop Template ${timestamp}`;
    const createdLibrary = await createFileLibraryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      name: libraryName,
    });
    const libraryId = createdLibrary.id;
    const rootRestorePath = 'root-restore-target.txt';
    const workspaceRestorePath = 'workspace/docs/restore-target.txt';
    const afterOnlyPath = 'workspace/docs/post-savepoint-only.txt';
    const templatePath = 'template-seed/guide.md';
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      expected: /^ready$/i,
    });
    await createFolderViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: 'workspace',
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: rootRestorePath,
      content: 'before restore',
    });
    await createFolderViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: 'workspace/docs',
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: workspaceRestorePath,
      content: 'before restore',
    });
    await waitForFileEntryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: rootRestorePath,
    });
    await waitForFileEntryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: workspaceRestorePath,
    });

    await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
    });
    await page.getByTestId('files__file-states').click();
    const fileStatesDialog = page.getByTestId('files__dialog__file-states');
    await expect(fileStatesDialog).toBeVisible({ timeout: 10_000 });
    const savePointsTab = fileStatesDialog.getByRole('tab', { name: /^Save points$/i });
    await expect(savePointsTab).toBeVisible();
    await expect(savePointsTab).toHaveAttribute('aria-selected', 'true');

    await fileStatesDialog.getByTestId('files__save-point__message').fill(savePointMessage);
    const savePointResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response
        .url()
        .includes(`/workspaces/${WORKSPACE_ID}/projects/${projectId}/file-libraries/${libraryId}/save-points`)
      && response.ok()
    ), { timeout: 60_000 });
    await fileStatesDialog.getByTestId('files__save-point__create').click();
    const savePointResponse = await savePointResponsePromise;
    const savePointPayload = await savePointResponse.json() as { id?: string };
    const savePointId = savePointPayload.id;
    expect(savePointId).toBeTruthy();
    await expect(fileStatesDialog.getByText(savePointMessage)).toBeVisible({ timeout: 10_000 });

    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: rootRestorePath,
      content: 'after mutation',
    });
    await waitForTextFileContentViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: rootRestorePath,
      expectedContent: 'after mutation',
      timeoutMs: 60_000,
    });
    await deleteFilePathViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: workspaceRestorePath,
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: afterOnlyPath,
      content: 'created after save point',
    });
    await waitForFileEntryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: afterOnlyPath,
    });
    await expectFileEntryMissingViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: workspaceRestorePath,
      timeoutMs: 30_000,
    });

    const restoreFileStatesDialog = page.getByTestId('files__dialog__file-states');
    if (!(await restoreFileStatesDialog.isVisible().catch(() => false))) {
      await page.getByTestId('files__file-states').click();
    }
    await expect(restoreFileStatesDialog).toBeVisible({ timeout: 10_000 });
    await expect(restoreFileStatesDialog.getByText(savePointMessage)).toBeVisible({ timeout: 10_000 });

    const savePointsBeforeRestore = await readSavePointsEvidence({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
    });
    expect(savePointsBeforeRestore.ok, JSON.stringify(savePointsBeforeRestore)).toBe(true);
    const savePointIdsBeforeRestore = readSavePointListItems(savePointsBeforeRestore.payload)
      .map((item) => item.id)
      .filter(Boolean);
    const forbiddenRestoreRequests: string[] = [];
    const onRestoreRequest = (request: Request) => {
      const url = request.url();
      if (
        (
          request.method() === 'POST'
          && url.includes(`/workspaces/${WORKSPACE_ID}/projects/${projectId}/file-libraries/${libraryId}/save-points`)
        )
        ||
        url.includes(`/workspaces/${WORKSPACE_ID}/projects/${projectId}/file-libraries/${libraryId}/restore-`)
        || request.postData()?.includes('restore_' + 'preview_id')
      ) {
        forbiddenRestoreRequests.push(`${request.method()} ${url}`);
      }
    };
    page.on('request', onRestoreRequest);
    await restoreFileStatesDialog.getByTestId(`files__save-point__restore--${savePointId}`).click();
    await expectRestoreConfirmVisibleWithoutPreparingStep({
      page,
      dialog: restoreFileStatesDialog,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
    });
    expect(forbiddenRestoreRequests).toEqual([]);
    await expectVisibleSavePointListHasRestoreActions(restoreFileStatesDialog);
    const taskTemplatesTab = restoreFileStatesDialog.getByRole('tab', { name: /^Task file templates$/i });

    const restoreResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response
        .url()
        .includes(`/workspaces/${WORKSPACE_ID}/projects/${projectId}/file-libraries/${libraryId}/restore`)
    ), { timeout: 60_000 });
    await page.getByTestId('files__restore-confirm-submit').click();
    const restoreResponse = await restoreResponsePromise;
    const restoreBody = await restoreResponse.text();
    expect(restoreResponse.ok(), restoreBody).toBe(true);
    const restorePayload = JSON.parse(restoreBody) as { status?: string };
    expect(restorePayload.status).toMatch(/^(pending|restoring|succeeded)$/);
    await expect(restoreFileStatesDialog.getByTestId('files__restore-operation')).toBeVisible({ timeout: 10_000 });
    if (restorePayload.status === 'pending' || restorePayload.status === 'restoring') {
      await expect(taskTemplatesTab).toBeDisabled();
      await expect(restoreFileStatesDialog.getByTestId('files__restore-template-blocker')).toBeVisible();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openWorkspaceFilesRoot({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
      });
      await page.getByTestId('files__file-states').click();
      const reopenedDuringRestore = page.getByTestId('files__dialog__file-states');
      await expect(reopenedDuringRestore.getByTestId('files__restore-operation')).toBeVisible({ timeout: 30_000 });
      await waitForRestoreOperationTerminalIfVisible(reopenedDuringRestore);
    } else {
      await waitForRestoreOperationTerminalIfVisible(restoreFileStatesDialog);
    }
    page.off('request', onRestoreRequest);
    expect(forbiddenRestoreRequests).toEqual([]);
    await waitForTextFileContentViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: rootRestorePath,
      expectedContent: 'before restore',
      timeoutMs: 180_000,
    });
    await waitForTextFileContentViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: workspaceRestorePath,
      expectedContent: 'before restore',
      timeoutMs: 180_000,
    });
    await expectFileEntryMissingViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: afterOnlyPath,
      timeoutMs: 180_000,
    });
    const savePointsAfterRestore = await readSavePointsEvidence({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
    });
    expect(savePointsAfterRestore.ok, JSON.stringify(savePointsAfterRestore)).toBe(true);
    const savePointIdsAfterRestore = readSavePointListItems(savePointsAfterRestore.payload)
      .map((item) => item.id)
      .filter(Boolean);
    expect(savePointIdsAfterRestore).toEqual(savePointIdsBeforeRestore);
    const restoredRootContent = await openFileFromLibraryRootAndDownloadText({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: rootRestorePath,
    });
    expect(restoredRootContent.trim()).toBe('before restore');
    const restoredWorkspaceContent = await openFileFromLibraryRootAndDownloadText({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: workspaceRestorePath,
    });
    expect(restoredWorkspaceContent.trim()).toBe('before restore');

    await page.getByTestId('files__file-states').click();
    const restoredFileStatesDialog = page.getByTestId('files__dialog__file-states');
    await expect(restoredFileStatesDialog).toBeVisible({ timeout: 10_000 });
    const unblockedTaskTemplatesTab = restoredFileStatesDialog.getByRole('tab', { name: /^Task file templates$/i });
    await expect(unblockedTaskTemplatesTab).toBeEnabled();

    await createFolderViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: 'template-seed',
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: templatePath,
      content: 'template version 1',
    });
    await waitForFileEntryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: templatePath,
    });
    await unblockedTaskTemplatesTab.click();
    await restoredFileStatesDialog.getByTestId('files__template__name').fill(templateName);
    await restoredFileStatesDialog.getByTestId('files__template__description').fill('Reusable files for a new task.');
    const publishResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/workspaces/${WORKSPACE_ID}/projects/${projectId}/task-file-templates/`)
      && response.url().endsWith('/publish')
      && response.ok()
    ), { timeout: 60_000 });
    await restoredFileStatesDialog.getByTestId('files__template__publish-current').click();
    const publishResponse = await publishResponsePromise;
    const publishBody = await publishResponse.text();
    const templateId = resolveTaskFileTemplateIdFromPublishResponse(publishResponse, publishBody);
    await expect(restoredFileStatesDialog.getByText(templateName)).toBeVisible({ timeout: 10_000 });

    await restoredFileStatesDialog.getByLabel('Close', { exact: true }).click();
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: templatePath,
      content: 'template source changed',
    });
    await waitForTextFileContentViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: templatePath,
      expectedContent: 'template source changed',
      timeoutMs: 30_000,
    });
    const createdTask = await createTaskFromTemplateViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Template clone task ${timestamp}`,
      templateName,
    });
    expect(createdTask.workspaceFileLibraryId).not.toBe(libraryId);
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: createdTask.workspaceFileLibraryId,
      expected: /^ready$/i,
      timeoutMs: 180_000,
    });
    const clonedTemplateContent = await openFileFromLibraryRootAndDownloadText({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: createdTask.workspaceFileLibraryId,
      path: templatePath,
    });
    expect(clonedTemplateContent.trim()).toBe('template version 1');

    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: createdTask.workspaceFileLibraryId,
      path: templatePath,
      content: 'template clone changed',
    });
    await expect.poll(async () => (
      await downloadTextFileViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId: createdTask.workspaceFileLibraryId,
        path: templatePath,
      })
    ).trim(), {
      timeout: 30_000,
      intervals: [1_000, 2_000],
    }).toBe('template clone changed');
    const sourceTemplateContentAfterCloneChange = await openFileFromLibraryRootAndDownloadText({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      path: templatePath,
    });
    expect(sourceTemplateContentAfterCloneChange.trim()).toBe('template source changed');

    await unpublishTaskFileTemplateViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      templateId,
    });
    await deleteTaskFileTemplateViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      templateId,
    });
    const clonedTemplateContentAfterTemplateDelete = await openFileFromLibraryRootAndDownloadText({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: createdTask.workspaceFileLibraryId,
      path: templatePath,
    });
    expect(clonedTemplateContentAfterTemplateDelete.trim()).toBe('template clone changed');
  });

  test('HOME root dot folders and workspace artifacts written by a task are visible and downloadable from Files', async ({ page }) => {
    test.setTimeout(600_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId, runnerId } = await resolveDemoProjectAndRunner(page);
    expect(runnerId).toBeTruthy();

    const token = `FILES_UI_TASK_ARTIFACT_OK_${Date.now()}`;
    const workspaceName = `Files Task Workspace ${Date.now()}`;
    const homeRootFileName = `files-ui-home-root-${Date.now()}.txt`;
    const workspaceFileName = `files-ui-workspace-${Date.now()}.txt`;
    const artifactFileName = `files-ui-artifact-${Date.now()}.txt`;
    const contentLine = `same-content:${token}`;
    const codexContent = `{"story":"home-root","token":"${token}"}`;
    const agentsContent = `agents-dot-folder:${token}`;
    const createdTask = await createAgentTaskAfterProjectStorageReady({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Files UI artifact visibility ${Date.now()}`,
      workspaceName,
    });
    const taskId = createdTask.taskId;

    const run = await startAgentTaskRunViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      intent: [
        'Run this exact shell script and do not finish until every command succeeds.',
        '```bash',
        'set -euo pipefail',
        'mkdir -p "$HOME/.codex" "$HOME/.agents" "$HOME/workspace/.artifacts"',
        `printf '%s\\n' '${codexContent}' > "$HOME/.codex/e2e.json"`,
        `printf '%s\\n' '${agentsContent}' > "$HOME/.agents/e2e.txt"`,
        `printf '%s\\n' '${contentLine}' > "$HOME/${homeRootFileName}"`,
        `printf '%s\\n' '${contentLine}' > "$HOME/workspace/${workspaceFileName}"`,
        `cp "$HOME/workspace/${workspaceFileName}" "$HOME/workspace/.artifacts/${artifactFileName}"`,
        `test "$(cat "$HOME/.codex/e2e.json")" = '${codexContent}'`,
        `test "$(cat "$HOME/.agents/e2e.txt")" = '${agentsContent}'`,
        `test "$(cat "$HOME/${homeRootFileName}")" = '${contentLine}'`,
        `test "$(cat "$HOME/workspace/${workspaceFileName}")" = '${contentLine}'`,
        `test "$(cat "$HOME/workspace/.artifacts/${artifactFileName}")" = '${contentLine}'`,
        '```',
        `After the script succeeds, reply with exactly ${token}.`,
      ].join('\n'),
    });
    await waitForRunnerOutputToken({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      token,
      runnerOutputActivityId: run.runnerOutputActivityId,
      runId: run.runId,
    });
    await waitForTaskArtifact({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      expectedPath: `.artifacts/${artifactFileName}`,
    });

    const libraryId = await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: createdTask.workspaceFileLibraryId,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: homeRootFileName }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: '.codex' }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: '.agents' }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: 'workspace' }).first()).toBeVisible({
      timeout: 30_000,
    });

    const codexRuntimeRow = getObjectRowByName(page, '.codex');
    const agentsRuntimeRow = getObjectRowByName(page, '.agents');
    await expectRuntimeFolderBadgeVisible(codexRuntimeRow, '.codex');
    await expectRuntimeFolderBadgeVisible(agentsRuntimeRow, '.agents');

    await selectObjectRowByName(page, '.codex');
    await page.getByTestId('files__delete').click();
    const runtimeDeleteDialog = page.getByTestId('files__dialog__delete');
    await expect(runtimeDeleteDialog).toBeVisible({ timeout: 10_000 });
    await expectRuntimeFolderGuardVisible(runtimeDeleteDialog, '.codex');
    await cancelDialog(runtimeDeleteDialog);
    await expect(getObjectRowByName(page, '.codex')).toBeVisible({ timeout: 10_000 });

    await selectObjectRowByName(page, '.codex');
    await page.getByTestId('files__rename').click();
    const runtimeMoveDialog = page.getByTestId('files__dialog__move');
    await expect(runtimeMoveDialog).toBeVisible({ timeout: 10_000 });
    await expect(runtimeMoveDialog.getByTestId('files__move__dest-prefix')).toBeVisible();
    await expect(runtimeMoveDialog.getByTestId('files__move__name')).toBeVisible();
    await expectRuntimeFolderGuardVisible(runtimeMoveDialog, '.codex');
    await cancelDialog(runtimeMoveDialog);
    await expect(getObjectRowByName(page, '.codex')).toBeVisible({ timeout: 10_000 });

    await openFolderByName(page, '.codex');
    await selectObjectAndDownloadViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      fileName: 'e2e.json',
      expectedPath: '.codex/e2e.json',
      expectedContent: codexContent,
    });
    await page.getByTestId('files__breadcrumb-root').click();

    await openFolderByName(page, '.agents');
    await selectObjectAndDownloadViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      fileName: 'e2e.txt',
      expectedPath: '.agents/e2e.txt',
      expectedContent: agentsContent,
    });
    await page.getByTestId('files__breadcrumb-root').click();

    await openFolderByName(page, 'workspace');
    await expect(page.getByTestId('files__object-row').filter({ hasText: workspaceFileName }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: '.artifacts' }).first()).toBeVisible({
      timeout: 30_000,
    });
    await openFolderByName(page, '.artifacts');
    await selectObjectAndDownloadViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      fileName: artifactFileName,
      expectedPath: `workspace/.artifacts/${artifactFileName}`,
      expectedContent: contentLine,
    });
  });

  test('task runtime HOME file can be save-pointed, deleted from terminal, and restored from Files', async ({ page }) => {
    test.setTimeout(600_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const timestamp = Date.now();
    const { projectId, runnerId, endpointId, model } = await resolveDemoProjectAndRunner(page);
    expect(runnerId).toBeTruthy();
    expect(endpointId).toBeTruthy();
    expect(isPlaceholderModel(model)).toBe(false);

    const artifactToken = `FILES_SAVEPOINT_RUNTIME_ARTIFACT_${timestamp}`;
    const agentDoneMarker = `AGENT_WRITE_DONE_${timestamp}`;
    const workspaceName = `Files Savepoint Runtime HOME ${timestamp}`;
    const artifactFileName = `savepoint-runtime-${timestamp}.svg`;
    const artifactLibraryPath = `workspace/.artifacts/${artifactFileName}`;
    const artifactSvg = buildSineSvgContent(artifactToken);
    const savePointMessage = `Agent generated HOME file ${timestamp}`;
    const deleteDoneMarker = `DELETE_DONE_${timestamp}`;
    const restoreDoneMarker = `RESTORE_DONE_${timestamp}`;
    const createdTask = await createAgentTaskAfterProjectStorageReady({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Files savepoint runtime task ${timestamp}`,
      workspaceName,
    });
    const taskId = createdTask.taskId;
    const libraryId = createdTask.workspaceFileLibraryId;
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      expected: /^ready$/i,
      timeoutMs: 180_000,
    });

    await test.step('real agent generates the workspace artifact with the seeded LLM endpoint', async () => {
      const run = await startAgentTaskRunViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        intent: [
          `Use the real configured model (${model}) and run this exact shell script to generate the sine SVG artifact.`,
          '```bash',
          'set -euo pipefail',
          'mkdir -p "$HOME/workspace/.artifacts"',
          `cat > "$HOME/workspace/.artifacts/${artifactFileName}" <<'SVG_EOF'`,
          artifactSvg,
          'SVG_EOF',
          `test -s "$HOME/workspace/.artifacts/${artifactFileName}"`,
          `grep -F '${artifactToken}' "$HOME/workspace/.artifacts/${artifactFileName}"`,
          `grep -F '<polyline points=' "$HOME/workspace/.artifacts/${artifactFileName}"`,
          `printf '${agentDoneMarker}\\n'`,
          '```',
          `After the script succeeds, reply with exactly ${artifactToken}.`,
        ].join('\n'),
      });
      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        token: artifactToken,
        runnerOutputActivityId: run.runnerOutputActivityId,
        runId: run.runId,
      });
      await waitForTaskArtifact({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        expectedPath: `.artifacts/${artifactFileName}`,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: artifactLibraryPath,
        timeoutMs: 120_000,
      });
      await expect.poll(async () => {
        try {
          return (await downloadTextFileViaApi({
            page,
            workspaceId: WORKSPACE_ID,
            projectId,
            libraryId,
            path: artifactLibraryPath,
          })).trim();
        } catch {
          return null;
        }
      }, {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
        message: `terminal-created artifact content did not become downloadable: ${artifactLibraryPath}`,
      }).toBe(artifactSvg);
    });

    await test.step('Files can download the registered artifact before save point', async () => {
      await openWorkspaceFilesRoot({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
      });
      await openFolderByName(page, 'workspace');
      await openFolderByName(page, '.artifacts');
      await selectObjectAndDownloadViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        fileName: artifactFileName,
        expectedPath: artifactLibraryPath,
        expectedContent: artifactSvg,
      });
    });

    const savePointId = await test.step(
      'Files UI creates a save point for the terminal-created artifact',
      async () => createSavePointViaFilesUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        message: savePointMessage,
      }),
    );

    await test.step('terminal deletion removes the artifact from Files', async () => {
      let deleteSessionId: string | null = null;
      try {
        const deleteSession = await createTerminalSessionViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          shell: '/usr/bin/bash',
        });
        deleteSessionId = deleteSession.sessionId;
        await expectTerminalSessionRunnerEvidenceViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          sessionId: deleteSessionId,
          runnerId,
          createdSession: deleteSession,
        });

        const deleteOutput = await runTerminalCommandInSession({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          sessionId: deleteSessionId,
          command: [
            'set -euo pipefail',
            `rm -f "$HOME/workspace/.artifacts/${artifactFileName}"`,
            `test ! -e "$HOME/workspace/.artifacts/${artifactFileName}"`,
            `printf '${deleteDoneMarker}\\n'`,
          ].join('; '),
          waitFor: [deleteDoneMarker],
          timeoutMs: 120_000,
        });
        expect(deleteOutput).toContain(deleteDoneMarker);
      } finally {
        if (deleteSessionId) {
          await deleteTerminalSessionViaApi({
            page,
            workspaceId: WORKSPACE_ID,
            projectId,
            taskId,
            sessionId: deleteSessionId,
          });
        }
      }

      await expectFileEntryMissingViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: artifactLibraryPath,
        timeoutMs: 120_000,
      });
      await openWorkspaceFilesRoot({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
      });
      await openFolderByName(page, 'workspace');
      const artifactsRow = getObjectRowByName(page, '.artifacts');
      if (await artifactsRow.isVisible().catch(() => false)) {
        await openFolderByName(page, '.artifacts');
        await expect(getObjectRowByName(page, artifactFileName)).toBeHidden({ timeout: 30_000 });
      } else {
        await expect(artifactsRow).toBeHidden({ timeout: 30_000 });
      }
    });

    await test.step('restore save point brings the artifact back to Files and task runtime', async () => {
      await restoreSavePointViaFilesUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        savePointId,
        message: savePointMessage,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: artifactLibraryPath,
        timeoutMs: 240_000,
      });
      await expect.poll(async () => {
        try {
          return (await downloadTextFileViaApi({
            page,
            workspaceId: WORKSPACE_ID,
            projectId,
            libraryId,
            path: artifactLibraryPath,
          })).trim();
        } catch {
          return null;
        }
      }, {
        timeout: 240_000,
        intervals: [1_000, 2_000, 5_000],
        message: `restored artifact content did not become downloadable: ${artifactLibraryPath}`,
      }).toBe(artifactSvg);
      await openWorkspaceFilesRoot({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
      });
      await openFolderByName(page, 'workspace');
      await openFolderByName(page, '.artifacts');
      await selectObjectAndDownloadViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        fileName: artifactFileName,
        expectedPath: artifactLibraryPath,
        expectedContent: artifactSvg,
      });

      let restoreVerifySessionId: string | null = null;
      try {
        const restoreVerifySession = await createTerminalSessionViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          shell: '/usr/bin/bash',
        });
        restoreVerifySessionId = restoreVerifySession.sessionId;
        await expectTerminalSessionRunnerEvidenceViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          sessionId: restoreVerifySessionId,
          runnerId,
          createdSession: restoreVerifySession,
        });
        const restoreOutput = await runTerminalCommandInSession({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          sessionId: restoreVerifySessionId,
          command: [
            'set -euo pipefail',
            `test -s "$HOME/workspace/.artifacts/${artifactFileName}"`,
            `grep -F '${artifactToken}' "$HOME/workspace/.artifacts/${artifactFileName}"`,
            `grep -F '<polyline points=' "$HOME/workspace/.artifacts/${artifactFileName}"`,
            `printf '${restoreDoneMarker}\\n'`,
          ].join('; '),
          waitFor: [artifactToken, restoreDoneMarker],
          timeoutMs: 180_000,
        });
        expect(restoreOutput).toContain(artifactToken);
        expect(restoreOutput).toContain(restoreDoneMarker);
      } finally {
        if (restoreVerifySessionId) {
          await deleteTerminalSessionViaApi({
            page,
            workspaceId: WORKSPACE_ID,
            projectId,
            taskId,
            sessionId: restoreVerifySessionId,
          });
        }
      }
    });
  });

  test('same task can continue after Files restore of agent-task generated image assets', async ({ page }) => {
    test.setTimeout(900_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const timestamp = Date.now();
    const { projectId, runnerId, endpointId, model } = await resolveDemoProjectAndRunner(page);
    expect(runnerId).toBeTruthy();
    expect(endpointId).toBeTruthy();
    expect(isPlaceholderModel(model)).toBe(false);

    const libraryName = `Image Asset Savepoint Library ${timestamp}`;
    const taskTitle = `Image asset savepoint task ${timestamp}`;
    const assetFolderName = 'workspace/.artifacts';
    const svgFileName = `agent-image-${timestamp}.svg`;
    const noteFileName = `agent-image-notes-${timestamp}.md`;
    const manifestFileName = `agent-image-manifest-${timestamp}.json`;
    const artifactToken = `AGENT_IMAGE_SAVEPOINT_RESTORE_${timestamp}`;
    const svgPath = `workspace/.artifacts/${svgFileName}`;
    const notePath = `workspace/.artifacts/${noteFileName}`;
    const manifestPath = `workspace/.artifacts/${manifestFileName}`;
    const postRestoreFileName = `post-restore-continue-${timestamp}.txt`;
    const postRestorePath = `workspace/.artifacts/${postRestoreFileName}`;
    const postRestoreTaskRelativePath = `.artifacts/${postRestoreFileName}`;
    const hiddenRuntimeMarkers = [
      {
        folder: '.codex',
        markerPath: `.codex/restore-marker-${timestamp}.txt`,
        afterOnlyPath: `.codex/post-savepoint-only-${timestamp}.txt`,
        content: `hidden-runtime-restore:.codex:${artifactToken}`,
        afterOnlyContent: `post-savepoint-only:.codex:${artifactToken}`,
      },
      {
        folder: '.cache',
        markerPath: `.cache/restore-marker-${timestamp}.txt`,
        afterOnlyPath: `.cache/post-savepoint-only-${timestamp}.txt`,
        content: `hidden-runtime-restore:.cache:${artifactToken}`,
        afterOnlyContent: `post-savepoint-only:.cache:${artifactToken}`,
      },
      {
        folder: '.local',
        markerPath: `.local/restore-marker-${timestamp}.txt`,
        afterOnlyPath: `.local/post-savepoint-only-${timestamp}.txt`,
        content: `hidden-runtime-restore:.local:${artifactToken}`,
        afterOnlyContent: `post-savepoint-only:.local:${artifactToken}`,
      },
    ];
    const hiddenRuntimeMarkersJson = JSON.stringify(hiddenRuntimeMarkers);
    const expectedSvgContent = buildPythonImageAssetSvgContent(artifactToken);
    const expectedNoteContent = buildPythonImageAssetNoteContent({
      token: artifactToken,
      assetFolderName,
    });
    const pythonExecutionMarker = `PYTHON_IMAGE_ASSET_WRITTEN:${artifactToken}:${svgFileName}:${noteFileName}`;
    const savePointMessage = `Before campaign image asset cleanup ${timestamp}`;
    const createdLibrary = await createFileLibraryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      name: libraryName,
    });
    const libraryId = createdLibrary.id;
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      expected: /^ready$/i,
      timeoutMs: 180_000,
    });

    const createdTask = await test.step('Agent Task is explicitly bound to the ready file library', async () => {
      const task = await createTaskUsingExistingLibraryViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        title: taskTitle,
        libraryName,
      });
      expect(task.workspaceFileLibraryId).toBe(libraryId);
      const boundLibrary = await waitForLibraryBindingStatus({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        expected: 'bound',
      });
      expect(boundLibrary.bound_task_id).toBe(task.taskId);
      expect(boundLibrary.bound_task_title).toBe(taskTitle);
      return task;
    });
    const taskId = createdTask.taskId;
    const postRestoreContinueMarkerPrefix = `POST_RESTORE_CONTINUE_OK:${artifactToken}:`;

    const run = await test.step('real Agent Task writes deterministic image, note, and manifest with Python', async () => {
      const pythonLinesJson = JSON.stringify(expectedSvgContent.trimEnd().split('\n'));
      const noteLinesJson = JSON.stringify(expectedNoteContent.trimEnd().split('\n'));
      const runStart = await startAgentTaskRunViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        intent: [
          `Use the real configured model (${model}) and run this exact Python stdlib script. Do not create these files with shell redirection outside Python.`,
          '```bash',
          'set -euo pipefail',
          "python3 - <<'PY'",
          'from pathlib import Path',
          'import json',
          `token = ${JSON.stringify(artifactToken)}`,
          'asset_dir = Path.home() / "workspace" / ".artifacts"',
          `hidden_runtime_markers = ${hiddenRuntimeMarkersJson}`,
          `svg_lines = ${pythonLinesJson}`,
          `note_lines = ${noteLinesJson}`,
          'asset_dir.mkdir(parents=True, exist_ok=True)',
          'svg = "\\n".join(svg_lines) + "\\n"',
          'note = "\\n".join(note_lines) + "\\n"',
          `svg_path = asset_dir / ${JSON.stringify(svgFileName)}`,
          `note_path = asset_dir / ${JSON.stringify(noteFileName)}`,
          `manifest_path = asset_dir / ${JSON.stringify(manifestFileName)}`,
          'svg_path.write_text(svg, encoding="utf-8")',
          'note_path.write_text(note, encoding="utf-8")',
          'manifest = {',
          '    "files": [svg_path.name, note_path.name],',
          '    "generator": "python-stdlib-svg",',
          '    "note_marker": "agent-image-note-ok",',
          '    "svg_marker": "agent-image-svg-ok",',
          '    "token": token,',
          '}',
          'manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\\n", encoding="utf-8")',
          'for item in hidden_runtime_markers:',
          '    marker_path = Path.home() / item["markerPath"]',
          '    marker_path.parent.mkdir(parents=True, exist_ok=True)',
          '    marker_path.write_text(item["content"], encoding="utf-8")',
          '    assert marker_path.read_text(encoding="utf-8") == item["content"]',
          `assert token in svg_path.read_text(encoding="utf-8")`,
          'assert "Restore check text: image asset note restored" in note_path.read_text(encoding="utf-8")',
          'print(f"PYTHON_IMAGE_ASSET_WRITTEN:{token}:{svg_path.name}:{note_path.name}")',
          'PY',
          '```',
          `After the Python script succeeds, reply with exactly ${pythonExecutionMarker}.`,
        ].join('\n'),
      });
      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        token: pythonExecutionMarker,
        runnerOutputActivityId: runStart.runnerOutputActivityId,
        runId: runStart.runId,
        timeoutMs: 360_000,
      });
      await waitForTaskArtifact({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        expectedPath: `.artifacts/${svgFileName}`,
      });
      await waitForAgentTaskRunFinalStateViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        runnerOutputActivityId: runStart.runnerOutputActivityId,
        runId: runStart.runId,
        timeoutMs: 300_000,
      });
      return runStart;
    });

    await test.step('Files shows and downloads the generated image assets with verifiable content', async () => {
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: svgPath,
        timeoutMs: 180_000,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: notePath,
        timeoutMs: 180_000,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: manifestPath,
        timeoutMs: 180_000,
      });

      await openWorkspaceArtifactsFolder({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
      });
      await expect(getObjectRowByName(page, svgFileName)).toBeVisible({ timeout: 30_000 });
      await expect(getObjectRowByName(page, noteFileName)).toBeVisible({ timeout: 30_000 });
      await expect(getObjectRowByName(page, manifestFileName)).toBeVisible({ timeout: 30_000 });

      await selectObjectRowByName(page, svgFileName);
      const svgDownload = await downloadSelectedBinaryFileViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: svgPath,
      });
      expectSvgContentMatchesArtifact({
        svgContent: svgDownload.toString('utf8'),
        token: artifactToken,
      });

      await selectObjectRowByName(page, noteFileName);
      const noteDownload = await downloadSelectedTextFileViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: notePath,
      });
      expect(noteDownload).toBe(expectedNoteContent);

      await selectObjectRowByName(page, manifestFileName);
      const manifestDownload = await downloadSelectedTextFileViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: manifestPath,
      });
      const manifest = JSON.parse(manifestDownload) as {
        files?: string[];
        generator?: string;
        note_marker?: string;
        svg_marker?: string;
        token?: string;
      };
      expect(manifest).toMatchObject({
        generator: 'python-stdlib-svg',
        note_marker: 'agent-image-note-ok',
        svg_marker: 'agent-image-svg-ok',
        token: artifactToken,
      });
      expect(manifest.files).toEqual(expect.arrayContaining([svgFileName, noteFileName]));
    });

    const historyBeforeRestore = await test.step('Agent Task history and trace evidence exist before Files restore', async () => {
      const history = await readTaskHistoryEvidence({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        runId: run.runId,
      });
      expect(history.runnerOutputs.some((output) => output.includes(artifactToken))).toBe(true);
      expect(history.runnerOutputs.some((output) => output.includes(pythonExecutionMarker))).toBe(true);
      expect(history.traceKeys.length).toBeGreaterThan(0);
      expect(history.terminalSuccessTraceKeys.length).toBeGreaterThan(0);
      expect(history.taskRunState).toBe('idle');
      expect(hasExplicitTaskSuccessEvidence(history)).toBe(true);
      return history;
    });

    const savePointId = await test.step('Files UI creates a business save point before cleanup', async () => createSavePointViaFilesUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      message: savePointMessage,
    }));

    await test.step('save point source state includes HOME hidden runtime markers', async () => {
      for (const marker of hiddenRuntimeMarkers) {
        await waitForTextFileContentViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          libraryId,
          path: marker.markerPath,
          expectedContent: marker.content,
          timeoutMs: 120_000,
        });
      }
    });

    await test.step('Files UI multi-select delete removes the image, note, and manifest', async () => {
      await openWorkspaceArtifactsFolder({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
      });
      await deleteFilesInCurrentFolderViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        fileNames: [svgFileName, noteFileName, manifestFileName],
      });
      await expectFileEntryMissingViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: svgPath,
        timeoutMs: 120_000,
      });
      await expectFileEntryMissingViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: notePath,
        timeoutMs: 120_000,
      });
      await expectFileEntryMissingViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: manifestPath,
        timeoutMs: 120_000,
      });
    });

    await test.step('task terminal mutates HOME hidden runtime directories after the save point', async () => {
      const mutationMarker = `HIDDEN_RUNTIME_MUTATED_${timestamp}`;
      let mutationSessionId: string | null = null;
      try {
        const mutationSession = await createTerminalSessionViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          shell: '/usr/bin/bash',
        });
        mutationSessionId = mutationSession.sessionId;
        await expectTerminalSessionRunnerEvidenceViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          sessionId: mutationSessionId,
          runnerId,
          createdSession: mutationSession,
        });
        const mutationOutput = await runTerminalCommandInSession({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskId,
          sessionId: mutationSessionId,
          command: [
            'set -euo pipefail',
            ...hiddenRuntimeMarkers.flatMap((marker) => [
              `rm -f "$HOME/${marker.markerPath}"`,
              `mkdir -p "$HOME/${marker.folder}"`,
              `printf '%s' '${marker.afterOnlyContent}' > "$HOME/${marker.afterOnlyPath}"`,
              `test ! -e "$HOME/${marker.markerPath}"`,
              `test -s "$HOME/${marker.afterOnlyPath}"`,
            ]),
            `printf '${mutationMarker}\\n'`,
          ].join('; '),
          waitFor: [mutationMarker],
          timeoutMs: 180_000,
        });
        expect(mutationOutput).toContain(mutationMarker);
      } finally {
        if (mutationSessionId) {
          await deleteTerminalSessionViaApi({
            page,
            workspaceId: WORKSPACE_ID,
            projectId,
            taskId,
            sessionId: mutationSessionId,
          });
        }
      }

      for (const marker of hiddenRuntimeMarkers) {
        await expectFileEntryMissingViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          libraryId,
          path: marker.markerPath,
          timeoutMs: 120_000,
        });
        await waitForTextFileContentViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          libraryId,
          path: marker.afterOnlyPath,
          expectedContent: marker.afterOnlyContent,
          timeoutMs: 120_000,
        });
      }
    });

    await test.step('Files UI restore confirms and brings back the image, note, and manifest', async () => {
      await restoreSavePointViaFilesUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        savePointId,
        message: savePointMessage,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: svgPath,
        timeoutMs: 240_000,
      });
      await waitForTextFileContentViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: notePath,
        expectedContent: expectedNoteContent.trim(),
        timeoutMs: 240_000,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: manifestPath,
        timeoutMs: 240_000,
      });

      const restoredSvg = await openFileFromLibraryRootAndDownloadBinary({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: svgPath,
      });
      expectSvgContentMatchesArtifact({
        svgContent: restoredSvg.toString('utf8'),
        token: artifactToken,
      });
      const restoredNote = await openFileFromLibraryRootAndDownloadText({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: notePath,
      });
      expect(restoredNote).toBe(expectedNoteContent);
      const restoredManifest = await openFileFromLibraryRootAndDownloadText({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: manifestPath,
      });
      expect(JSON.parse(restoredManifest)).toMatchObject({
        generator: 'python-stdlib-svg',
        note_marker: 'agent-image-note-ok',
        svg_marker: 'agent-image-svg-ok',
        token: artifactToken,
      });
      for (const marker of hiddenRuntimeMarkers) {
        await waitForTextFileContentViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          libraryId,
          path: marker.markerPath,
          expectedContent: marker.content,
          timeoutMs: 240_000,
        });
        await expectFileEntryMissingViaApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          libraryId,
          path: marker.afterOnlyPath,
          timeoutMs: 240_000,
        });
      }
    });

    await test.step('Files restore does not roll back or break Agent Task activity and traces', async () => {
      const historyAfterRestore = await readTaskHistoryEvidence({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        runId: run.runId,
      });
      expectTaskHistoryPreservedAfterRestore({
        before: historyBeforeRestore,
        after: historyAfterRestore,
        pythonExecutionMarker,
        token: artifactToken,
      });
      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-tasks/${taskId}`);
      await expect(page.getByTestId('agent-task__task-header')).toContainText(taskTitle, { timeout: 30_000 });
      const finalAnswer = page.getByTestId('agent-tasks__message-final-answer').filter({ hasText: pythonExecutionMarker });
      await expect(finalAnswer).toHaveCount(1, { timeout: 30_000 });
      await expect(finalAnswer).toContainText(artifactToken);
    });

    await test.step('same Agent Task sends a UI follow-up and the managed runner reads restored files before writing new evidence', async () => {
      const taskBeforeContinue = await readAgentTaskViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
      });
      expect(taskBeforeContinue.id).toBe(taskId);
      expect(taskBeforeContinue.workspace_file_library_id).toBe(libraryId);

      const runStart = await sendAgentTaskMessageViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        content: [
          `Continue this exact Agent Task after the Files restore. Use the real configured model (${model}) and run this exact Python stdlib script against the current task HOME. Do not create these files with shell redirection outside Python.`,
          '```bash',
          'set -euo pipefail',
          "python3 - <<'PY'",
          'from pathlib import Path',
          'import json',
          'import os',
          `token = ${JSON.stringify(artifactToken)}`,
          `api_task_id = ${JSON.stringify(taskId)}`,
          `api_bound_library_id = ${JSON.stringify(libraryId)}`,
          `hidden_runtime_markers = ${hiddenRuntimeMarkersJson}`,
          'runtime_task_id = os.environ.get("MBOS_AGENT_TASK_ID", "").strip()',
          'runtime_task_home = os.environ.get("TASK_HOME", "").strip()',
          'runtime_home = os.environ.get("HOME", "").strip()',
          'runtime_workspace_path = os.environ.get("WORKSPACE_PATH", "").strip()',
          'runtime_artifacts_path = os.environ.get("ARTIFACTS_PATH", "").strip()',
          'runtime_library_id = (',
          '    os.environ.get("MBOS_AGENT_WORKSPACE_FILE_LIBRARY_ID", "").strip()',
          '    or os.environ.get("MBOS_AGENT_FILE_LIBRARY_ID", "").strip()',
          '    or "<not-exposed>"',
          ')',
          'assert runtime_task_id == api_task_id, f"runtime task id mismatch: {runtime_task_id} != {api_task_id}"',
          'assert runtime_task_home, "TASK_HOME missing"',
          'assert runtime_home == runtime_task_home, f"HOME/TASK_HOME mismatch: {runtime_home} != {runtime_task_home}"',
          'assert runtime_workspace_path, "WORKSPACE_PATH missing"',
          'assert Path(runtime_workspace_path) == Path(runtime_task_home) / "workspace"',
          'assert runtime_artifacts_path, "ARTIFACTS_PATH missing"',
          'assert Path(runtime_artifacts_path) == Path(runtime_workspace_path) / ".artifacts"',
          'asset_dir = Path(runtime_artifacts_path)',
          `svg_path = asset_dir / ${JSON.stringify(svgFileName)}`,
          `note_path = asset_dir / ${JSON.stringify(noteFileName)}`,
          `manifest_path = asset_dir / ${JSON.stringify(manifestFileName)}`,
          `evidence_path = asset_dir / ${JSON.stringify(postRestoreFileName)}`,
          'svg = svg_path.read_text(encoding="utf-8")',
          'note = note_path.read_text(encoding="utf-8")',
          'manifest = json.loads(manifest_path.read_text(encoding="utf-8"))',
          'assert token in svg',
          'assert token in note',
          'assert "<polyline" in svg',
          'assert "Restore check text: image asset note restored" in note',
          'assert manifest["token"] == token',
          'assert manifest["generator"] == "python-stdlib-svg"',
          'assert manifest["svg_marker"] == "agent-image-svg-ok"',
          'assert manifest["note_marker"] == "agent-image-note-ok"',
          'assert svg_path.name in manifest["files"]',
          'assert note_path.name in manifest["files"]',
          'for item in hidden_runtime_markers:',
          '    marker_path = Path(runtime_task_home) / item["markerPath"]',
          '    after_only_path = Path(runtime_task_home) / item["afterOnlyPath"]',
          '    assert marker_path.read_text(encoding="utf-8") == item["content"]',
          '    assert not after_only_path.exists(), f"post-savepoint file survived restore: {after_only_path}"',
          'assert api_task_id',
          'assert api_bound_library_id',
          'evidence = "\\n".join([',
          '    "post_restore_continue=ok",',
          '    f"token={token}",',
          '    f"runtime_observed_task_id={runtime_task_id}",',
          '    f"runtime_observed_task_home={runtime_task_home}",',
          '    f"runtime_observed_home={runtime_home}",',
          '    f"runtime_observed_workspace_path={runtime_workspace_path}",',
          '    f"runtime_observed_artifacts_path={runtime_artifacts_path}",',
          '    f"runtime_observed_workspace_file_library_id={runtime_library_id}",',
          '    f"api_bound_task_id={api_task_id}",',
          '    f"api_bound_workspace_file_library_id={api_bound_library_id}",',
          '    f"svg_file={svg_path.name}",',
          '    f"note_file={note_path.name}",',
          '    f"manifest_file={manifest_path.name}",',
          '    f"manifest_token={manifest[\'token\']}",',
          '    f"manifest_generator={manifest[\'generator\']}",',
          '    f"manifest_svg_marker={manifest[\'svg_marker\']}",',
          '    f"manifest_note_marker={manifest[\'note_marker\']}",',
          '    "hidden_runtime_restore_status=ok",',
          '    f"hidden_runtime_restored_markers={len(hidden_runtime_markers)}",',
          '    "hidden_runtime_after_only_removed=yes",',
          '    "restored_svg_has_polyline=yes",',
          '    "restored_note_has_check_text=yes",',
          '    "",',
          '])',
          'evidence_path.write_text(evidence, encoding="utf-8")',
          'print(f"POST_RESTORE_CONTINUE_OK:{token}:{evidence_path.name}")',
          'PY',
          '```',
          `After the Python script succeeds, reply with the exact marker printed by the script, which starts with ${postRestoreContinueMarkerPrefix}.`,
        ].join('\n'),
      });

      await waitForRunnerOutputToken({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        token: postRestoreContinueMarkerPrefix,
        runnerOutputActivityId: runStart.runnerOutputActivityId,
        runId: runStart.runId,
        minRunnerOutputs: 2,
        timeoutMs: 360_000,
      });
      await waitForAgentTaskRunFinalStateViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        runnerOutputActivityId: runStart.runnerOutputActivityId,
        runId: runStart.runId,
        timeoutMs: 300_000,
      });
      await waitForTaskArtifact({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        expectedPath: postRestoreTaskRelativePath,
      });
      await waitForFileEntryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: postRestorePath,
        timeoutMs: 180_000,
      });
      const postRestoreEvidence = await openFileFromLibraryRootAndDownloadText({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        libraryId,
        path: postRestorePath,
      });
      const postRestoreFields = parseKeyValueEvidence(postRestoreEvidence);
      expect(postRestoreFields.post_restore_continue).toBe('ok');
      expect(postRestoreFields.token).toBe(artifactToken);
      expect(postRestoreFields.runtime_observed_task_id).toBe(taskId);
      expect(postRestoreFields.runtime_observed_task_home).toBeTruthy();
      expect(postRestoreFields.runtime_observed_home).toBe(postRestoreFields.runtime_observed_task_home);
      expect(postRestoreFields.runtime_observed_workspace_path).toBe(
        `${postRestoreFields.runtime_observed_task_home}/workspace`,
      );
      expect(postRestoreFields.runtime_observed_artifacts_path).toBe(
        `${postRestoreFields.runtime_observed_workspace_path}/.artifacts`,
      );
      expect(postRestoreFields.api_bound_task_id).toBe(taskId);
      expect(postRestoreFields.api_bound_workspace_file_library_id).toBe(libraryId);
      expect([libraryId, '<not-exposed>']).toContain(
        postRestoreFields.runtime_observed_workspace_file_library_id,
      );
      expect(postRestoreFields.svg_file).toBe(svgFileName);
      expect(postRestoreFields.note_file).toBe(noteFileName);
      expect(postRestoreFields.manifest_file).toBe(manifestFileName);
      expect(postRestoreFields.manifest_token).toBe(artifactToken);
      expect(postRestoreFields.manifest_generator).toBe('python-stdlib-svg');
      expect(postRestoreFields.manifest_svg_marker).toBe('agent-image-svg-ok');
      expect(postRestoreFields.manifest_note_marker).toBe('agent-image-note-ok');
      expect(postRestoreFields.hidden_runtime_restore_status).toBe('ok');
      expect(postRestoreFields.hidden_runtime_restored_markers).toBe(String(hiddenRuntimeMarkers.length));
      expect(postRestoreFields.hidden_runtime_after_only_removed).toBe('yes');
      expect(postRestoreFields.restored_svg_has_polyline).toBe('yes');
      expect(postRestoreFields.restored_note_has_check_text).toBe('yes');

      const taskAfterContinue = await readAgentTaskViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
      });
      expect(taskAfterContinue.id).toBe(taskId);
      expect(taskAfterContinue.workspace_file_library_id).toBe(libraryId);

      const historyAfterContinue = await readTaskHistoryEvidence({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        taskId,
        runId: runStart.runId,
      });
      expect(historyAfterContinue.runnerOutputs.some((output) => output.includes(postRestoreContinueMarkerPrefix))).toBe(true);
      expect(historyAfterContinue.runnerOutputs.join('\n')).not.toContain('AGENT_WORKSPACE_AFSCP_ERROR');
      expect(historyAfterContinue.taskRunState).toBe('idle');
      expect(hasExplicitTaskSuccessEvidence(historyAfterContinue)).toBe(true);

      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-tasks/${taskId}`);
      const followUpFinalAnswer = page
        .getByTestId('agent-tasks__message-final-answer')
        .filter({ hasText: postRestoreContinueMarkerPrefix });
      await expect(followUpFinalAnswer).toHaveCount(1, { timeout: 30_000 });
      await expect(followUpFinalAnswer).toContainText(postRestoreContinueMarkerPrefix);
    });
  });

  test('task file-library binding releases on task delete and can be explicitly reused', async ({ page }) => {
    test.setTimeout(420_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await resolveDemoProjectAndRunner(page);
    const timestamp = Date.now();
    const libraryName = `Binding lifecycle HOME ${timestamp}`;
    const carryOverFolder = `carry-over-${timestamp}`;
    const carryOverFileName = `notes-${timestamp}.md`;
    const carryOverPath = `${carryOverFolder}/${carryOverFileName}`;
    const carryOverContent = `carry-over:${timestamp}`;
    const artifactPath = 'workspace/.artifacts/result.txt';
    const artifactTaskRelativePath = '.artifacts/result.txt';
    const artifactContent = `artifact-file-as-home-payload:${timestamp}`;
    const taskA = await createAgentTaskAfterProjectStorageReady({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Binding lifecycle task A ${timestamp}`,
      workspaceName: libraryName,
    });
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      expected: /^ready$/i,
      timeoutMs: 180_000,
    });
    const boundLibrary = await waitForLibraryBindingStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      expected: 'bound',
    });
    expect(boundLibrary.bound_task_title).toContain('Binding lifecycle task A');

    await createFolderViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: carryOverFolder,
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: carryOverPath,
      content: carryOverContent,
    });
    await createFolderViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: 'workspace',
    });
    await createFolderViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: 'workspace/.artifacts',
    });
    await uploadTextFileViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: artifactPath,
      content: artifactContent,
    });
    await waitForFileEntryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: artifactPath,
    });

    const occupiedCreateResponse = await postCreateAgentTaskUsingExistingFileLibraryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Binding lifecycle rejected task ${timestamp}`,
      fileLibraryId: taskA.workspaceFileLibraryId,
    });
    expect(occupiedCreateResponse.status(), await occupiedCreateResponse.text()).toBe(409);
    await expect(occupiedCreateResponse.json()).resolves.toMatchObject({
      error_code: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
      message: 'workspace_file_library_in_use',
      file_library_id: taskA.workspaceFileLibraryId,
      bound_task_title: expect.stringContaining('Binding lifecycle task A'),
    });

    await deleteAgentTaskViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId: taskA.taskId,
    });
    await waitForLibraryBindingStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      expected: 'unbound',
      timeoutMs: 180_000,
    });
    await waitForTextFileContentViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: carryOverPath,
      expectedContent: carryOverContent,
      timeoutMs: 60_000,
    });
    await waitForTextFileContentViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      path: artifactPath,
      expectedContent: artifactContent,
      timeoutMs: 60_000,
    });

    const taskB = await createTaskUsingExistingLibraryViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Binding lifecycle task B ${timestamp}`,
      libraryName,
    });
    expect(taskB.workspaceFileLibraryId).toBe(taskA.workspaceFileLibraryId);
    await waitForLibraryBindingStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      expected: 'bound',
      timeoutMs: 180_000,
    });

    await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
    });
    await openFolderByName(page, carryOverFolder);
    await selectObjectAndDownloadViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      fileName: carryOverFileName,
      expectedPath: carryOverPath,
      expectedContent: carryOverContent,
    });
    await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
    });
    await openFolderByName(page, 'workspace');
    await openFolderByName(page, '.artifacts');
    await selectObjectAndDownloadViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
      fileName: 'result.txt',
      expectedPath: artifactPath,
      expectedContent: artifactContent,
    });
    const taskBArtifacts = await listTaskArtifactsViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId: taskB.taskId,
    });
    expect(taskBArtifacts.some((item) => item.task_relative_path === artifactTaskRelativePath)).toBe(false);

    await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: taskA.workspaceFileLibraryId,
    });
    await expect(page.getByTestId('files__bound-home-banner')).toContainText(/Binding lifecycle task B/, {
      timeout: 30_000,
    });
    await page.getByTestId(`files__library-delete-inline--${taskA.workspaceFileLibraryId}`).click();
    const deleteDialog = page.getByTestId('files__dialog__library-delete');
    await expect(deleteDialog).toBeVisible({ timeout: 10_000 });
    await expect(deleteDialog).toContainText('Delete the bound task before deleting this library.');
    await expect(deleteDialog).not.toContainText(/FILE_LIBRARY_TASK_IN_USE|file_library_task_in_use/);
    await deleteDialog.getByTestId('files__library-delete__confirm').fill(libraryName);
    await expect(deleteDialog.getByTestId('files__library-delete__submit')).toBeDisabled();
  });
});
