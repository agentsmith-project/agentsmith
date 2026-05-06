import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docAgentRunnerFixtures } from '../doc-fixtures/workspace-projects';
import { agentRunnerAction, agentRunnerActions, agentRunnerCollectionActions } from '../fixtures/agent-runners';
import type { AgentRunner } from '@/lib/api/types';
import { createMockRunnerTestTaskRunEvidence } from './tasks';

const agentRunners: AgentRunner[] = DOC_FIXTURES_ENABLED
  ? docAgentRunnerFixtures.map(normalizeAgentRunner)
  : ((p0.agent_runners ?? []) as AgentRunner[]).map(normalizeAgentRunner);
const API_V1_PATTERN = '*/api/v1';
const AGENT_RUNNER_SERVICE_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AGENT_TEST_CONNECTION_DEFAULT_TIMEOUT_MS = 1000;
const AGENT_TEST_CONNECTION_MIN_TIMEOUT_MS = 100;
const AGENT_TEST_CONNECTION_MAX_TIMEOUT_MS = 10000;
const AGENT_TEST_CONNECTION_ALLOWED_FIELDS = new Set(['timeout_ms']);
const AGENT_RUNNER_TEST_TASK_ALLOWED_FIELDS = new Set(['intent']);
type AgentRunnerKeyRecord = {
  id: string;
  agent_runner_id: string;
  key_prefix: string;
  status: 'active' | 'revoked' | 'expired';
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
  key?: string;
};
type AgentRunnerKeyExpiryCleanup = {
  workspace_id: string;
  project_id: string;
  agent_runner_id: string;
  key_id: string;
  key_prefix: string;
  expires_at?: string;
  cleanup_result: 'marked_expired';
  disconnected: boolean;
};
const agentRunnerKeys: AgentRunnerKeyRecord[] = [];

const createForbiddenFields = [
  'is_default',
  'default_endpoint_id',
  'status',
  'diagnostics',
  'capabilities',
  'source',
  'read_only',
  'actions',
];
const updateForbiddenFields = ['kind', ...createForbiddenFields];

function normalizeAgentRunner(runner: AgentRunner): AgentRunner {
  const kind = runner.kind ?? (runner.is_default ? 'system_managed' : 'developer');
  const readOnly = kind === 'system_managed' ? true : runner.read_only === true;
  return {
    ...runner,
    kind,
    source: runner.source ?? (kind === 'system_managed' ? 'system' : 'developer'),
    read_only: readOnly,
    is_default: kind === 'system_managed' ? runner.is_default : false,
    capabilities: runner.capabilities ?? {},
    diagnostics: runner.diagnostics ?? { presence: kind === 'system_managed' ? 'managed' : 'offline' },
    actions: runner.actions ?? agentRunnerActions(kind),
  };
}

function hasOwnField(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function hasForbiddenField(body: Record<string, unknown>, fields: string[]) {
  return fields.some((field) => hasOwnField(body, field));
}

function forbiddenFieldResponse() {
  return HttpResponse.json({ error: 'forbidden_agent_runner_field' }, { status: 400 });
}

function unsupportedFieldResponse(fields: string[]) {
  return HttpResponse.json({
    error_code: 'unsupported_field',
    message: 'unsupported_field',
    fields,
  }, { status: 400 });
}

function notFoundResponse() {
  return HttpResponse.json({ error: 'not_found' }, { status: 404 });
}

function findRunner(runnerId: string, projectId: string) {
  return agentRunners.find((runner) => runner.id === runnerId && runner.project_id === projectId);
}

function findRunnerIndex(runnerId: string, projectId: string) {
  return agentRunners.findIndex((runner) => runner.id === runnerId && runner.project_id === projectId);
}

function isDeveloperMutableRunner(runner: AgentRunner | undefined): runner is AgentRunner & { kind: 'developer' } {
  return runner?.kind === 'developer' && runner.read_only !== true;
}

function redactedKey(item: AgentRunnerKeyRecord) {
  return {
    id: item.id,
    agent_runner_id: item.agent_runner_id,
    key_prefix: item.key_prefix,
    status: item.status,
    created_at: item.created_at,
    ...(item.expires_at ? { expires_at: item.expires_at } : {}),
    ...(item.last_used_at ? { last_used_at: item.last_used_at } : {}),
  };
}

function readAgentTestTimeoutMs(raw: Record<string, unknown>): { ok: true; timeoutMs: number } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(raw, 'timeout_ms')) {
    return { ok: true, timeoutMs: AGENT_TEST_CONNECTION_DEFAULT_TIMEOUT_MS };
  }
  const value = raw.timeout_ms;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < AGENT_TEST_CONNECTION_MIN_TIMEOUT_MS
    || value > AGENT_TEST_CONNECTION_MAX_TIMEOUT_MS
  ) {
    return { ok: false };
  }
  return { ok: true, timeoutMs: value };
}

function readUnsupportedFields(raw: Record<string, unknown>, allowedFields: Set<string>): string[] {
  return Object.keys(raw).filter((field) => !allowedFields.has(field));
}

