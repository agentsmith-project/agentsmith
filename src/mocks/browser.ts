import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import type { SetupWorker } from 'msw/browser';

let worker: SetupWorker | null = null;
let started = false;

export async function initMSW() {
  const useMsw = getPublicRuntimeConfig().useMsw;
  const hasServiceWorkerSupport = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (!useMsw || typeof window === 'undefined' || !hasServiceWorkerSupport || started) {
    return;
  }

  if (!worker) {
    const [{ setupWorker }, { handlers }] = await Promise.all([
      import('msw/browser'),
      import('./index'),
    ]);
    worker = setupWorker(...handlers);
  }

  started = true;
  await worker.start({ onUnhandledRequest: 'bypass' });
}
