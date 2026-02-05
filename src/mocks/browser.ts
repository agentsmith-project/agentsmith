import { setupWorker } from 'msw/browser';
import { handlers } from './index';

export const worker = setupWorker(...handlers);

let started = false;

export function initMSW() {
  const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';
  if (!useMsw || typeof window === 'undefined' || started) {
    return Promise.resolve();
  }
  started = true;
  return worker.start({ onUnhandledRequest: 'bypass' });
}
