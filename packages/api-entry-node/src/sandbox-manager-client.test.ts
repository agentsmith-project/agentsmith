import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxManagerClient } from './sandbox-manager-client.js';

const originalFetch = globalThis.fetch;

describe('SandboxManagerClient', () => {
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
      return new Response(JSON.stringify({ phase: 'Running', pod_name: 'pod-1' }), { status: 201 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SandboxManagerClient('http://sandbox:8080/', 'svc-key');
    const result = await client.createOrEnsurePod('ws_1', 'proj_1', 'workload_1', { image: 'runner:latest' });

    expect(result.httpStatus).toBe(201);
    expect(result.pod.phase).toBe('Running');
  });

  it('maps status 404 to offline phase', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const client = new SandboxManagerClient('http://sandbox:8080', 'svc-key');
    const status = await client.getPodStatus('ws_1', 'proj_1', 'workload_1');

    expect(status).toEqual({ phase: 'offline' });
  });

  it('throws sandbox_manager_error on exec http error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const client = new SandboxManagerClient('http://sandbox:8080', 'svc-key');
    await expect(client.exec('ws_1', 'proj_1', 'workload_1', ['bash', '-lc', 'echo 1'])).rejects.toThrow(
      'sandbox_manager_error: 500 boom',
    );
  });
});
