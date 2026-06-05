import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mongoStoreMock = vi.hoisted(() => {
  const list = vi.fn(async () => []);
  const get = vi.fn(async () => null);
  const close = vi.fn(async () => undefined);
  const constructor = vi.fn(function MongoJsonDocStoreMock() {
    return { list, get, close };
  });
  return { close, constructor, get, list };
});

const pgMock = vi.hoisted(() => {
  const query = vi.fn(async () => ({ rows: [] }));
  const end = vi.fn(async () => undefined);
  const constructor = vi.fn(function PoolMock() {
    return { end, query };
  });
  return { constructor, end, query };
});

vi.mock('@mbos/adapters-private', () => ({
  MongoJsonDocStore: mongoStoreMock.constructor,
}));

vi.mock('pg', () => ({
  Pool: pgMock.constructor,
}));

import {
  assertNoServiceStartCommand,
  assertPodRoutableProviderBaseUrl,
  buildNoServiceStartCommandRunner,
  buildProductFlowRuntimeTruth,
  runUnifiedDeployProductFlowsProducer,
  validateProductFlowEvidence,
  type ProductFlowCommandRunner,
  type ProductFlowFetch,
  type ProductFlowFs,
} from './check-product-flows';

const SITE_ENV = [
  'UNIFIED_DEPLOY_PROFILE=local-kind',
  'PUBLIC_BASE_URL=http://agentsmith.localtest.me:29180',
  'PUBLIC_API_BASE_URL=http://agentsmith.localtest.me:29180/api/v1',
  'RUNNER_PUBLIC_API_BASE_URL=ws://agentsmith.localtest.me:29180/api/v1',
  'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=llmup-admin-token',
  'MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@sha256:9999',
].join('\n');

const SUBSTRATE_TRUTH = [
  'SUBSTRATE_TRUTH_SCHEMA_VERSION=agentsmith.docker-substrate.truth/v1',
  'SUBSTRATE_POSTGRES_HOST=172.19.0.1',
  'SUBSTRATE_POSTGRES_PORT=15432',
  'SUBSTRATE_POSTGRES_DATABASE=agentsmith',
  'SUBSTRATE_POSTGRES_USER=agentsmith',
  'SUBSTRATE_POSTGRES_PASSWORD=agentsmith_dev_password',
  'SUBSTRATE_MONGODB_HOST=172.19.0.1',
  'SUBSTRATE_MONGODB_PORT=27027',
  'SUBSTRATE_MONGODB_DATABASE=agentsmith',
  'SUBSTRATE_MONGODB_USER=agentsmith',
  'SUBSTRATE_MONGODB_PASSWORD=agentsmith_dev_password',
  'SUBSTRATE_REDIS_HOST=172.19.0.1',
  'SUBSTRATE_REDIS_PORT=16379',
  'SUBSTRATE_REDIS_PASSWORD=agentsmith_dev_password',
  'SUBSTRATE_MINIO_HOST=172.19.0.1',
  'SUBSTRATE_MINIO_PORT=19000',
  'SUBSTRATE_MINIO_ACCESS_KEY=agentsmith',
  'SUBSTRATE_MINIO_SECRET_KEY=agentsmith_dev_password',
  'SUBSTRATE_MINIO_BUCKET=agentsmith-files',
  'SUBSTRATE_KEYCLOAK_HOST=172.19.0.1',
  'SUBSTRATE_KEYCLOAK_PORT=18080',
  'SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER=http://localhost:18080/realms/agentsmith',
  'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=http://substrate-keycloak:8080',
  'SUBSTRATE_KEYCLOAK_REALM=agentsmith',
  'SUBSTRATE_KEYCLOAK_CLIENT_ID=agentsmith-web',
  'SUBSTRATE_KEYCLOAK_ADMIN=agentsmith-admin',
  'SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD=agentsmith_dev_password',
].join('\n');

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  mongoStoreMock.constructor.mockClear();
  mongoStoreMock.list.mockReset();
  mongoStoreMock.list.mockResolvedValue([]);
  mongoStoreMock.get.mockReset();
  mongoStoreMock.get.mockResolvedValue(null);
  mongoStoreMock.close.mockReset();
  mongoStoreMock.close.mockResolvedValue(undefined);
  pgMock.constructor.mockClear();
  pgMock.query.mockReset();
  pgMock.query.mockResolvedValue({ rows: [] });
  pgMock.end.mockReset();
  pgMock.end.mockResolvedValue(undefined);
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function responseJson(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function responseText(status: number, value: string, contentType = 'text/plain'): Response {
  return new Response(status === 204 || status === 304 ? null : value, {
    status,
    headers: { 'content-type': contentType },
  });
}

function makeFs(writes: Record<string, string> = {}): ProductFlowFs {
  return {
    readFile: vi.fn(async (filePath: string) => {
      if (filePath.endsWith('site.env')) return SITE_ENV;
      if (filePath.endsWith('connection.env')) return SUBSTRATE_TRUTH;
      throw new Error(`unexpected read: ${filePath}`);
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (filePath: string, content: string) => {
      writes[filePath] = content;
    }),
  };
}

function makeFailingProfileFetch(): ProductFlowFetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/v1/me/profile')) {
      return responseJson(500, { error: 'profile_failed' });
    }
    return responseJson(404, { error: `unexpected:${url}` });
  });
}

