import { describe, expect, it, vi } from 'vitest';
import { AfscpBootstrapClient, AfscpClient, AfscpProductClient } from './afscp-client.js';
import type { CreateRepoInput, CreateWorkloadMountBindingInput } from './afscp-client.js';
import { AfscpConfigError } from './afscp-config.js';
import { AfscpClientError } from './afscp-error-mapper.js';

type CapturedRequest = {
  url: string;
  init: RequestInit;
};

const operationEnvelope = {
  operation_id: 'op_123',
  operation_state: 'queued',
  resource: { type: 'namespace', id: 'ns_project_1' },
  result: null,
  error: null,
};

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function createClient(fetchMock: typeof fetch): AfscpClient {
  return new AfscpClient({
    baseUrl: 'https://afscp.internal/',
    callerService: 'agentsmith-api',
    bootstrapCallerService: 'agentsmith-bootstrap',
    serviceToken: 'svc-secret-token',
    bootstrapServiceToken: 'bootstrap-svc-secret-token',
  }, fetchMock);
}

function readRuntimeProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return property in value ? (value as Record<string, unknown>)[property] : undefined;
}

describe('AfscpClient', () => {
  it('always sends namespace upsert mutations through the bootstrap caller', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse(operationEnvelope);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await client.upsertNamespace({
      namespaceId: 'ns_project_1',
      caller: 'bootstrap',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      actor: { type: 'user', id: 'user_1' },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://afscp.internal/internal/v1/namespaces/ns_project_1');
    expect(captured[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({ namespace_id: 'ns_project_1' });
    expect(headersToRecord(captured[0]?.init.headers)).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer bootstrap-svc-secret-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'idem-1',
      'X-AFSCP-Actor-Id': 'user_1',
      'X-AFSCP-Actor-Type': 'user',
      'X-AFSCP-Caller-Service': 'agentsmith-bootstrap',
      'X-AFSCP-Namespace-Id': 'ns_project_1',
      'X-Correlation-Id': 'corr-1',
    });
  });

  it('always sends namespace volume binding mutations through the bootstrap caller', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse(operationEnvelope);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await client.putNamespaceVolumeBinding({
      namespaceId: 'ns_project_1',
      caller: 'bootstrap',
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      actor: { type: 'admin_job', id: 'workspace-bootstrap' },
      binding: {
        namespace_id: 'ns_project_1',
        default_volume_id: 'vol_shared',
        allowed_callers: [
          { caller_service: 'agentsmith-api', roles: ['repo_admin'] },
        ],
        quota_bytes_default: 0,
        export_policy: { webdav_enabled: true, max_session_seconds: 900 },
        lifecycle_policy: {
          tombstone_retention_seconds: 604800,
          purge_requires_lifecycle_admin: true,
          break_glass_purge_enabled: false,
        },
        mount_policy: {
          workload_mount_enabled: true,
          workload_mount_requires_external_control_root: true,
          allow_privileged_workload: false,
        },
        template_policy: {
          namespace_templates_enabled: true,
          cross_namespace_clone_enabled: false,
        },
        status: 'active',
      },
    });

    expect(captured[0]?.url).toBe('https://afscp.internal/internal/v1/namespaces/ns_project_1/volume-binding');
    expect(captured[0]?.init.method).toBe('PUT');
    expect(headersToRecord(captured[0]?.init.headers)).toMatchObject({
      Authorization: 'Bearer bootstrap-svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-bootstrap',
      'X-AFSCP-Namespace-Id': 'ns_project_1',
      'Idempotency-Key': 'idem-2',
      'X-AFSCP-Actor-Type': 'admin_job',
      'X-AFSCP-Actor-Id': 'workspace-bootstrap',
    });
  });

  it('rejects product callers for bootstrap-managed namespace mutations before fetch', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;
    const client = createClient(fetchMock);

    const upsertPromise = client.upsertNamespace({
      namespaceId: 'ns_project_1',
      caller: 'product' as never,
      correlationId: 'corr-product-upsert',
      idempotencyKey: 'idem-product-upsert',
      actor: { type: 'user', id: 'user_1' },
    });
    await expect(upsertPromise).rejects.toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
    });

    await expect(client.putNamespaceVolumeBinding({
      namespaceId: 'ns_project_1',
      caller: 'product' as never,
      correlationId: 'corr-product-binding',
      idempotencyKey: 'idem-product-binding',
      actor: { type: 'user', id: 'user_1' },
      binding: { namespace_id: 'ns_project_1' },
    })).rejects.toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('types namespace mutations as bootstrap-only calls', () => {
    const client = createClient(vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch);

    if (false) {
      void client.upsertNamespace({
        namespaceId: 'ns_project_1',
        // @ts-expect-error product callers must not invoke bootstrap namespace mutations.
        caller: 'product',
        correlationId: 'corr-type-product-upsert',
        idempotencyKey: 'idem-type-product-upsert',
        actor: { type: 'user', id: 'user_1' },
      });
    }

    expect(client).toBeInstanceOf(AfscpClient);
  });

  it('sends namespace context but no mutation headers for namespace binding reads', async () => {
    const captured: CapturedRequest[] = [];
    const binding = {
      namespace_id: 'ns_project_1',
      default_volume_id: 'vol_shared',
      status: 'active',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse(binding);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    const result = await client.getNamespaceVolumeBinding({
      namespaceId: 'ns_project_1',
      correlationId: 'corr-3',
    });

    expect(result).toEqual(binding);
    const headers = headersToRecord(captured[0]?.init.headers);
    expect(captured[0]?.init.method).toBe('GET');
    expect(headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-api',
      'X-AFSCP-Namespace-Id': 'ns_project_1',
      'X-Correlation-Id': 'corr-3',
    });
    expect(headers).not.toHaveProperty('Idempotency-Key');
    expect(headers).not.toHaveProperty('X-AFSCP-Actor-Type');
    expect(headers).not.toHaveProperty('X-AFSCP-Actor-Id');
  });

  it('does not send namespace, actor, or idempotency headers for operation reads', async () => {
    const captured: CapturedRequest[] = [];
    const operation = {
      operation_id: 'op_123',
      operation_type: 'namespace_upsert',
      operation_state: 'succeeded',
      resource: { type: 'namespace', id: 'ns_project_1' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse(operation);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    const result = await client.getOperation({
      operationId: 'op_123',
      correlationId: 'corr-4',
    });

    expect(result).toEqual(operation);
    expect(captured[0]?.url).toBe('https://afscp.internal/internal/v1/operations/op_123');
    const headers = headersToRecord(captured[0]?.init.headers);
    expect(headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-api',
      'X-Correlation-Id': 'corr-4',
    });
  });

  it('creates, lists, reads, and deletes repos through the product caller namespace boundary', async () => {
    const captured: CapturedRequest[] = [];
    const repo = {
      repo_id: 'repo_file_library_1',
      namespace_id: 'ns_project_1',
      volume_id: 'vol_shared',
      repo_kind: 'repo',
      status: 'active',
      lifecycle: {
        status: 'active',
        retention_expires_at: null,
        last_lifecycle_operation_id: null,
      },
      created_at: '2026-05-09T00:00:00.000Z',
    };
    const repoOperationEnvelope = {
      operation_id: 'op_repo_create',
      operation_state: 'succeeded',
      resource: { type: 'repo', id: 'repo_file_library_1' },
      result: { repo },
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      if (String(input).endsWith('/internal/v1/repos') && init?.method === 'POST') {
        return createJsonResponse(repoOperationEnvelope);
      }
      if (String(input).includes('/internal/v1/repos?')) {
        return createJsonResponse({ repos: [repo] });
      }
      if (String(input).endsWith('/internal/v1/repos/repo_file_library_1') && init?.method === 'GET') {
        return createJsonResponse(repo);
      }
      return createJsonResponse({
        operation_id: 'op_repo_delete',
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_file_library_1' },
        result: null,
        error: null,
      }, 202);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await expect(client.createRepo({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      correlationId: 'corr-repo-create',
      idempotencyKey: 'idem-repo-create',
      actor: { type: 'user', id: 'user_1' },
    })).resolves.toEqual(repoOperationEnvelope);
    await expect(client.listRepos({
      namespaceId: 'ns_project_1',
      correlationId: 'corr-repo-list',
      lifecycleStatus: 'active',
    })).resolves.toEqual({ repos: [repo] });
    await expect(client.getRepo({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      correlationId: 'corr-repo-get',
    })).resolves.toEqual(repo);
    await client.deleteRepo({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      correlationId: 'corr-repo-delete',
      idempotencyKey: 'idem-repo-delete',
      actor: { type: 'user', id: 'user_1' },
      reason: 'file_library_delete',
    });

    expect(captured.map((entry) => [entry.init.method, entry.url])).toEqual([
      ['POST', 'https://afscp.internal/internal/v1/repos'],
      ['GET', 'https://afscp.internal/internal/v1/repos?namespace_id=ns_project_1&lifecycle_status=active'],
      ['GET', 'https://afscp.internal/internal/v1/repos/repo_file_library_1'],
      ['POST', 'https://afscp.internal/internal/v1/repos/repo_file_library_1:delete'],
    ]);
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      namespace_id: 'ns_project_1',
      target_repo_id: 'repo_file_library_1',
    });
    expect(JSON.parse(String(captured[3]?.init.body))).toEqual({
      reason: 'file_library_delete',
    });
    for (const entry of captured) {
      expect(headersToRecord(entry.init.headers)).toMatchObject({
        Authorization: 'Bearer svc-secret-token',
        'X-AFSCP-Caller-Service': 'agentsmith-api',
        'X-AFSCP-Namespace-Id': 'ns_project_1',
      });
    }
  });

  it('creates and revokes WebDAV exports without exposing access on export reads', async () => {
    const captured: CapturedRequest[] = [];
    const exportSession = {
      export_id: 'export_file_library_1',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_file_library_1',
      protocol: 'webdav',
      mode: 'read_write',
      status: 'active',
      created_by_caller_service: 'agentsmith-api',
      created_by_actor: { type: 'user', id: 'user_1' },
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
      expires_at: '2026-05-09T01:00:00.000Z',
      revoked_at: null,
      last_accessed_at: null,
      active_request_count: 0,
      active_write_count: 0,
      last_observed_at: null,
      last_gateway_heartbeat_at: null,
      gateway_heartbeat_expires_at: null,
      write_drained_at: null,
      terminal_observed_at: null,
      status_reason: '',
    };
    const exportEnvelope = {
      operation_id: 'op_export_create',
      operation_state: 'succeeded',
      resource: { type: 'export', id: 'export_file_library_1' },
      result: {
        export: exportSession,
        access: {
          url: 'https://files.example.test/e/export_file_library_1/',
          auth: {
            type: 'basic',
            username: 'export_file_library_1',
            password: 'one-time-webdav-secret',
          },
          mode: 'read_write',
          expires_at: '2026-05-09T01:00:00.000Z',
        },
      },
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      if (String(input).endsWith('/exports') && init?.method === 'POST') {
        return createJsonResponse(exportEnvelope, 202);
      }
      if (init?.method === 'GET') {
        return createJsonResponse(exportSession);
      }
      return createJsonResponse({
        operation_id: 'op_export_revoke',
        operation_state: 'queued',
        resource: { type: 'export', id: 'export_file_library_1' },
        result: null,
        error: null,
      }, 202);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await expect(client.createExport({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mode: 'read_write',
      ttlSeconds: 60,
      correlationId: 'corr-export-create',
      idempotencyKey: 'idem-export-create',
      actor: { type: 'user', id: 'user_1' },
    })).resolves.toEqual(exportEnvelope);
    await expect(client.getExport({
      namespaceId: 'ns_project_1',
      exportId: 'export_file_library_1',
      correlationId: 'corr-export-get',
    })).resolves.toEqual(exportSession);
    await client.revokeExport({
      namespaceId: 'ns_project_1',
      exportId: 'export_file_library_1',
      correlationId: 'corr-export-revoke',
      idempotencyKey: 'idem-export-revoke',
      actor: { type: 'user', id: 'user_1' },
    });

    expect(captured.map((entry) => [entry.init.method, entry.url])).toEqual([
      ['POST', 'https://afscp.internal/internal/v1/repos/repo_file_library_1/exports'],
      ['GET', 'https://afscp.internal/internal/v1/exports/export_file_library_1'],
      ['DELETE', 'https://afscp.internal/internal/v1/exports/export_file_library_1'],
    ]);
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      mode: 'read_write',
      ttl_seconds: 60,
    });
    expect(JSON.stringify(captured[1])).not.toContain('one-time-webdav-secret');
  });

  it('creates, reads, and revokes workload mount bindings through the product caller without fetching orchestrator plans', async () => {
    const captured: CapturedRequest[] = [];
    const mountBinding = {
      mount_binding_id: 'wmb_file_library_1',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_file_library_1',
      volume_id: 'vol_shared',
      mount_path: '/home/task_demo',
      read_only: false,
      status: 'issued',
      lease_expires_at: '2026-05-09T01:00:00.000Z',
    };
    const createEnvelope = {
      operation_id: 'op_workload_mount_create',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_file_library_1' },
      result: { mount_binding: mountBinding },
      error: null,
    };
    const revokeEnvelope = {
      operation_id: 'op_workload_mount_revoke',
      operation_state: 'queued',
      resource: { type: 'workload_mount_binding', id: 'wmb_file_library_1' },
      result: null,
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      if (String(input).endsWith('/workload-mount-bindings') && init?.method === 'POST') {
        return createJsonResponse(createEnvelope, 202);
      }
      if (String(input).endsWith('/internal/v1/workload-mount-bindings/wmb_file_library_1') && init?.method === 'GET') {
        return createJsonResponse(mountBinding);
      }
      return createJsonResponse(revokeEnvelope, 202);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await expect(client.createWorkloadMountBinding({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mountPath: '/home/task_demo',
      readOnly: false,
      leaseSeconds: 3600,
      correlationId: 'corr-mount-create',
      idempotencyKey: 'idem-mount-create',
      actor: { type: 'user', id: 'user_1' },
    })).resolves.toEqual(createEnvelope);
    await expect(client.getWorkloadMountBinding({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_file_library_1',
      correlationId: 'corr-mount-get',
    })).resolves.toEqual(mountBinding);
    await expect(client.revokeWorkloadMountBinding({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_file_library_1',
      correlationId: 'corr-mount-revoke',
      idempotencyKey: 'idem-mount-revoke',
      actor: { type: 'user', id: 'user_1' },
    })).resolves.toEqual(revokeEnvelope);

    expect(captured.map((entry) => [entry.init.method, entry.url])).toEqual([
      ['POST', 'https://afscp.internal/internal/v1/repos/repo_file_library_1/workload-mount-bindings'],
      ['GET', 'https://afscp.internal/internal/v1/workload-mount-bindings/wmb_file_library_1'],
      ['POST', 'https://afscp.internal/internal/v1/workload-mount-bindings/wmb_file_library_1:revoke'],
    ]);
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      mount_path: '/home/task_demo',
      read_only: false,
      lease_seconds: 3600,
    });
    expect(JSON.stringify(captured)).not.toContain('orchestrator-plan');
    for (const entry of captured) {
      expect(headersToRecord(entry.init.headers)).toMatchObject({
        Authorization: 'Bearer svc-secret-token',
        'X-AFSCP-Caller-Service': 'agentsmith-api',
        'X-AFSCP-Namespace-Id': 'ns_project_1',
      });
    }
  });

  it('calls save point, durable restore, and repo template APIs through the product namespace boundary', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      if (String(input).endsWith('/save-points') && init?.method === 'GET') {
        return createJsonResponse({
          save_points: [
            {
              save_point_id: 'sp_001',
              repo_id: 'repo_file_library_1',
              message: 'before restore',
              created_at: '2026-05-09T00:00:00.000Z',
            },
          ],
        });
      }
      return createJsonResponse({
        operation_id: 'op_file_library',
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_file_library_1' },
        result: null,
        error: null,
      }, 202);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await client.createSavePoint({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      message: 'before restore',
      correlationId: 'corr-save-point-create',
      idempotencyKey: 'idem-save-point-create',
      actor: { type: 'user', id: 'user_1' },
    });
    await expect(client.listSavePoints({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      correlationId: 'corr-save-point-list',
    })).resolves.toEqual({
      save_points: [
        {
          save_point_id: 'sp_001',
          repo_id: 'repo_file_library_1',
          message: 'before restore',
          created_at: '2026-05-09T00:00:00.000Z',
        },
      ],
    });
    await client.restoreRepo({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      savePointId: 'sp_001',
      correlationId: 'corr-restore',
      idempotencyKey: 'idem-restore',
      actor: { type: 'user', id: 'user_1' },
    });
    await client.createRepoTemplate({
      namespaceId: 'ns_project_1',
      sourceRepoId: 'repo_file_library_1',
      templateId: 'tmpl_template_1',
      correlationId: 'corr-template-create',
      idempotencyKey: 'idem-template-create',
      actor: { type: 'user', id: 'user_1' },
    });
    await client.cloneRepoTemplate({
      namespaceId: 'ns_project_1',
      templateId: 'tmpl_template_1',
      targetRepoId: 'repo_clone_1',
      correlationId: 'corr-template-clone',
      idempotencyKey: 'idem-template-clone',
      actor: { type: 'user', id: 'user_1' },
    });

    expect(captured.map((entry) => [entry.init.method, entry.url])).toEqual([
      ['POST', 'https://afscp.internal/internal/v1/repos/repo_file_library_1/save-points'],
      ['GET', 'https://afscp.internal/internal/v1/repos/repo_file_library_1/save-points'],
      ['POST', 'https://afscp.internal/internal/v1/repos/repo_file_library_1/restore'],
      ['POST', 'https://afscp.internal/internal/v1/repo-templates'],
      ['POST', 'https://afscp.internal/internal/v1/repo-templates/tmpl_template_1:clone'],
    ]);
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({ message: 'before restore' });
    expect(JSON.parse(String(captured[2]?.init.body))).toEqual({
      save_point_id: 'sp_001',
    });
    expect(JSON.parse(String(captured[3]?.init.body))).toEqual({
      namespace_id: 'ns_project_1',
      source_repo_id: 'repo_file_library_1',
      target_template_id: 'tmpl_template_1',
      clone_history_mode: 'main',
    });
    expect(JSON.parse(String(captured[4]?.init.body))).toEqual({
      namespace_id: 'ns_project_1',
      template_id: 'tmpl_template_1',
      target_repo_id: 'repo_clone_1',
    });
    for (const entry of captured) {
      expect(headersToRecord(entry.init.headers)).toMatchObject({
        Authorization: 'Bearer svc-secret-token',
        'X-AFSCP-Caller-Service': 'agentsmith-api',
        'X-AFSCP-Namespace-Id': 'ns_project_1',
      });
    }
  });

  it('uses bootstrap token for bootstrap namespace calls without falling back to the product token', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse(operationEnvelope);
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    await client.upsertNamespace({
      namespaceId: 'ns_project_1',
      caller: 'bootstrap',
      correlationId: 'corr-bootstrap-token',
      idempotencyKey: 'idem-bootstrap-token',
      actor: { type: 'user', id: 'user_1' },
    });

    expect(headersToRecord(captured[0]?.init.headers)).toMatchObject({
      Authorization: 'Bearer bootstrap-svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-bootstrap',
    });
    expect(JSON.stringify(captured[0]?.init.headers)).not.toContain('Bearer svc-secret-token');
  });

  it('rejects missing bootstrap token instead of falling back to the product token', () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    expect(() => new AfscpClient({
      baseUrl: 'https://afscp.internal/',
      callerService: 'agentsmith-api',
      bootstrapCallerService: 'agentsmith-bootstrap',
      serviceToken: 'svc-secret-token',
      bootstrapServiceToken: ' ',
    }, fetchMock)).toThrow(AfscpConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects matching product and bootstrap tokens at construction time', () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    expect(() => new AfscpClient({
      baseUrl: 'https://afscp.internal/',
      callerService: 'agentsmith-api',
      bootstrapCallerService: 'agentsmith-bootstrap',
      serviceToken: 'same-token',
      bootstrapServiceToken: 'same-token',
    }, fetchMock)).toThrow(AfscpConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a bootstrap-only adapter that does not expose caller selection to bootstrap services', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse(operationEnvelope);
    }) as unknown as typeof fetch;

    const client = new AfscpBootstrapClient(createClient(fetchMock));
    await client.upsertNamespace({
      namespaceId: 'ns_project_1',
      correlationId: 'corr-bootstrap-adapter',
      idempotencyKey: 'idem-bootstrap-adapter',
      actor: { type: 'admin_job', id: 'project-storage-bootstrap' },
    });

    expect(headersToRecord(captured[0]?.init.headers)).toMatchObject({
      Authorization: 'Bearer bootstrap-svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-bootstrap',
    });
  });

  it('offers a namespace binding runtime check through the product namespace boundary', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse({ repos: [] });
    }) as unknown as typeof fetch;

    const client = new AfscpBootstrapClient(createClient(fetchMock));
    await client.checkNamespaceVolumeBinding({
      namespaceId: 'ns_project_1',
      correlationId: 'corr-bootstrap-runtime-check',
    });

    const headers = headersToRecord(captured[0]?.init.headers);
    expect(captured[0]?.url).toBe('https://afscp.internal/internal/v1/repos?namespace_id=ns_project_1');
    expect(captured[0]?.init.method).toBe('GET');
    expect(headers).toMatchObject({
      Authorization: 'Bearer svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-api',
      'X-AFSCP-Namespace-Id': 'ns_project_1',
      'X-Correlation-Id': 'corr-bootstrap-runtime-check',
    });
    expect(headers).not.toHaveProperty('Idempotency-Key');
    expect(headers).not.toHaveProperty('X-AFSCP-Actor-Type');
    expect(headers).not.toHaveProperty('X-AFSCP-Actor-Id');
  });

  it('offers a runtime product-only adapter without bootstrap methods or caller override', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse({
        operation_id: 'op_repo_create',
        operation_state: 'queued',
        resource: { type: 'repo', id: 'repo_file_library_1' },
        result: null,
        error: null,
      }, 202);
    }) as unknown as typeof fetch;

    const productClient = new AfscpProductClient(createClient(fetchMock));
    expect(readRuntimeProperty(productClient, 'upsertNamespace')).toBeUndefined();
    expect(readRuntimeProperty(productClient, 'putNamespaceVolumeBinding')).toBeUndefined();
    expect(readRuntimeProperty(productClient, 'getOrchestratorMountPlan')).toBeUndefined();

    const injectedCallerInput = {
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      correlationId: 'corr-product-boundary',
      idempotencyKey: 'idem-product-boundary',
      actor: { type: 'user', id: 'user_1' },
      caller: 'bootstrap',
    } as unknown as Omit<CreateRepoInput, 'caller'>;
    await productClient.createRepo(injectedCallerInput);

    expect(headersToRecord(captured[0]?.init.headers)).toMatchObject({
      Authorization: 'Bearer svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-api',
    });
    expect(JSON.stringify(captured[0]?.init.headers)).not.toContain('bootstrap-svc-secret-token');
  });

  it('keeps product workload mount calls on the product caller even when caller is injected', async () => {
    const captured: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return createJsonResponse({
        operation_id: 'op_workload_mount_create',
        operation_state: 'queued',
        resource: { type: 'workload_mount_binding', id: 'wmb_file_library_1' },
        result: null,
        error: null,
      }, 202);
    }) as unknown as typeof fetch;

    const productClient = new AfscpProductClient(createClient(fetchMock));
    const injectedCallerInput = {
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mountPath: '/home/task_demo',
      readOnly: false,
      leaseSeconds: 3600,
      correlationId: 'corr-product-mount-boundary',
      idempotencyKey: 'idem-product-mount-boundary',
      actor: { type: 'user', id: 'user_1' },
      caller: 'bootstrap',
    } as unknown as Omit<CreateWorkloadMountBindingInput, 'caller'>;
    await productClient.createWorkloadMountBinding(injectedCallerInput);

    expect(headersToRecord(captured[0]?.init.headers)).toMatchObject({
      Authorization: 'Bearer svc-secret-token',
      'X-AFSCP-Caller-Service': 'agentsmith-api',
    });
    expect(JSON.stringify(captured[0]?.init.headers)).not.toContain('bootstrap-svc-secret-token');
  });

  it('throws sanitized errors for unsafe correlation ids before fetch', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.getOperation({
        operationId: 'op_123',
        correlationId: 'raw\r\nx-token=attacker-request-secret',
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
      correlation_id: 'afscp-request',
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('attacker-request-secret');
  });

  it('throws sanitized errors for unsafe namespace ids before fetch', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.getNamespaceVolumeBinding({
        namespaceId: 'ns_project_1\r\nx-token=attacker-request-secret',
        correlationId: 'corr-namespace-validation',
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
      correlation_id: 'corr-namespace-validation',
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('attacker-request-secret');
  });

  it('throws sanitized errors for unsafe actor values before fetch', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.upsertNamespace({
        namespaceId: 'ns_project_1',
        caller: 'bootstrap',
        correlationId: 'corr-actor-validation',
        idempotencyKey: 'idem-actor-validation',
        actor: { type: 'user', id: 'user_1\r\nx-token=attacker-request-secret' },
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
      correlation_id: 'corr-actor-validation',
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('attacker-request-secret');
  });

  it('throws sanitized errors for unsafe actor types before fetch', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.upsertNamespace({
        namespaceId: 'ns_project_1',
        caller: 'bootstrap',
        correlationId: 'corr-actor-type-validation',
        idempotencyKey: 'idem-actor-type-validation',
        actor: { type: 'user\r\nx-token=attacker-request-secret' as never, id: 'user_1' },
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
      correlation_id: 'corr-actor-type-validation',
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('attacker-request-secret');
  });

  it('throws sanitized errors for unsafe idempotency keys before fetch', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(operationEnvelope)) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.upsertNamespace({
        namespaceId: 'ns_project_1',
        caller: 'bootstrap',
        correlationId: 'corr-idempotency-validation',
        idempotencyKey: 'idem-1\r\nx-token=attacker-request-secret',
        actor: { type: 'user', id: 'user_1' },
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'afscp_error',
      retryable: false,
      correlation_id: 'corr-idempotency-validation',
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('attacker-request-secret');
  });

  it('throws sanitized AFSCP errors without raw details or token values', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({
      error: {
        code: 'RESOURCE_NAMESPACE_MISMATCH',
        message: 'repo_hidden_elsewhere in ns_other token=svc-secret-token',
        retryable: false,
        correlation_id: 'corr-error',
        operation_id: 'op_123',
        details: {
          resource: { type: 'repo', id: 'repo_hidden_elsewhere' },
          SecretRef: 'storage-root',
          mount_plan: { password: 'super-secret' },
          metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          jvs_stdout: 'jvs stdout leaked',
        },
      },
    }, 403)) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.getOperation({
        operationId: 'op_123',
        correlationId: 'corr-request',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 404,
      code: 'afscp_resource_not_found',
      retryable: false,
      correlation_id: 'corr-error',
      operation_id: 'op_123',
      resource_kind: 'repo',
    });
    const serialized = `${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`;
    expect(serialized).not.toContain('svc-secret-token');
    expect(serialized).not.toContain('repo_hidden_elsewhere');
    expect(serialized).not.toContain('SecretRef');
    expect(serialized).not.toContain('mount_plan');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('metadata_url');
    expect(serialized).not.toContain('jvs stdout leaked');
  });

  it('maps network failures to sanitized unavailable errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connect failed token=svc-secret-token password=super-secret');
    }) as unknown as typeof fetch;

    const client = createClient(fetchMock);
    let caught: unknown;
    try {
      await client.getOperation({
        operationId: 'op_123',
        correlationId: 'corr-network',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpClientError);
    expect(caught).toMatchObject({
      status: 503,
      code: 'unavailable',
      retryable: true,
      correlation_id: 'corr-network',
    });
    const serialized = `${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`;
    expect(serialized).not.toContain('svc-secret-token');
    expect(serialized).not.toContain('password=super-secret');
  });
});
