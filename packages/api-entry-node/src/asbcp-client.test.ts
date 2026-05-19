import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsbcpClient, AsbcpHttpError } from './asbcp-client.js';

const originalFetch = globalThis.fetch;

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

  it('maps status 404 to offline phase', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    const status = await client.getPodStatus('ws_1', 'proj_1', 'workload_1');

    expect(status).toEqual({ phase: 'offline' });
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

  it('retries transient 503 and then succeeds', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
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

  it('treats delete workspace binding 404 as success', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const client = new AsbcpClient('http://sandbox:8080', 'svc-key');
    await expect(client.deleteWorkspaceBinding('ws_1', 'proj_1', 'flib_demo')).resolves.toBeUndefined();
  });
});