function makeKeycloakConflictReuseFetch(): ProductFlowFetch {
  let integrationUserConflictSeen = false;
  const userByKey = (key: string): Record<string, unknown> => ({
    id: `kc-${key}`,
    username: key,
    firstName: key === 'dev-admin' ? 'Dev' : 'Integration',
    lastName: key === 'dev-admin' ? 'Admin' : key.replace(/^integration-/u, '').replace(/^\w/u, (value) => value.toUpperCase()),
    email: `${key}@example.com`,
    emailVerified: true,
    enabled: true,
  });

  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return responseJson(200, { access_token: 'admin-token' });
    }
    if (url.endsWith('/admin/realms/agentsmith') && method === 'GET') {
      return responseJson(200, { realm: 'agentsmith' });
    }
    if (url.includes('/admin/realms/agentsmith/clients?clientId=')) {
      return responseJson(200, [{ id: 'client-uuid', clientId: 'agentsmith-web' }]);
    }
    if (url.endsWith('/admin/realms/agentsmith/clients/client-uuid') && method === 'GET') {
      return responseJson(200, {
        id: 'client-uuid',
        clientId: 'agentsmith-web',
        redirectUris: [],
        webOrigins: [],
      });
    }
    if (url.endsWith('/admin/realms/agentsmith/clients/client-uuid') && method === 'PUT') {
      return responseText(204, '');
    }
    if (url.includes('/admin/realms/agentsmith/users?')) {
      const parsed = new URL(url);
      const haystack = `${parsed.searchParams.get('username') ?? ''} ${parsed.searchParams.get('email') ?? ''} ${parsed.searchParams.get('search') ?? ''}`;
      if (haystack.includes('integration-user') && !integrationUserConflictSeen) {
        return responseJson(200, []);
      }
      const known = ['dev-admin', 'integration-user', 'integration-member', 'integration-guest', 'integration-invitee']
        .find((key) => haystack.includes(key));
      return responseJson(200, known ? [userByKey(known)] : []);
    }
    if (url.endsWith('/admin/realms/agentsmith/users') && method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { username?: string } : {};
      if (body.username === 'integration-user') {
        integrationUserConflictSeen = true;
        return responseJson(409, { errorMessage: 'User exists with same email' });
      }
      return new Response('', {
        status: 201,
        headers: { location: `http://localhost/admin/realms/agentsmith/users/kc-${body.username ?? 'created'}` },
      });
    }
    if (url.includes('/admin/realms/agentsmith/users/') && method === 'PUT') {
      return responseText(204, '');
    }
    if (url.endsWith('/api/v1/me/profile')) {
      return responseJson(500, { error: 'profile_failed' });
    }
    return responseJson(404, { error: `unexpected:${method}:${url}` });
  });
}

function makeFocusedAgentTaskFetch(observed: {
  chatRequests: number;
  taskCreatePayloads?: Record<string, unknown>[];
}): ProductFlowFetch {
  let libraryReadyReads = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/chat/completions')) {
      observed.chatRequests += 1;
      return responseJson(500, { error: 'chat_flow_should_not_run' });
    }
    if (url.endsWith('/api/public/workspaces')) {
      return responseJson(200, { items: [{ id: 'ws_default' }] });
    }
    if (url.endsWith('/projects') && method === 'POST') {
      return responseJson(201, { id: 'proj_focused', name: 'Focused Product Flow' });
    }
    if (url.endsWith('/projects') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'proj_focused', name: 'Focused Product Flow' }] });
    }
    if (url.endsWith('/projects/proj_focused') && method === 'GET') {
      return responseJson(200, { id: 'proj_focused', name: 'Focused Product Flow' });
    }
    if (url.endsWith('/credentials') && method === 'POST') {
      return responseJson(201, { id: 'cred_focused' });
    }
    if (url.endsWith('/endpoints') && method === 'POST') {
      return responseJson(201, { id: 'ep_focused', model: 'integration-chat-model' });
    }
    if (url.endsWith('/chat/sessions') && method === 'POST') {
      return responseJson(201, { id: 'chat_focused' });
    }
    if (url.endsWith('/chat/sessions/chat_focused/messages/stream') && method === 'POST') {
      return responseText(
        200,
        [
          'data: {"choices":[{"delta":{"content":"Hello from unified deploy product flow mock provider."}}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        'text/event-stream',
      );
    }
    if (url.endsWith('/file-libraries') && method === 'POST') {
      return responseJson(201, { id: 'flib_focused' });
    }
    if (url.endsWith('/file-libraries/flib_focused') && method === 'GET') {
      libraryReadyReads += 1;
      return responseJson(200, { id: 'flib_focused', status: libraryReadyReads > 0 ? 'ready' : 'creating' });
    }
    if (url.endsWith('/file-libraries/flib_focused/folders') && method === 'POST') {
      return responseText(204, '');
    }
    if (url.endsWith('/file-libraries/flib_focused/upload') && method === 'POST') {
      return responseJson(201, { path: 'docs/guide.txt' });
    }
    if (url.includes('/file-libraries/flib_focused/entries') && method === 'GET') {
      return responseJson(200, { items: [{ name: 'guide.txt', path: 'docs/guide.txt' }] });
    }
    if (url.includes('/file-libraries/flib_focused/download') && method === 'GET') {
      return responseText(200, 'hello from unified deploy product flow\n');
    }
    if (url.endsWith('/agent-runners') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'runner_focused', is_default: true, status: 'ready' }] });
    }
    if (url.endsWith('/agent-task-model-setting') && method === 'GET') {
      return responseJson(200, { setting: { endpoint_id: 'ep_focused' }, readiness: { state: 'ready' } });
    }
    if (url.endsWith('/agent-runners/runner_focused/diagnostics') && method === 'GET') {
      return responseJson(200, { presence: 'managed' });
    }
    if (url.endsWith('/agent-runners/runner_focused/execution-config') && method === 'GET') {
      return responseJson(200, { schema_version: 1 });
    }
    if (url.endsWith('/agent-runners/runner_focused/connection-info') && method === 'GET') {
      return responseJson(403, { error: 'forbidden' });
    }
    if (url.endsWith('/tasks') && method === 'POST') {
      const payload = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      observed.taskCreatePayloads?.push(payload);
      if (payload.workspace_file_library_id !== undefined || payload.workspace_mode !== 'create_new') {
        return responseJson(400, {
          error_code: 'AGENT_TASK_WORKSPACE_MODE_INVALID',
          message: 'workspace_file_library_id requires workspace_mode=use_existing',
        });
      }
      return responseJson(201, { id: 'task_focused', workspace_file_library_id: 'flib_task_created' });
    }
    if (url.endsWith('/tasks/task_focused/runs') && method === 'POST') {
      return responseJson(200, { id: 'run_focused' });
    }
    if (url.includes('/tasks/task_focused/traces') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'trace_done', status: 'success', summary: 'Run completed' }] });
    }
    return responseJson(404, { error: `unexpected:${method}:${url}` });
  });
}

