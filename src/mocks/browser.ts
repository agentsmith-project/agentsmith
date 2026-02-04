import { setupWorker } from 'msw/browser';
import { handlers } from './index';

export const worker = setupWorker(...handlers);

if (process.env.NEXT_PUBLIC_API_MOCK === 'true') {
  worker.start({ onUnhandledRequest: 'bypass' });
}