function cleanupExpiredActiveKeyForRunner(
  workspaceId: string,
  projectId: string,
  runnerId: string,
): AgentRunnerKeyExpiryCleanup | undefined {
  const expiredKey = agentRunnerKeys.find((item) => {
    if (item.agent_runner_id !== runnerId || item.status !== 'active') return false;
    const expiresAtMs = Date.parse(item.expires_at ?? '');
    return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
  });
  if (!expiredKey) return undefined;
  expiredKey.status = 'expired';
  return {
    workspace_id: workspaceId,
    project_id: projectId,
    agent_runner_id: runnerId,
    key_id: expiredKey.id,
    key_prefix: expiredKey.key_prefix,
    ...(expiredKey.expires_at ? { expires_at: expiredKey.expires_at } : {}),
    cleanup_result: 'marked_expired',
    disconnected: false,
  };
}

function generatePlainRunnerKey() {
  return `ask_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function canManageAgentRunnersForMockRequest(request: Request): boolean {
  const headerValue = request.headers.get('x-mock-agent-runner-manage')?.trim().toLowerCase();
  return headerValue !== 'denied' && headerValue !== 'false';
}

export const agentRunnerHandlers = [
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners`, ({ params, request }) => {
    const projectId = String(params.prj ?? '');
    const projectRunners = agentRunners.filter((runner) => runner.project_id === projectId);
    return HttpResponse.json({
      items: projectRunners,
      total: projectRunners.length,
      page: 1,
      page_size: projectRunners.length,
      has_more: false,
      actions: agentRunnerCollectionActions(canManageAgentRunnersForMockRequest(request)),
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id`, ({ params }) => {
    const agentRunner = findRunner(String(params.id ?? ''), String(params.prj ?? ''));
    if (!agentRunner) return notFoundResponse();
    return HttpResponse.json(agentRunner);
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.kind === 'system_managed' || hasForbiddenField(body, createForbiddenFields)) {
      return forbiddenFieldResponse();
    }
    if (body.kind != null && body.kind !== 'developer') {
      return forbiddenFieldResponse();
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return HttpResponse.json({ error: 'name_required' }, { status: 400 });
    const now = new Date().toISOString();
    const created: AgentRunner = {
      id: `agent_${Date.now()}`,
      project_id: String(params.prj ?? 'proj_001'),
      name,
      description: typeof body.description === 'string' ? body.description : '',
      kind: 'developer',
      source: 'developer',
      read_only: false,
      is_default: false,
      status: 'draft',
      capabilities: {},
      diagnostics: { presence: 'offline' },
      actions: agentRunnerActions('developer', {
        test_connection: agentRunnerAction('test_connection', true, true),
        run_test_task: agentRunnerAction('run_test_task', true, false, 'agent_runner_disconnected'),
      }),
      created_at: now,
      updated_at: now,
    };
    agentRunners.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idx = findRunnerIndex(String(params.id ?? ''), String(params.prj ?? ''));
    if (idx < 0) return notFoundResponse();
    const current = agentRunners[idx];
    if (!current) return notFoundResponse();
    if (!isDeveloperMutableRunner(current)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    if (hasForbiddenField(body, updateForbiddenFields)) return forbiddenFieldResponse();
    agentRunners[idx] = {
      ...current,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(agentRunners[idx]);
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id`, ({ params }) => {
    const idx = findRunnerIndex(String(params.id ?? ''), String(params.prj ?? ''));
    if (idx < 0) return notFoundResponse();
    const current = agentRunners[idx];
    if (!current) return notFoundResponse();
    if (!isDeveloperMutableRunner(current)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    agentRunners.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/diagnostics`, ({ params }) => {
    const runner = findRunner(String(params.id ?? ''), String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    return HttpResponse.json({ ...p0.agent_runner_diagnostics, ...runner.diagnostics });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/connection-info`, ({ params }) => {
    const runner = findRunner(String(params.id ?? ''), String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    if (!isDeveloperMutableRunner(runner)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    return HttpResponse.json({
      ws_url: `ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=${encodeURIComponent(String(params.id ?? ''))}`,
      agent_runner_id: String(params.id ?? ''),
      protocol_version: '1.0',
      heartbeat_interval_sec: 15,
    });
  }),
  http.get(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/keys`, ({ params }) => {
    const runnerId = String(params.id ?? '');
    const runner = findRunner(runnerId, String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    if (!isDeveloperMutableRunner(runner)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    const keys = agentRunnerKeys
      .filter((item) => item.agent_runner_id === runnerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(redactedKey);
    return HttpResponse.json({
      items: keys,
      total: keys.length,
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/keys`, ({ params }) => {
    const runnerId = String(params.id ?? '');
    const runner = findRunner(runnerId, String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    if (!isDeveloperMutableRunner(runner)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    agentRunnerKeys
      .filter((item) => item.agent_runner_id === runnerId && item.status === 'active')
      .forEach((item) => {
        item.status = 'revoked';
      });
    const fullKey = generatePlainRunnerKey();
    const keyPrefix = fullKey.slice(0, 12);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AGENT_RUNNER_SERVICE_KEY_TTL_MS);
    const created: AgentRunnerKeyRecord = {
      id: `agk_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      agent_runner_id: runnerId,
      key_prefix: keyPrefix,
      status: 'active',
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      key: fullKey,
    };
    agentRunnerKeys.push(created);
    return HttpResponse.json({
      id: created.id,
      agent_runner_id: created.agent_runner_id,
      key_prefix: created.key_prefix,
      key: fullKey,
      status: 'active',
      created_at: created.created_at,
      expires_at: created.expires_at,
    }, { status: 201 });
  }),
  http.delete(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/keys/:keyId`, ({ params }) => {
    const runnerId = String(params.id ?? '');
    const runner = findRunner(runnerId, String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    if (!isDeveloperMutableRunner(runner)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    const keyId = String(params.keyId ?? '');
    const item = agentRunnerKeys.find((key) => key.id === keyId && key.agent_runner_id === runnerId);
    if (!item) return notFoundResponse();
    item.status = 'revoked';
    return HttpResponse.json(null, { status: 204 });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/test-connection`, async ({ params, request }) => {
    const runnerId = String(params.id ?? '');
    const runner = findRunner(runnerId, String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    if (!isDeveloperMutableRunner(runner)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    if (!canManageAgentRunnersForMockRequest(request)) {
      return HttpResponse.json({ error: 'agent_runner_test_connection_unavailable' }, { status: 403 });
    }
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const unsupportedFields = readUnsupportedFields(raw, AGENT_TEST_CONNECTION_ALLOWED_FIELDS);
    if (unsupportedFields.length > 0) {
      return unsupportedFieldResponse(unsupportedFields);
    }
    const timeout = readAgentTestTimeoutMs(raw);
    if (!timeout.ok) {
      return HttpResponse.json({
        error_code: 'VALIDATION_ERROR',
        message: 'agent_test_timeout_invalid',
        field: 'timeout_ms',
      }, { status: 422 });
    }
    const cleanup = cleanupExpiredActiveKeyForRunner(
      String(params.ws ?? ''),
      String(params.prj ?? ''),
      runnerId,
    );
    const connected = !cleanup && (runner.status === 'ready' || runner.status === 'connected' || runner.status === 'degraded');
    const stale = cleanup !== undefined;
    return HttpResponse.json({
      agent_runner_id: runnerId,
      status: stale ? 'stale' : connected ? 'connected' : 'disconnected',
      checked_at: new Date().toISOString(),
      timeout_ms: timeout.timeoutMs,
      capabilities: runner.capabilities,
      freshness: {
        state: stale ? 'stale' : connected ? 'fresh' : 'missing',
        active_connection_count: connected ? 1 : 0,
        ...(connected ? { last_seen_at: new Date().toISOString() } : {}),
      },
      errors: connected
        ? []
        : [{
          code: stale ? 'agent_runner_stale' : 'agent_runner_disconnected',
          message: stale ? 'agent_runner_stale' : 'agent_runner_disconnected',
        }],
      ...(cleanup ? { cleanup: { key_expiry: cleanup } } : {}),
    });
  }),
  http.post(`${API_V1_PATTERN}/workspaces/:ws/projects/:prj/agent-runners/:id/test-task-runs`, async ({ request, params }) => {
    const runnerId = String(params.id ?? '');
    const runner = findRunner(runnerId, String(params.prj ?? ''));
    if (!runner) return notFoundResponse();
    if (!isDeveloperMutableRunner(runner)) return HttpResponse.json({ error: 'system_managed_read_only' }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { intent?: unknown } & Record<string, unknown>;
    const unsupportedFields = readUnsupportedFields(body, AGENT_RUNNER_TEST_TASK_ALLOWED_FIELDS);
    if (unsupportedFields.length > 0) {
      return unsupportedFieldResponse(unsupportedFields);
    }
    if (runner.actions.run_test_task.allowed !== true) {
      return HttpResponse.json({
        status: 'not_started',
        runner_test: true,
        resolved_runner_id: runnerId,
        error_code: 'agent_runner_test_task_unavailable',
        message: 'agent_runner_test_task_unavailable',
      }, { status: 409 });
    }
    const intent = typeof body.intent === 'string' ? body.intent : undefined;
    const suffix = `${runnerId}_${Date.now()}`;
    const taskId = `task_runner_test_${suffix}`;
    const runId = `run_runner_test_${suffix}`;
    createMockRunnerTestTaskRunEvidence({
      workspaceId: String(params.ws ?? ''),
      projectId: String(params.prj ?? ''),
      runnerId,
      taskId,
      runId,
      intent,
    });
    return HttpResponse.json({
      status: 'accepted',
      runner_test: true,
      task_id: taskId,
      run_id: runId,
      resolved_runner_id: runnerId,
    }, { status: 202 });
  }),
];
