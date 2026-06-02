import {
  isAsbcpReadinessNotReadyError,
  readAsbcpRetryAfterMs,
} from './asbcp-client.js';

export const DEFAULT_ASBCP_READINESS_RETRY_BUDGET_MS = 30_000;

const DEFAULT_ASBCP_READINESS_RETRY_DELAY_MS = 1_000;
const MIN_ASBCP_READINESS_RETRY_DELAY_MS = 100;
const MAX_ASBCP_READINESS_RETRY_DELAY_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringField(error: unknown, key: string): string | undefined {
  if (!isRecord(error)) return undefined;
  const value = error[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function buildAbortError(reason?: unknown): Error {
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : 'request_aborted',
  );
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw buildAbortError(signal.reason);
  }
}

function readinessRetryDelayMs(error: unknown, remainingMs: number): number {
  const requestedDelayMs = readAsbcpRetryAfterMs(error) ?? DEFAULT_ASBCP_READINESS_RETRY_DELAY_MS;
  const boundedDelayMs = Math.min(
    Math.max(requestedDelayMs, MIN_ASBCP_READINESS_RETRY_DELAY_MS),
    MAX_ASBCP_READINESS_RETRY_DELAY_MS,
  );
  return Math.min(remainingMs, boundedDelayMs);
}

async function sleepWithAbort(input: {
  sleep: (ms: number) => Promise<void>;
  delayMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAborted(input.signal);
  if (!input.signal) {
    await input.sleep(input.delayMs);
    return;
  }
  const signal = input.signal;
  await new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(buildAbortError(signal.reason));
    };
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    signal.addEventListener('abort', handleAbort, { once: true });
    void input.sleep(input.delayMs).then(
      () => {
        cleanup();
        resolve();
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
  throwIfAborted(signal);
}

function buildAsbcpReadinessNotReadyError(input: {
  operation: string;
  cause: unknown;
}): Error {
  const requestId = readStringField(input.cause, 'requestId')
    ?? readStringField(input.cause, 'request_id');
  const retryAfterMs = readAsbcpRetryAfterMs(input.cause);
  const error = Object.assign(new Error('asbcp_readiness_not_ready'), {
    code: 'AGENT_SANDBOX_UNAVAILABLE',
    status: 503,
    operation: input.operation,
    asbcpCode: 'not_ready',
    retryable: true,
    ...(requestId ? { requestId } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
  Object.defineProperty(error, 'cause', {
    value: input.cause,
    configurable: true,
    writable: true,
  });
  return error;
}

export async function retryAsbcpReadinessNotReady<T>(input: {
  operation: string;
  invoke: () => Promise<T>;
  deadline: number;
  signal?: AbortSignal;
  sleep: (ms: number) => Promise<void>;
}): Promise<T> {
  let lastReadinessError: unknown;
  for (;;) {
    throwIfAborted(input.signal);
    if (lastReadinessError !== undefined && Date.now() >= input.deadline) {
      throw buildAsbcpReadinessNotReadyError({
        operation: input.operation,
        cause: lastReadinessError,
      });
    }
    try {
      return await input.invoke();
    } catch (error) {
      throwIfAborted(input.signal);
      if (!isAsbcpReadinessNotReadyError(error)) {
        throw error;
      }
      lastReadinessError = error;
      const remainingMs = input.deadline - Date.now();
      if (remainingMs <= 0) {
        throw buildAsbcpReadinessNotReadyError({
          operation: input.operation,
          cause: lastReadinessError,
        });
      }
      await sleepWithAbort({
        sleep: input.sleep,
        delayMs: readinessRetryDelayMs(error, remainingMs),
        signal: input.signal,
      });
    }
  }
}
