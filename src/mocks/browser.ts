import type { SetupWorker } from 'msw/browser';

let worker: SetupWorker | null = null;
let started = false;

export async function initMSW() {
  const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';
  if (!useMsw || typeof window === 'undefined' || started) {
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
