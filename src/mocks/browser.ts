/**
 * MSW Browser Setup
 *
 * Initialize MSW for browser environment
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

let worker: ReturnType<typeof setupWorker> | null = null;

export function initMSW() {
  if (typeof window !== 'undefined' && !worker) {
    worker = setupWorker(...handlers);
    return worker.start();
  }
  return Promise.resolve();
}

export { worker };
