import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AsbcpClient,
  AsbcpHttpError,
  isAsbcpReadinessNotReadyError,
  readAsbcpRetryAfterMs,
} from './asbcp-client.js';

const originalFetch = globalThis.fetch;
const RUNNER_DIGEST_A = `sha256:${'a'.repeat(64)}`;
const RUNNER_DIGEST_B = `sha256:${'b'.repeat(64)}`;
const RUNNER_DIGEST_C = `sha256:${'c'.repeat(64)}`;

describe('AsbcpClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('creates pod with service key header and returns status payload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://sandbox:8080/v1/workspaces/ws_1/projects/proj_1/workloads/workload_1');
      expect(init?.method).toBe('PUT');
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Service-Key']).toBe('svc-key');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        image: 'runner:latest',
        workspace_binding_id: 'flib_demo',
      });
      expect(body).not.toHaveProperty('mount_path');
      expect(body).not.toHaveProperty('sub_path');
      expect(body).not.toHaveProperty('working_dir');
      return new Response(JSON.stringify({ phase: 'Running', pod_name: 'pod-1' }), { status: 201 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080/', 'svc-key');
    const result = await client.createOrEnsurePod('ws_1', 'proj_1', 'workload_1', {
      image: 'runner:latest',
      workspace_binding_id: 'flib_demo',
    });

    expect(result.httpStatus).toBe(201);
    expect(result.pod.phase).toBe('Running');
  });

  it('normalizes ASBCP pod live image identity from image_id, imageID, and containerStatuses imageID', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        phase: 'Running',
        image: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`,
        image_id: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        phase: 'Running',
        image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
        imageID: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        phase: 'Running',
        containerStatuses: [
          {
            name: 'agentsmith-runner',
            image: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_C}`,
            imageID: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_C}`,
          },
        ],
      }), { status: 200 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');

    await expect(client.getPodStatus('ws_1', 'proj_1', 'workload_1')).resolves.toMatchObject({
      phase: 'Running',
      image: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`,
      image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`,
      image_id: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`,
    });
    await expect(client.getPodStatus('ws_1', 'proj_1', 'workload_1')).resolves.toMatchObject({
      phase: 'Running',
      image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
      image_id: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
    });
    await expect(client.getPodStatus('ws_1', 'proj_1', 'workload_1')).resolves.toMatchObject({
      phase: 'Running',
      image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_C}`,
      image_id: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_C}`,
    });
  });

  it('prefers a pod spec image ref over CRI status image when both are present', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      phase: 'Running',
      spec: {
        containers: [
          {
            name: 'runner',
            image: `kind-registry:5000/mbos/agentsmith-managed-runner:locked@${RUNNER_DIGEST_A}`,
          },
        ],
      },
      status: {
        containerStatuses: [
          {
            name: 'runner',
            image: `sha256:${'d'.repeat(64)}`,
            imageID: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
          },
        ],
      },
    }), { status: 200 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');

    await expect(client.getPodStatus('ws_1', 'proj_1', 'workload_1')).resolves.toMatchObject({
      phase: 'Running',
      image: `kind-registry:5000/mbos/agentsmith-managed-runner:locked@${RUNNER_DIGEST_A}`,
      image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner:locked@${RUNNER_DIGEST_A}`,
      image_id: `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
    });
  });

  it('prefers Kubernetes imageID over a bare CRI status image exposed as image_id', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      phase: 'Running',
      image: `kind-registry:5000/mbos/agentsmith-managed-runner:locked@${RUNNER_DIGEST_A}`,
      image_id: `sha256:${'d'.repeat(64)}`,
      status: {
        containerStatuses: [
          {
            name: 'runner',
            image: `sha256:${'d'.repeat(64)}`,
            imageID: `ghcr.io/agentsmith-project/agentsmith-runner@${RUNNER_DIGEST_A}`,
          },
        ],
      },
    }), { status: 200 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');

    await expect(client.getPodStatus('ws_1', 'proj_1', 'workload_1')).resolves.toMatchObject({
      phase: 'Running',
      image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner:locked@${RUNNER_DIGEST_A}`,
      image_id: `ghcr.io/agentsmith-project/agentsmith-runner@${RUNNER_DIGEST_A}`,
    });
  });

  it('does not promote container status image into live imageID identity', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      phase: 'Running',
      status: {
        containerStatuses: [
          {
            name: 'runner',
            image: `sha256:${'d'.repeat(64)}`,
          },
        ],
      },
    }), { status: 200 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const status = await client.getPodStatus('ws_1', 'proj_1', 'workload_1');

    expect(status).toMatchObject({
      phase: 'Running',
      image_ref: `sha256:${'d'.repeat(64)}`,
    });
    expect(status).not.toHaveProperty('image_id');
  });

  it('accepts async ensure metadata without requiring PUT to return a Running pod', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      workload_id: 'workload_1',
      status: 'accepted',
      correlation_id: 'corr_1',
      operation_id: 'op_1',
    }), { status: 202 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const result = await client.createOrEnsurePod('ws_1', 'proj_1', 'workload_1', {
      image: 'runner:latest',
      workspace_binding_id: 'flib_demo',
    });

    expect(result).toMatchObject({
      httpStatus: 202,
      workloadId: 'workload_1',
      status: 'accepted',
      correlationId: 'corr_1',
      operationId: 'op_1',
    });
    expect(result.pod).toBeUndefined();
  });

  it('maps status 404 to offline current status without treating it as delete terminal confirmation', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const status = await client.getPodStatus('ws_1', 'proj_1', 'workload_1');

    expect(status).toEqual({
      phase: 'offline',
      message: 'pod_not_found_current_status',
      status_source: 'current_status',
      delete_terminal_confirmed: false,
    });
  });

  it('throws asbcp_error on exec http error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    await expect(client.exec('ws_1', 'proj_1', 'workload_1', ['bash', '-lc', 'echo 1'])).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
    });
  });

  it('checks readyz with service key header', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://sandbox:8080/readyz');
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Service-Key']).toBe('svc-key');
      return new Response('ok', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080/', 'svc-key');
    await expect(client.checkReady()).resolves.toBeUndefined();
  });

  it('retries transient 502 and then succeeds', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ phase: 'Running' }), { status: 200 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const status = await client.getPodStatus('ws_1', 'proj_1', 'workload_1');
    expect(status.phase).toBe('Running');
  });

  it('maps 403 to AGENT_SANDBOX_FORBIDDEN', async () => {
    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const request = client.keepalive('ws_1', 'proj_1', 'workload_1');
    await expect(request).rejects.toBeInstanceOf(AsbcpHttpError);
    await expect(request).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_FORBIDDEN',
      status: 403,
    });
  });

  it('redacts sensitive ASBCP response fields from http error messages', async () => {
    const rawToken = 'sk_live_sensitive_token';
    const rawPassword = 'plain-password-value';
    const rawApiKey = 'api-key-value';
    const responseText = `${JSON.stringify({
      error: 'upstream rejected credentials',
      token: rawToken,
      password: rawPassword,
    })} API key: ${rawApiKey}`;
    globalThis.fetch = vi.fn(async () => new Response(responseText, { status: 500 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');

    let caught: unknown;
    try {
      await client.keepalive('ws_1', 'proj_1', 'workload_1');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 500,
      operation: 'keepalive',
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(rawToken);
    expect((caught as Error).message).not.toContain(rawPassword);
    expect((caught as Error).message).not.toContain(rawApiKey);
    expect((caught as Error).message).toContain('[redacted]');
  });

  it('redacts ASBCP service key lists and object-shaped service key values from errors', async () => {
    const rawServiceKeys = 'raw-asbcp-service-keys-token';
    const rawNestedServiceKey = 'raw-object-shaped-service-key';
    const responseText = [
      `ASBCP_SERVICE_KEYS=${rawServiceKeys}`,
      JSON.stringify({
        service_key: {
          value: rawNestedServiceKey,
        },
      }),
    ].join(' ');
    globalThis.fetch = vi.fn(async () => new Response(responseText, { status: 500 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');

    let caught: unknown;
    try {
      await client.keepalive('ws_1', 'proj_1', 'workload_1');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(rawServiceKeys);
    expect((caught as Error).message).not.toContain(rawNestedServiceKey);
    expect((caught as Error).message).toContain('[redacted]');
  });

  it('ensures workspace binding through the binding endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://sandbox:8080/v1/workspaces/ws_1/projects/proj_1/workspace-bindings/wmb_demo');
      expect(init?.method).toBe('PUT');
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Service-Key']).toBe('svc-key');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_demo',
      });
      expect(JSON.stringify(body)).not.toMatch(
        /destination|task_home_path|workspace_path|artifacts_path|mount_path|working_dir|sub_path|metadata_url|storage_endpoint|storage_bucket_url|filesystem_name|juicefs|secret|access_key/i,
      );
      return new Response(JSON.stringify({
        binding_id: 'wmb_demo',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_demo',
        status: 'ready',
      }), { status: 201 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const result = await client.ensureWorkspaceBinding('ws_1', 'proj_1', 'wmb_demo', {
      namespace_id: 'ns_project_1',
      mount_binding_id: 'wmb_demo',
    });

    expect(result.binding_id).toBe('wmb_demo');
    expect(result.namespace_id).toBe('ns_project_1');
    expect(result.mount_binding_id).toBe('wmb_demo');
  });

  it('preserves ASBCP readiness not_ready retry metadata from Retry-After without client-side response retry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'not_ready',
        message: 'workspace binding PVC is still Pending',
        request_id: 'asbcp_req_binding_not_ready',
      },
    }), {
      status: 503,
      headers: {
        'Retry-After': '1',
      },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    let caught: unknown;
    try {
      await client.ensureWorkspaceBinding('ws_1', 'proj_1', 'wmb_demo', {
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_demo',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'ensure_workspace_binding',
      asbcpCode: 'not_ready',
      retryable: true,
      requestId: 'asbcp_req_binding_not_ready',
      retryAfterMs: 1_000,
    });
    expect(isAsbcpReadinessNotReadyError(caught)).toBe(true);
    expect(readAsbcpRetryAfterMs(caught)).toBe(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast and sanitizes ASBCP not_ready when the body explicitly marks it non-retryable', async () => {
    const rawDetail = 'pvc-prod-raw-claim is permanently invalid';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'not_ready',
        message: rawDetail,
        request_id: 'asbcp_req_binding_not_retryable',
        retryable: false,
      },
    }), {
      status: 503,
      headers: {
        'Retry-After': '2',
      },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    let caught: unknown;
    try {
      await client.ensureWorkspaceBinding('ws_1', 'proj_1', 'wmb_demo', {
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_demo',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'ensure_workspace_binding',
      asbcpCode: 'not_ready',
      retryable: false,
      asbcpRetryable: false,
      requestId: 'asbcp_req_binding_not_retryable',
      retryAfterMs: 2_000,
    });
    expect(isAsbcpReadinessNotReadyError(caught)).toBe(false);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('asbcp_readiness_not_ready');
    expect((caught as Error).message).not.toContain(rawDetail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast for non-readiness ASBCP 503 responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'sandbox_capacity_unavailable',
        message: 'capacity temporarily unavailable',
        request_id: 'asbcp_req_capacity_503',
      },
    }), { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    let caught: unknown;
    try {
      await client.ensureWorkspaceBinding('ws_1', 'proj_1', 'wmb_demo', {
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_demo',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'ensure_workspace_binding',
      asbcpCode: 'sandbox_capacity_unavailable',
      requestId: 'asbcp_req_capacity_503',
    });
    expect(isAsbcpReadinessNotReadyError(caught)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a distinguishable error for delete workspace binding 404 instead of treating it as success', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    await expect(client.deleteWorkspaceBinding('ws_1', 'proj_1', 'flib_demo')).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_FOUND',
      status: 404,
      operation: 'delete_workspace_binding',
    });
  });

  it('returns a distinguishable error for delete pod 404 instead of treating it as release success', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    await expect(client.deletePod('ws_1', 'proj_1', 'workload_1')).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_FOUND',
      status: 404,
      operation: 'delete_pod',
    });
  });

  it('maps delete pod 409 by stable ASBCP release-incomplete code', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'workload_release_incomplete',
        message: 'delete is waiting for durable ASBCP terminal truth',
        request_id: 'asbcp_req_delete_409',
      },
    }), {
      status: 409,
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    let caught: unknown;
    try {
      await client.deletePod('ws_1', 'proj_1', 'workload_1');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      asbcpCode: 'workload_release_incomplete',
      status: 409,
      operation: 'delete_pod',
      retryable: true,
      requestId: 'asbcp_req_delete_409',
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('delete is waiting for durable ASBCP terminal truth');
    expect((caught as Error).message).toContain('asbcp_req_delete_409');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps delete workspace binding 409 by stable ASBCP release-incomplete code', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'workspace_binding_release_incomplete',
        message: 'workspace binding delete is waiting for safe workload closure proof',
        request_id: 'asbcp_req_binding_release_409',
      },
    }), { status: 409 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    await expect(client.deleteWorkspaceBinding('ws_1', 'proj_1', 'flib_demo')).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      asbcpCode: 'workspace_binding_release_incomplete',
      status: 409,
      operation: 'delete_workspace_binding',
      retryable: true,
      requestId: 'asbcp_req_binding_release_409',
    });
  });

  it('keeps same-round top-level ASBCP release-incomplete code compatibility', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      code: 'workload_release_incomplete',
      message: 'delete is waiting for durable ASBCP terminal truth',
      request_id: 'asbcp_req_top_level_release_409',
    }), { status: 409 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    await expect(client.deletePod('ws_1', 'proj_1', 'workload_1')).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      asbcpCode: 'workload_release_incomplete',
      status: 409,
      operation: 'delete_pod',
      retryable: true,
      requestId: 'asbcp_req_top_level_release_409',
    });
  });

  it('does not map release-looking messages without a stable ASBCP code to release pending', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'conflict',
        message: 'release terminal fact missing',
        request_id: 'asbcp_req_generic_conflict',
      },
    }), { status: 409 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    let caught: unknown;
    try {
      await client.deletePod('ws_1', 'proj_1', 'workload_1');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_CONFLICT',
      status: 409,
      operation: 'delete_pod',
      retryable: false,
      requestId: 'asbcp_req_generic_conflict',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not map non-release ASBCP 409 codes to release pending', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'workspace_binding_active_workloads',
        message: 'workspace binding has active workloads; delete workloads first',
        request_id: 'asbcp_req_binding_active_workloads',
      },
    }), { status: 409 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    let caught: unknown;
    try {
      await client.deleteWorkspaceBinding('ws_1', 'proj_1', 'flib_demo');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AsbcpHttpError);
    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_CONFLICT',
      status: 409,
      operation: 'delete_workspace_binding',
      retryable: false,
      requestId: 'asbcp_req_binding_active_workloads',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
