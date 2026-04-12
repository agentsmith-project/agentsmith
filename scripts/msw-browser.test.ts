import { afterEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn().mockResolvedValue(undefined);
const setupWorker = vi.fn(() => ({ start }));

vi.mock('msw/browser', () => ({
  setupWorker,
}));

vi.mock('../src/mocks/index', () => ({
  handlers: [],
}));

vi.mock('@/lib/public-runtime-config', () => ({
  getPublicRuntimeConfig: vi.fn(() => ({ useMsw: true })),
}));

import { initMSW, resetMSWForTests } from '../src/mocks/browser';

describe('initMSW', () => {
  afterEach(() => {
    resetMSWForTests();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('waits for serviceWorker.ready after the worker starts', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let controllerChangeHandler: (() => void) | null = null;

    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready,
        controller: null,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'controllerchange') {
            controllerChangeHandler = handler;
          }
        }),
        removeEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'controllerchange' && controllerChangeHandler === handler) {
            controllerChangeHandler = null;
          }
        }),
      },
    });

    const initPromise = initMSW();

    await vi.waitFor(() => {
      expect(setupWorker).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
    });

    let settled = false;
    initPromise.then(() => {
      settled = true;
    });

    expect(settled).toBe(false);
    resolveReady();
    await Promise.resolve();
    expect(settled).toBe(false);
    controllerChangeHandler?.();
    await initPromise;
    expect(settled).toBe(true);
  });
});