function makeFileLibraryPendingFetch(
  observed: { createAttempts: number },
  pendingAttempts: number,
  options: { operationProjection?: Record<string, unknown> } = {},
): ProductFlowFetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/public/workspaces')) {
      return responseJson(200, { items: [{ id: 'ws_default' }] });
    }
    if (url.endsWith('/projects') && method === 'POST') {
      return responseJson(201, { id: 'proj_pending', name: 'Pending Storage Product Flow' });
    }
    if (url.endsWith('/projects') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'proj_pending', name: 'Pending Storage Product Flow' }] });
    }
    if (url.endsWith('/projects/proj_pending') && method === 'GET') {
      return responseJson(200, { id: 'proj_pending', name: 'Pending Storage Product Flow' });
    }
    if (url.endsWith('/file-libraries') && method === 'POST') {
      observed.createAttempts += 1;
      if (observed.createAttempts <= pendingAttempts) {
        return responseJson(409, {
          error_code: 'PROJECT_STORAGE_PENDING',
          message: 'Project storage is still being initialized.',
        });
      }
      return responseJson(201, { id: 'flib_pending' });
    }
    if (url.endsWith('/file-libraries/flib_pending') && method === 'GET') {
      return responseJson(200, { id: 'flib_pending', status: 'ready' });
    }
    if (url.endsWith('/file-libraries/flib_pending/folders') && method === 'POST') {
      return responseText(204, '');
    }
    if (url.endsWith('/file-libraries/flib_pending/upload') && method === 'POST') {
      return responseJson(201, { path: 'docs/guide.txt' });
    }
    if (url.includes('/file-libraries/flib_pending/entries') && method === 'GET') {
      return responseJson(200, { items: [{ name: 'guide.txt', path: 'docs/guide.txt' }] });
    }
    if (url.includes('/file-libraries/flib_pending/download') && method === 'GET') {
      return responseText(200, 'hello from unified deploy product flow\n');
    }
    if (url.includes('/file-library-operations/op_volume_binding_pending') && method === 'GET' && options.operationProjection) {
      return responseJson(200, options.operationProjection);
    }
    return responseJson(404, { error: `unexpected:${method}:${url}` });
  });
}

function makeFileLibraryBlockedFetch(observed: { createAttempts: number }): ProductFlowFetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/public/workspaces')) {
      return responseJson(200, { items: [{ id: 'ws_default' }] });
    }
    if (url.endsWith('/projects') && method === 'POST') {
      return responseJson(201, { id: 'proj_blocked', name: 'Blocked Storage Product Flow' });
    }
    if (url.endsWith('/projects') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'proj_blocked', name: 'Blocked Storage Product Flow' }] });
    }
    if (url.endsWith('/projects/proj_blocked') && method === 'GET') {
      return responseJson(200, { id: 'proj_blocked', name: 'Blocked Storage Product Flow' });
    }
    if (url.endsWith('/file-libraries') && method === 'POST') {
      observed.createAttempts += 1;
      return responseJson(409, {
        error_code: 'PROJECT_STORAGE_BLOCKED',
        message: 'Project storage initialization failed.',
      });
    }
    return responseJson(404, { error: `unexpected:${method}:${url}` });
  });
}

function makeFilesBlockedWithManagedRunnerObserverFetch(observed: {
  createAttempts: number;
  managedRunnerRequests: string[];
}): ProductFlowFetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/public/workspaces')) {
      return responseJson(200, { items: [{ id: 'ws_default' }] });
    }
    if (url.endsWith('/projects') && method === 'POST') {
      return responseJson(201, { id: 'proj_dependency_blocked', name: 'Dependency Blocked Product Flow' });
    }
    if (url.endsWith('/projects') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'proj_dependency_blocked', name: 'Dependency Blocked Product Flow' }] });
    }
    if (url.endsWith('/projects/proj_dependency_blocked') && method === 'GET') {
      return responseJson(200, { id: 'proj_dependency_blocked', name: 'Dependency Blocked Product Flow' });
    }
    if (url.endsWith('/file-libraries') && method === 'POST') {
      observed.createAttempts += 1;
      return responseJson(409, {
        error_code: 'PROJECT_STORAGE_BLOCKED',
        message: 'Project storage initialization failed.',
      });
    }
    if (
      url.endsWith('/credentials')
      || url.endsWith('/endpoints')
      || url.endsWith('/agent-runners')
      || url.endsWith('/agent-task-model-setting')
      || url.includes('/agent-runners/')
      || url.endsWith('/tasks')
      || url.includes('/tasks/')
    ) {
      observed.managedRunnerRequests.push(`${method} ${url}`);
      return responseJson(500, { error: 'managed_runner_dependency_block_should_have_short_circuited' });
    }
    return responseJson(404, { error: `unexpected:${method}:${url}` });
  });
}

