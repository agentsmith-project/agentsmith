import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import type { SetupWorker } from 'msw/browser';

let worker: SetupWorker | null = null;
let startPromise: Promise<void> | null = null;
let startCompleted = false;

export function resetMSWForTests() {
  worker = null;
  startPromise = null;
  startCompleted = false;
}

async function waitForServiceWorkerReady() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const { serviceWorker } = navigator;
    await serviceWorker.ready;
    if (serviceWorker.controller) {
      return;
    }

    await new Promise<void>((resolve) => {
      const onControllerChange = () => {
        if (!serviceWorker.controller) {
          return;
        }
        serviceWorker.removeEventListener('controllerchange', onControllerChange);
        resolve();
      };

      serviceWorker.addEventListener('controllerchange', onControllerChange);
    });
  } catch {
    // If readiness cannot be observed, we still keep the existing mock bootstrap path.
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
  })();

  startPromise = pendingStart;

  try {
    await pendingStart;
  } catch (error) {
    if (startPromise === pendingStart) {
      startPromise = null;
    }
    throw error;
  }

  if (startPromise === pendingStart) {
    startPromise = null;
  }
}
