import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { start, setupWorker, getPublicRuntimeConfig } = vi.hoisted(() => {
  const startMock = vi.fn();
  const setupWorkerMock = vi.fn(() => ({ start: startMock }));
  const getPublicRuntimeConfigMock = vi.fn(() => ({ useMsw: true }));
  return {
    start: startMock,
    setupWorker: setupWorkerMock,
    getPublicRuntimeConfig: getPublicRuntimeConfigMock,
  };
});

vi.mock('msw/browser', () => ({
  setupWorker,
}));

vi.mock('../src/mocks/index', () => ({
  handlers: [],
}));

vi.mock('@/lib/public-runtime-config', () => ({
  getPublicRuntimeConfig,
}));

import { initMSW, resetMSWForTests } from '../src/mocks/browser';

async function promiseStateWithinTick(promise: Promise<void>) {
  return Promise.race([
    promise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => {
      setTimeout(() => resolve('pending'), 0);
    }),
  ]);
}

describe('initMSW', () => {
  beforeEach(() => {
    start.mockReset();
    start.mockResolvedValue(undefined);
    setupWorker.mockClear();
    getPublicRuntimeConfig.mockReset();
    getPublicRuntimeConfig.mockReturnValue({ useMsw: true });
  });

  afterEach(() => {
    resetMSWForTests();
    vi.unstubAllGlobals();
  });

  it('reuses an in-flight worker start instead of resolving later calls early', async () => {
    let resolveStart!: () => void;
    start.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));

    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve(),
        controller: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const firstInitPromise = initMSW();

    await vi.waitFor(() => {
      expect(setupWorker).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
    });

    const secondInitPromise = initMSW();
    await expect(promiseStateWithinTick(firstInitPromise)).resolves.toBe('pending');
    await expect(promiseStateWithinTick(secondInitPromise)).resolves.toBe('pending');

    resolveStart();
    await Promise.all([firstInitPromise, secondInitPromise]);
  });

  it('waits for serviceWorker.ready after the worker starts', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let controllerChangeHandler: (() => void) | null = null;
    const serviceWorker = {
      ready,
      controller: null as object | null,
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
    };

    vi.stubGlobal('navigator', {
      serviceWorker,
    });

    const firstInitPromise = initMSW();

    await vi.waitFor(() => {
      expect(setupWorker).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
    });

    const secondInitPromise = initMSW();
    await expect(promiseStateWithinTick(firstInitPromise)).resolves.toBe('pending');
    await expect(promiseStateWithinTick(secondInitPromise)).resolves.toBe('pending');

    resolveReady();
    await vi.waitFor(() => {
      expect(controllerChangeHandler).not.toBeNull();
    });
    await expect(promiseStateWithinTick(firstInitPromise)).resolves.toBe('pending');
    await expect(promiseStateWithinTick(secondInitPromise)).resolves.toBe('pending');

    serviceWorker.controller = {};
    controllerChangeHandler?.();
    await Promise.all([firstInitPromise, secondInitPromise]);
  });

  it('does not restart MSW after initialization completes successfully', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve(),
        controller: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    await initMSW();
    await initMSW();

    expect(setupWorker).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('clears failed starts so a later init can retry', async () => {
    const startError = new Error('start failed');
    start.mockRejectedValueOnce(startError).mockResolvedValueOnce(undefined);

    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve(),
        controller: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    await expect(initMSW()).rejects.toThrow(startError);
    await expect(initMSW()).resolves.toBeUndefined();

    expect(setupWorker).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
