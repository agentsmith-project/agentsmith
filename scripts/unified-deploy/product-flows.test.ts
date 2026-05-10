import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

function makeFocusedAgentTaskFetch(observed: { chatRequests: number }): ProductFlowFetch {
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
      return responseJson(201, { id: 'task_focused' });
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

  it('runs the focused files plus managed runner flow without requiring the chat flow as endpoint setup', async () => {
    const observed = { chatRequests: 0 };
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
  });
});
