import { describe, expect, it, vi } from 'vitest';
import { retryAsbcpReadinessNotReady } from './asbcp-readiness-retry.js';

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('retryAsbcpReadinessNotReady', () => {
  it('returns a safe final error when ASBCP readiness retry exhausts the deadline', async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const rawDetail = 'raw pvc prod claim pending detail';
    const readinessError = Object.assign(new Error(rawDetail), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'ensure_workspace_binding',
      asbcpCode: 'not_ready',
      requestId: 'asbcp_req_deadline',
      retryAfterMs: 1_000,
    });
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });

    try {
      let caught: unknown;
      try {
        await retryAsbcpReadinessNotReady({
          operation: 'ensure_workspace_binding',
          deadline: 1_000,
          sleep,
          invoke: async () => {
            throw readinessError;
          },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).toMatchObject({
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        status: 503,
        operation: 'ensure_workspace_binding',
        asbcpCode: 'not_ready',
        retryable: true,
        requestId: 'asbcp_req_deadline',
        retryAfterMs: 1_000,
      });
      expect((caught as Error).message).toBe('asbcp_readiness_not_ready');
      expect((caught as Error).message).not.toContain(rawDetail);
      expect(JSON.stringify(caught)).not.toContain(rawDetail);
      expect((caught as Error & { cause?: unknown }).cause).toBe(readinessError);
      expect(Object.keys(caught as Record<string, unknown>)).not.toContain('cause');
      expect(sleep).toHaveBeenCalledWith(1_000);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('aborts while sleeping between ASBCP readiness attempts', async () => {
    const controller = new AbortController();
    const sleepDeferred = createDeferred();
    const sleep = vi.fn(() => sleepDeferred.promise);
    const result = retryAsbcpReadinessNotReady({
      operation: 'create_or_ensure_pod',
      deadline: Date.now() + 30_000,
      signal: controller.signal,
      sleep,
      invoke: async () => {
        throw Object.assign(new Error('raw pvc detail'), {
          code: 'AGENT_SANDBOX_UNAVAILABLE',
          status: 503,
          operation: 'create_or_ensure_pod',
          asbcpCode: 'not_ready',
          retryAfterMs: 1_000,
        });
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(sleep).toHaveBeenCalledTimes(1);

    controller.abort('cancelled_by_user');

    await expect(result).rejects.toMatchObject({
      name: 'AbortError',
      message: 'cancelled_by_user',
    });
    sleepDeferred.resolve();
  });
});