function makeFileLibraryProvisioningFailedFetch(observed: { createAttempts: number; requestId: string }): ProductFlowFetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    if (url.endsWith('/api/public/workspaces')) {
      return responseJson(200, { items: [{ id: 'ws_default' }] });
    }
    if (url.endsWith('/projects') && method === 'POST') {
      return responseJson(201, { id: 'proj_provisioning_failed', name: 'Provisioning Failure Product Flow' });
    }
    if (url.endsWith('/projects') && method === 'GET') {
      return responseJson(200, { items: [{ id: 'proj_provisioning_failed', name: 'Provisioning Failure Product Flow' }] });
    }
    if (url.endsWith('/projects/proj_provisioning_failed') && method === 'GET') {
      return responseJson(200, { id: 'proj_provisioning_failed', name: 'Provisioning Failure Product Flow' });
    }
    if (url.endsWith('/file-libraries') && method === 'POST') {
      observed.createAttempts += 1;
      observed.requestId = headers.get('x-request-id') ?? '';
      return responseJson(502, {
        error_code: 'FILE_LIBRARY_PROVISIONING_FAILED',
        message: 'file_library_operation_failed',
      });
    }
    return responseJson(404, { error: `unexpected:${method}:${url}` });
  });
}

describe('unified deploy product flow producer', () => {
  it('loads product runtime truth from generated site env and Docker substrate truth', () => {
    const truth = buildProductFlowRuntimeTruth({
      siteEnvSource: SITE_ENV,
      siteEnvPath: 'artifacts/unified-deploy/local-kind-site.env',
      substrateTruthSource: SUBSTRATE_TRUTH,
      substrateTruthPath: 'infra/deploy/unified/substrate/connection.env',
    });

    expect(truth.publicBaseUrl).toBe('http://agentsmith.localtest.me:29180');
    expect(truth.apiBaseUrl).toBe('http://agentsmith.localtest.me:29180/api/v1');
    expect(truth.keycloak.publicBaseUrl).toBe('http://localhost:18080');
    expect(truth.keycloak.internalBaseUrl).toBe('http://substrate-keycloak:8080');
    expect(truth.keycloak.realm).toBe('agentsmith');
    expect(truth.postgres.url).toBe('postgresql://agentsmith:agentsmith_dev_password@172.19.0.1:15432/agentsmith');
    expect(truth.postgres.dbName).toBe('agentsmith');
    expect(truth.mongo.url).toBe('mongodb://agentsmith:agentsmith_dev_password@172.19.0.1:27027/admin');
    expect(truth.mongo.dbName).toBe('agentsmith');
    expect(truth.minio.endpoint).toBe('http://172.19.0.1:19000');
    expect(truth.llmup.internalBaseUrl).toBe('http://agentsmith-llmup:8080');
    expect(truth.managedRunner.image).toBe('kind-registry:5000/mbos/agentsmith-managed-runner@sha256:9999');
  });

  it('rejects provider base URLs that pods cannot route to', () => {
    expect(() => assertPodRoutableProviderBaseUrl('http://127.0.0.1:9999/v1')).toThrow(/pod-routable/u);
    expect(() => assertPodRoutableProviderBaseUrl('http://localhost:9999/v1')).toThrow(/pod-routable/u);
    expect(() => assertPodRoutableProviderBaseUrl('http://172.19.0.1:9999/v1')).not.toThrow();
  });

  it('guards command runners against starting API, Web, or llmup services', async () => {
    const runner = vi.fn<ProductFlowCommandRunner>(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    }));
    const guarded = buildNoServiceStartCommandRunner(runner);

    assertNoServiceStartCommand('kubectl get pods');
    await expect(guarded('kubectl', ['get', 'pods'])).resolves.toMatchObject({ exitCode: 0 });
    expect(runner).toHaveBeenCalledTimes(1);

    expect(() => assertNoServiceStartCommand('npm run dev')).toThrow(/must not start/u);
    await expect(guarded('npm', ['run', 'backend-real:up'])).rejects.toThrow(/must not start/u);
  });

  it('validates focused product-flow evidence shape and provenance', () => {
    expect(validateProductFlowEvidence({
      schema_version: 'agentsmith.focused-product-flow.evidence/v1',
      flow: 'login_profile',
      status: 'passed',
      producer: 'unified-deploy-product-flows',
      command: 'npm run test:unified-deploy:product-flows',
      generated_at: '2026-05-07T00:00:00.000Z',
    }, 'login_profile')).toEqual({ ok: true });

    expect(validateProductFlowEvidence({
      schema_version: 'agentsmith.focused-product-flow.evidence/v1',
      flow: 'login_profile',
      status: 'failed',
      producer: 'unified-deploy-product-flows',
      command: 'npm run test:unified-deploy:product-flows',
      generated_at: '2026-05-07T00:00:00.000Z',
    }, 'login_profile')).toMatchObject({ ok: false });
  });

  it('writes honest failed evidence for a failing flow instead of marking it passed', async () => {
    const writes: Record<string, string> = {};
    const fs = makeFs(writes);

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs,
      fetch: makeFailingProfileFetch(),
      flowIds: ['login_profile'],
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual([
      expect.objectContaining({
        path: 'flow:login_profile',
        message: expect.stringContaining('/me/profile expected 200'),
      }),
    ]);
    const evidencePayloads = Object.values(writes)
      .filter((text) => text.trim().startsWith('{'))
      .map((text) => JSON.parse(text) as Record<string, unknown>);
    expect(evidencePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        flow: 'login_profile',
        status: 'failed',
      }),
      expect.objectContaining({
        schema_version: 'agentsmith.unified-deploy.product-flows.aggregate/v1',
        status: 'failed',
      }),
    ]));
  });

  it('reads env files as UTF-8 through the default fs adapter', async () => {
    const root = tempDir('unified-product-flows-fs-');
    const siteEnvPath = join(root, 'site.env');
    const substrateTruthPath = join(root, 'connection.env');
    writeFileSync(siteEnvPath, SITE_ENV, 'utf8');
    writeFileSync(substrateTruthPath, SUBSTRATE_TRUTH, 'utf8');

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath,
      substrateTruthPath,
      evidenceDir: join(root, 'evidence'),
      fetch: makeFailingProfileFetch(),
      flowIds: ['login_profile'],
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.status).toBe('failed');
    expect(result.failures[0]?.message).toContain('/me/profile expected 200');
  });

  it('rejects a symlinked evidenceDir before writing product-flow evidence', async () => {
    const root = tempDir('unified-product-flows-evidence-');
    const outsideRoot = tempDir('unified-product-flows-evidence-outside-');
    const siteEnvPath = join(root, 'site.env');
    const substrateTruthPath = join(root, 'connection.env');
    const evidenceDir = join(root, 'evidence');
    writeFileSync(siteEnvPath, SITE_ENV, 'utf8');
    writeFileSync(substrateTruthPath, SUBSTRATE_TRUTH, 'utf8');
    symlinkSync(outsideRoot, evidenceDir, 'dir');

    await expect(runUnifiedDeployProductFlowsProducer({
      siteEnvPath,
      substrateTruthPath,
      evidenceDir,
      fetch: makeFailingProfileFetch(),
      flowIds: ['login_profile'],
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    })).rejects.toThrow(/evidence.*symlink/i);
  });

  it('writes failed evidence when product bootstrap cannot complete', async () => {
    const writes: Record<string, string> = {};
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(writes),
      fetch: makeFailingProfileFetch(),
      flowIds: ['login_profile'],
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => {
        throw new Error('keycloak_unavailable');
      },
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.status).toBe('failed');
    expect(result.failures[0]?.message).toContain('product bootstrap failed: keycloak_unavailable');
    const evidencePayloads = Object.values(writes)
      .filter((text) => text.trim().startsWith('{'))
      .map((text) => JSON.parse(text) as Record<string, unknown>);
    expect(evidencePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        flow: 'login_profile',
        status: 'failed',
      }),
      expect.objectContaining({
        schema_version: 'agentsmith.unified-deploy.product-flows.aggregate/v1',
        status: 'failed',
      }),
    ]));
  });

  it('fails schema preflight when public.projects is missing without running projects.sql', async () => {
    const writes: Record<string, string> = {};
    const fs = makeFs(writes);
    pgMock.query.mockResolvedValueOnce({ rows: [{ projects_table_exists: false }] });

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs,
      fetch: makeFailingProfileFetch(),
      flowIds: ['workspace_project'],
      keycloakBootstrapper: async () => {
        throw new Error('keycloak bootstrap should not run when schema is missing');
      },
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.status).toBe('failed');
    expect(result.failures[0]?.message).toContain('product_schema_not_ready/projects_table_missing');
    expect(fs.readFile).not.toHaveBeenCalledWith(expect.stringContaining('projects.sql'));
    expect(pgMock.query).toHaveBeenCalledWith(expect.stringContaining("to_regclass('public.projects')"));
    expect(result.evidence.flows[0]?.checks).toMatchObject({
      schema_preflight: {
        projects_table_exists: false,
      },
    });
  });

  it('records schema preflight evidence instead of table initialization semantics', async () => {
    const observed = { chatRequests: 0 };
    const fs = makeFs();
    pgMock.query.mockResolvedValueOnce({ rows: [{ projects_table_exists: true }] });

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs,
      fetch: makeFocusedAgentTaskFetch(observed),
      flowIds: ['workspace_project'],
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const workspaceFlow = result.evidence.flows.find((flow) => flow.flow === 'workspace_project');
    expect(result.status).toBe('passed');
    expect(fs.readFile).not.toHaveBeenCalledWith(expect.stringContaining('projects.sql'));
    expect(workspaceFlow?.checks).toMatchObject({
      schema_preflight: {
        projects_table_exists: true,
      },
      project_id: 'proj_focused',
    });
    expect(JSON.stringify(workspaceFlow?.checks)).not.toContain('projects_table_initialized');
  });

  it('binds lane-produced product-flow evidence to the canonical lane command', async () => {
    const observed = { chatRequests: 0 };
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(),
      fetch: makeFocusedAgentTaskFetch(observed),
      flowIds: ['workspace_project'],
      producerCommand: 'npm run lane:unified-deploy:product-flows',
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.status).toBe('passed');
    expect(result.evidence.command).toBe('npm run lane:unified-deploy:product-flows');
    expect(result.evidence.flows).toHaveLength(1);
    expect(result.evidence.flows[0]?.command).toBe('npm run lane:unified-deploy:product-flows');
  });

  it('reuses an existing Keycloak user when create reports an email conflict', async () => {
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(),
      fetch: makeKeycloakConflictReuseFetch(),
      flowIds: ['login_profile'],
      backendBootstrapper: async () => ({}),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.failures[0]?.message).toContain('/me/profile expected 200');
    expect(result.failures[0]?.message).not.toContain('keycloak_user_conflict_unresolved');
  });

  it('runs the focused files plus managed runner flow with an independent create_new task workspace', async () => {
    const observed = { chatRequests: 0, taskCreatePayloads: [] as Record<string, unknown>[] };
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(),
      fetch: makeFocusedAgentTaskFetch(observed),
      flowIds: ['workspace_project', 'files', 'agent_task_managed_runner'],
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      providerStarter: async () => ({
        baseUrl: 'http://172.19.0.1:39999/v1',
        getRequestCount: () => observed.chatRequests,
        close: async () => undefined,
      }),
      managedRunnerSeeder: async () => ({
        runnerId: 'runner_focused',
        runnerName: 'Focused runner',
        status: 'ready',
        isDefault: true,
        defaultEndpointId: 'ep_focused',
        configuredImage: null,
        agentTaskModelSetting: {
          endpointId: 'ep_focused',
          defaultModelId: 'integration-chat-model',
          settingRevision: 'rev_focused',
          updated: true,
        },
        capabilities: {},
        diagnostics: {},
        wsUrl: 'ws://agentsmith.localtest.me:29180/api/v1/agent-execution/ws?agent_runner_id=runner_focused',
      }),
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(result.status).toBe('passed');
    expect(result.evidence.flows.map((flow) => flow.flow)).toEqual([
      'workspace_project',
      'files',
      'agent_task_managed_runner',
    ]);
    expect(observed.chatRequests).toBe(0);
    expect(observed.taskCreatePayloads).toEqual([
      expect.objectContaining({
        workspace_mode: 'create_new',
      }),
    ]);
    expect(observed.taskCreatePayloads[0]).not.toHaveProperty('workspace_file_library_id');
    const managedRunnerFlow = result.evidence.flows.find((flow) => flow.flow === 'agent_task_managed_runner');
    expect(managedRunnerFlow?.checks).toMatchObject({
      endpoint_setup: {
        provider_neutral_endpoint: {
          endpoint_type: 'custom',
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          credential_type: 'api_key',
          success_path: 'provider_neutral_endpoint',
        },
      },
      task_execution: {
        task_workspace_file_library_id: 'flib_task_created',
      },
    });
  });

  it('records provider-neutral endpoint proof on the chat source flow evidence', async () => {
    const observed = { chatRequests: 0 };
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(),
      fetch: makeFocusedAgentTaskFetch(observed),
      flowIds: ['workspace_project', 'chat_via_llmup'],
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      providerStarter: async () => ({
        baseUrl: 'http://172.19.0.1:39999/v1',
        getRequestCount: () => 1,
        close: async () => undefined,
      }),
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const chatFlow = result.evidence.flows.find((flow) => flow.flow === 'chat_via_llmup');
    expect(result.status).toBe('passed');
    expect(chatFlow?.checks).toMatchObject({
      provider_neutral_endpoint: {
        endpoint_type: 'custom',
        provider_family: 'custom',
        upstream_protocol: 'openai_chat_completions',
        credential_type: 'api_key',
        success_path: 'provider_neutral_endpoint',
      },
    });
    expect(JSON.stringify(chatFlow?.checks)).not.toContain('oauth_provider');
    expect(JSON.stringify(chatFlow?.checks)).not.toContain('provider_specific_skill');
  });

  it('retries file library create on typed project storage pending and records attempts', async () => {
    const observed = { createAttempts: 0 };
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(),
      fetch: makeFileLibraryPendingFetch(observed, 2),
      flowIds: ['workspace_project', 'files'],
      fileLibraryCreateRetryBaseMs: 0,
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const filesFlow = result.evidence.flows.find((flow) => flow.flow === 'files');
    expect(result.status).toBe('passed');
    expect(observed.createAttempts).toBe(3);
    expect(filesFlow?.checks).toMatchObject({
      create_attempts: 3,
      create_last_error_code: 'PROJECT_STORAGE_PENDING',
      library_id: 'flib_pending',
      library_status: 'ready',
    });
  });

  it('fails file library create immediately on typed project storage blocked', async () => {
    const observed = { createAttempts: 0 };
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(),
      fetch: makeFileLibraryBlockedFetch(observed),
      flowIds: ['workspace_project', 'files'],
      fileLibraryCreateRetryBaseMs: 0,
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const filesFlow = result.evidence.flows.find((flow) => flow.flow === 'files');
    expect(result.status).toBe('failed');
    expect(observed.createAttempts).toBe(1);
    expect(filesFlow?.checks).toMatchObject({
      create_attempts: 1,
      create_last_error_code: 'PROJECT_STORAGE_BLOCKED',
    });
    expect(filesFlow?.failure?.message).toContain('file library create blocked');
  });

  it('dependency-blocks managed runner when the files flow has already failed', async () => {
    const observed = { createAttempts: 0, managedRunnerRequests: [] as string[] };
    const writes: Record<string, string> = {};
    const providerStarter = vi.fn(async () => ({
      baseUrl: 'http://172.19.0.1:39999/v1',
      getRequestCount: () => 0,
      close: async () => undefined,
    }));
    const managedRunnerSeeder = vi.fn(async () => {
      throw new Error('managed runner seed should not run after files failed');
    });
    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(writes),
      fetch: makeFilesBlockedWithManagedRunnerObserverFetch(observed),
      flowIds: ['workspace_project', 'files', 'agent_task_managed_runner'],
      fileLibraryCreateRetryBaseMs: 0,
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      providerStarter,
      managedRunnerSeeder,
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const filesFlow = result.evidence.flows.find((flow) => flow.flow === 'files');
    const managedRunnerFlow = result.evidence.flows.find((flow) => flow.flow === 'agent_task_managed_runner');
    expect(result.status).toBe('failed');
    expect(observed.createAttempts).toBe(1);
    expect(observed.managedRunnerRequests).toEqual([]);
    expect(providerStarter).not.toHaveBeenCalled();
    expect(managedRunnerSeeder).not.toHaveBeenCalled();
    expect(filesFlow?.status).toBe('failed');
    expect(managedRunnerFlow).toMatchObject({
      flow: 'agent_task_managed_runner',
      status: 'failed',
      blocked_by: 'files',
      root_cause_flow: 'files',
      failure: {
        path: 'flow:agent_task_managed_runner',
        code: 'DEPENDENCY_BLOCKED',
      },
    });
    expect(managedRunnerFlow?.failure?.message).toContain('blocked by files');
    expect(managedRunnerFlow).not.toHaveProperty('flow_evidence_paths');
    expect(result.evidence).toMatchObject({
      status: 'failed',
      root_cause_flow: 'files',
    });
    const flowEvidencePayloads = Object.entries(writes)
      .filter(([filePath, text]) => filePath.includes('product-flow-') && text.trim().startsWith('{'))
      .map(([, text]) => JSON.parse(text) as Record<string, unknown>);
    expect(flowEvidencePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        flow: 'files',
        status: 'failed',
      }),
      expect.objectContaining({
        flow: 'agent_task_managed_runner',
        status: 'failed',
        failure: expect.objectContaining({
          code: 'DEPENDENCY_BLOCKED',
          blocked_by: 'files',
        }),
      }),
    ]));
  });

  it('enriches files pending-to-limit evidence without replacing the primary failure', async () => {
    const observed = { createAttempts: 0 };
    const writes: Record<string, string> = {};
    const failureEvidenceProvider = vi.fn(async () => ({
      evidence_kind: 'file_library_provisioning_failure',
      request_correlation_id: 'pending-request',
      mongo_evidence: {
        afscp_mapping: {
          operation_id: 'op_pending_storage',
          operation_status: 'queued',
          last_error_code: 'STORAGE_PENDING',
        },
      },
      afscp_operation: {
        operation_id: 'op_pending_storage',
        operation_state: 'queued',
        diagnostic: 'AFSCP_API_SERVICE_TOKENS=super_secret_token_123',
      },
      evidence_sources: ['backend_response', 'mongo:project_file_library_afscp_mappings', 'api:file-library-operations'],
    }));

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(writes),
      fetch: makeFileLibraryPendingFetch(observed, 10),
      flowIds: ['workspace_project', 'files'],
      fileLibraryCreateMaxAttempts: 2,
      fileLibraryCreateRetryBaseMs: 0,
      fileLibraryFailureEvidenceProvider: failureEvidenceProvider,
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const filesFlow = result.evidence.flows.find((flow) => flow.flow === 'files');
    expect(result.status).toBe('failed');
    expect(observed.createAttempts).toBe(2);
    expect(failureEvidenceProvider).toHaveBeenCalledWith(expect.objectContaining({
      responseStatus: 409,
      backendError: expect.objectContaining({
        error_code: 'PROJECT_STORAGE_PENDING',
      }),
    }));
    expect(filesFlow?.failure?.message).toContain('file library create still pending after 2 attempts');
    expect(filesFlow?.failure?.message).not.toContain('super_secret_token_123');
    expect(filesFlow?.checks).toMatchObject({
      create_attempts: 2,
      create_last_error_code: 'PROJECT_STORAGE_PENDING',
      provisioning_failure_trace: {
        mongo_evidence: {
          afscp_mapping: {
            operation_id: 'op_pending_storage',
            operation_status: 'queued',
            last_error_code: 'STORAGE_PENDING',
          },
        },
        afscp_operation: {
          operation_id: 'op_pending_storage',
          operation_state: 'queued',
        },
      },
    });
    const serializedEvidence = JSON.stringify(Object.values(writes));
    expect(serializedEvidence).toContain('op_pending_storage');
    expect(serializedEvidence).toContain('[REDACTED]');
    expect(serializedEvidence).not.toContain('super_secret_token_123');
  });

  it('enriches files pending-to-limit evidence with project storage mapping and operation truth', async () => {
    const observed = { createAttempts: 0 };
    const writes: Record<string, string> = {};
    mongoStoreMock.get.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'project_afscp_namespace_mappings' && id === 'ws_default:proj_pending') {
        return {
          id,
          workspace_id: 'ws_default',
          project_id: 'proj_pending',
          namespace_id: 'ns_pending_storage',
          status: 'pending',
          stage: 'volume_binding',
          generation: 3,
          next_action: 'wait',
          retryable: false,
          namespace_upsert_operation_id: 'op_namespace_succeeded',
          volume_binding_operation_id: 'op_volume_binding_pending',
          last_error_code: 'AFSCP_VOLUME_TOKEN=super_secret_token_123',
          last_error: 'namespace volume binding stalled',
          updated_at: '2026-05-07T00:00:10.000Z',
        };
      }
      return null;
    });

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(writes),
      fetch: makeFileLibraryPendingFetch(observed, 10, {
        operationProjection: {
          operation_id: 'op_volume_binding_pending',
          operation_state: 'running',
          operation_type: 'namespace_volume_binding_put',
          resource: { type: 'namespace_volume_binding' },
          error: {
            code: 'AFSCP_VOLUME_TOKEN=super_secret_token_123',
            retryable: true,
          },
          phase: 'validate_namespace_volume_binding_put',
          attempt: 3,
          last_error: 'namespace volume binding stalled',
          updated_at: '2026-05-07T00:00:12.000Z',
        },
      }),
      flowIds: ['workspace_project', 'files'],
      fileLibraryCreateMaxAttempts: 2,
      fileLibraryCreateRetryBaseMs: 0,
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const filesFlow = result.evidence.flows.find((flow) => flow.flow === 'files');
    expect(result.status).toBe('failed');
    expect(observed.createAttempts).toBe(2);
    expect(mongoStoreMock.get).toHaveBeenCalledWith('project_afscp_namespace_mappings', 'ws_default:proj_pending');
    expect(filesFlow?.failure?.message).toContain('file library create still pending after 2 attempts');
    expect(filesFlow?.checks).toMatchObject({
      create_attempts: 2,
      create_last_error_code: 'PROJECT_STORAGE_PENDING',
      provisioning_failure_trace: {
        project_storage_mapping: {
          collection: 'project_afscp_namespace_mappings',
          mapping_id: 'ws_default:proj_pending',
          status: 'pending',
          stage: 'volume_binding',
          generation: 3,
          next_action: 'wait',
          retryable: false,
          volume_binding_operation_id: 'op_volume_binding_pending',
          active_operation_id: 'op_volume_binding_pending',
          active_operation_role: 'volume_binding',
          last_error: 'namespace volume binding stalled',
          updated_at: '2026-05-07T00:00:10.000Z',
        },
        project_storage_operation_id: 'op_volume_binding_pending',
        project_storage_operation: {
          operation_id: 'op_volume_binding_pending',
          operation_state: 'running',
          operation_status: 'running',
          operation_type: 'namespace_volume_binding_put',
          resource_type: 'namespace_volume_binding',
          phase: 'validate_namespace_volume_binding_put',
          attempt: 3,
          last_error: 'namespace volume binding stalled',
          updated_at: '2026-05-07T00:00:12.000Z',
        },
        afscp_operation: {
          operation_id: 'op_volume_binding_pending',
          operation_status: 'running',
          last_error: 'namespace volume binding stalled',
        },
      },
    });
    const serializedEvidence = JSON.stringify(Object.values(writes));
    expect(serializedEvidence).toContain('project_afscp_namespace_mappings');
    expect(serializedEvidence).toContain('op_volume_binding_pending');
    expect(serializedEvidence).toContain('[REDACTED]');
    expect(serializedEvidence).not.toContain('super_secret_token_123');
  });

  it('enriches failed files evidence with operation clues when provisioning returns a generic 502', async () => {
    const observed = { createAttempts: 0, requestId: '' };
    const writes: Record<string, string> = {};
    const failureEvidenceProvider = vi.fn(async () => ({
      evidence_kind: 'file_library_provisioning_failure',
      request_correlation_id: observed.requestId,
      file_library_id: 'flib_failed',
      afscp_operation_id: 'op_repo_create_failed',
      mongo_evidence: {
        catalog: {
          file_library_id: 'flib_failed',
          file_library_status: 'failed',
        },
        afscp_mapping: {
          operation_id: 'op_repo_create_failed',
          operation_status: 'failed',
          last_error_code: 'JVS_COMMAND_FAILED',
        },
      },
      afscp_operation: {
        operation_id: 'op_repo_create_failed',
        operation_state: 'operator_intervention_required',
        operation_type: 'repo_create',
        error_code: 'JVS_COMMAND_FAILED',
      },
      evidence_sources: ['backend_response', 'mongo:project_file_libraries/project_file_library_afscp_mappings', 'api:file-library-operations'],
    }));

    const result = await runUnifiedDeployProductFlowsProducer({
      siteEnvPath: 'site.env',
      substrateTruthPath: 'connection.env',
      evidenceDir: 'evidence',
      fs: makeFs(writes),
      fetch: makeFileLibraryProvisioningFailedFetch(observed),
      flowIds: ['workspace_project', 'files'],
      fileLibraryCreateRetryBaseMs: 0,
      fileLibraryFailureEvidenceProvider: failureEvidenceProvider,
      backendBootstrapper: async () => ({}),
      keycloakBootstrapper: async () => ({
        users: {
          devAdmin: { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
          integrationUser: { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
        },
      }),
      workspaceBootstrapper: async () => undefined,
      tokenProvider: async () => 'token-dev-admin',
      now: () => new Date('2026-05-07T00:00:00.000Z'),
    });

    const filesFlow = result.evidence.flows.find((flow) => flow.flow === 'files');
    expect(result.status).toBe('failed');
    expect(observed.createAttempts).toBe(1);
    expect(observed.requestId).toMatch(/^unified-product-files-/u);
    expect(failureEvidenceProvider).toHaveBeenCalledWith(expect.objectContaining({
      requestId: observed.requestId,
      responseStatus: 502,
      backendError: expect.objectContaining({
        error_code: 'FILE_LIBRARY_PROVISIONING_FAILED',
        message: 'file_library_operation_failed',
      }),
    }));
    expect(filesFlow?.checks).toMatchObject({
      create_attempts: 1,
      create_last_error_code: 'FILE_LIBRARY_PROVISIONING_FAILED',
      create_last_response: {
        status: 502,
        error_code: 'FILE_LIBRARY_PROVISIONING_FAILED',
        message: 'file_library_operation_failed',
      },
      provisioning_failure_trace: {
        request_correlation_id: observed.requestId,
        file_library_id: 'flib_failed',
        afscp_operation_id: 'op_repo_create_failed',
        afscp_operation: {
          operation_state: 'operator_intervention_required',
          error_code: 'JVS_COMMAND_FAILED',
        },
      },
    });

    const fileEvidence = Object.values(writes)
      .filter((text) => text.trim().startsWith('{'))
      .map((text) => JSON.parse(text) as Record<string, unknown>)
      .find((payload) => payload.flow === 'files');
    const serializedEvidence = JSON.stringify(fileEvidence);
    expect(serializedEvidence).toContain('op_repo_create_failed');
    expect(serializedEvidence).toContain('operator_intervention_required');
    expect(serializedEvidence).toContain('JVS_COMMAND_FAILED');
  });
});
