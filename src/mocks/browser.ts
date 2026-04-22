import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import type { SetupWorker } from 'msw/browser';

let worker: SetupWorker | null = null;
let startPromise: Promise<void> | null = null;
let startCompleted = false;
const SERVICE_WORKER_LIVENESS_TIMEOUT_MS = 5_000;

type MSWBootstrapErrorCode =
  | 'bootstrap_failed'
  | 'service_worker_ready_timeout'
  | 'service_worker_takeover_timeout';

class MSWBootstrapError extends Error {
  readonly code: MSWBootstrapErrorCode;

  constructor(code: MSWBootstrapErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MSWBootstrapError';
    this.code = code;
  }
}

export function resetMSWForTests() {
  worker = null;
  startPromise = null;
  startCompleted = false;
}

function toBootstrapError(error: unknown): MSWBootstrapError {
  if (error instanceof MSWBootstrapError) {
    return error;
  }

  if (error instanceof Error) {
    return new MSWBootstrapError('bootstrap_failed', error.message, error);
  }

  return new MSWBootstrapError('bootstrap_failed', 'Failed to bootstrap MSW in the browser', error);
}

function createTakeoverTimeoutError(timeoutMs: number) {
  return new MSWBootstrapError(
    'service_worker_takeover_timeout',
    `Service worker did not take control within ${timeoutMs}ms.`,
  );
}

function createReadyTimeoutError(timeoutMs: number) {
  return new MSWBootstrapError(
    'service_worker_ready_timeout',
    `Service worker did not become ready within ${timeoutMs}ms.`,
  );
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createTimeoutError: (timeoutMs: number) => MSWBootstrapError,
) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(createTimeoutError(timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function waitForServiceWorkerReady(timeoutMs = SERVICE_WORKER_LIVENESS_TIMEOUT_MS) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const { serviceWorker } = navigator;
    await waitWithTimeout(serviceWorker.ready, timeoutMs, createReadyTimeoutError);
    if (serviceWorker.controller) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = (handler: () => void, timeoutId: number) => {
        window.clearTimeout(timeoutId);
        serviceWorker.removeEventListener('controllerchange', handler);
      };

      const onControllerChange = () => {
        if (!serviceWorker.controller) {
          return;
        }
        cleanup(onControllerChange, timeoutId);
        resolve();
      };

      const timeoutId = window.setTimeout(() => {
        cleanup(onControllerChange, timeoutId);
        reject(createTakeoverTimeoutError(timeoutMs));
      }, timeoutMs);

      serviceWorker.addEventListener('controllerchange', onControllerChange);
    });
  } catch (error) {
    throw toBootstrapError(error);
  }
}

export async function initMSW() {
  const useMsw = getPublicRuntimeConfig().useMsw;
  const hasServiceWorkerSupport = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (!useMsw || typeof window === 'undefined' || !hasServiceWorkerSupport || startCompleted) {
    return;
  }

  if (startPromise) {
    return startPromise;
  }

  const pendingStart = (async () => {
    try {
      if (!worker) {
        const [{ setupWorker }, { handlers }] = await Promise.all([
          import('msw/browser'),
          import('./index'),
        ]);
        worker = setupWorker(...handlers);
      }

      await worker.start({ onUnhandledRequest: 'bypass' });
      await waitForServiceWorkerReady();
      startCompleted = true;
    } catch (error) {
      throw toBootstrapError(error);
    }
  })();

  startPromise = pendingStart;

  try {
    await pendingStart;
  } finally {
    if (startPromise === pendingStart) {
      startPromise = null;
    }
  }
}
