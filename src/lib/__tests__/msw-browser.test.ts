import { afterEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createServiceWorkerMock(args?: {
  ready?: Promise<unknown>;
  controller?: object | null;
}) {
  const eventTarget = new EventTarget();
  let controller = args && 'controller' in args
    ? (args.controller ?? null)
    : ({ state: 'activated' } as object);

  return {
    ready: args?.ready ?? Promise.resolve(undefined),
    get controller() {
      return controller;
    },
    setController(nextController: object | null) {
      controller = nextController;
      eventTarget.dispatchEvent(new Event('controllerchange'));
    },
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  };
}

function installServiceWorkerMock(serviceWorker: unknown) {
  const navigatorObject = window.navigator as Navigator & Record<string, unknown>;
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigatorObject, 'serviceWorker');

  Object.defineProperty(navigatorObject, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(navigatorObject, 'serviceWorker', originalDescriptor);
      return;
    }
    Reflect.deleteProperty(navigatorObject, 'serviceWorker');
  };
}

async function flushMicrotasks(count = 3) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function loadBrowserModule(args?: {
  startMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  const startMock = args?.startMock ?? vi.fn().mockResolvedValue(undefined);
  const setupWorkerMock = vi.fn(() => ({ start: startMock }));

  vi.doMock('msw/browser', () => ({
    setupWorker: setupWorkerMock,
  }));
  vi.doMock('@/lib/public-runtime-config', () => ({
    getPublicRuntimeConfig: () => ({ useMsw: true }),
  }));
  vi.doMock('@/mocks/index', () => ({
    handlers: [],
  }));

  const mod = await import('@/mocks/browser');
  mod.resetMSWForTests();

  return { mod, setupWorkerMock, startMock };
}

let restoreServiceWorker: (() => void) | null = null;

describe('msw browser init', () => {
  afterEach(() => {
    restoreServiceWorker?.();
    restoreServiceWorker = null;
    delete window.__MBOS_PUBLIC_RUNTIME_CONFIG__;
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does not throw when imported in non-browser environments', async () => {
    const mod = await import('@/mocks/browser');
    await expect(mod.initMSW()).resolves.toBeUndefined();
  });

  it('waits for the in-flight worker start and service-worker control before treating MSW as started', async () => {
    const startDeferred = createDeferred<void>();
    const readyDeferred = createDeferred<void>();
    const serviceWorker = createServiceWorkerMock({
      ready: readyDeferred.promise,
      controller: null,
    });
    restoreServiceWorker = installServiceWorkerMock(serviceWorker);

    const startMock = vi.fn(() => startDeferred.promise);
    const { mod, setupWorkerMock } = await loadBrowserModule({ startMock });

    const firstInit = mod.initMSW();

    await vi.waitFor(() => {
      expect(setupWorkerMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledTimes(1);
    });

    const secondInit = mod.initMSW();

    let firstSettled = false;
    let secondSettled = false;
    void firstInit.finally(() => {
      firstSettled = true;
    });
    void secondInit.finally(() => {
      secondSettled = true;
    });

    await flushMicrotasks();

    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    startDeferred.resolve();
    await flushMicrotasks();

    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    readyDeferred.resolve();
    await flushMicrotasks();

    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    serviceWorker.setController({ state: 'activated' });

    await expect(Promise.all([firstInit, secondInit])).resolves.toEqual([undefined, undefined]);
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);

    await expect(mod.initMSW()).resolves.toBeUndefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('allows a later call to retry when worker.start fails', async () => {
    const serviceWorker = createServiceWorkerMock();
    restoreServiceWorker = installServiceWorkerMock(serviceWorker);

    const startError = new Error('worker_start_failed');
    const startMock = vi.fn()
      .mockRejectedValueOnce(startError)
      .mockResolvedValueOnce(undefined);
    const { mod, setupWorkerMock } = await loadBrowserModule({ startMock });

    await expect(mod.initMSW()).rejects.toThrow('worker_start_failed');
    expect(setupWorkerMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);

    await expect(mod.initMSW()).resolves.toBeUndefined();
    expect(setupWorkerMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(2);
  });

  it('fails with an explicit timeout error when the service worker never takes control', async () => {
    vi.useFakeTimers();

    const serviceWorker = createServiceWorkerMock({
      ready: Promise.resolve(undefined),
      controller: null,
    });
    restoreServiceWorker = installServiceWorkerMock(serviceWorker);

    const startMock = vi.fn().mockResolvedValue(undefined);
    const { mod } = await loadBrowserModule({ startMock });

    const initPromise = mod.initMSW();
    const initRejection = expect(initPromise).rejects.toMatchObject({
      code: 'service_worker_takeover_timeout',
    });

    await flushMicrotasks(5);

    await vi.advanceTimersByTimeAsync(5_000);
    await initRejection;
  });

  it('fails with an explicit timeout error when serviceWorker.ready never resolves', async () => {
    vi.useFakeTimers();

    const readyDeferred = createDeferred<void>();
    const serviceWorker = createServiceWorkerMock({
      ready: readyDeferred.promise,
      controller: null,
    });
    restoreServiceWorker = installServiceWorkerMock(serviceWorker);

    const startMock = vi.fn().mockResolvedValue(undefined);
    const { mod } = await loadBrowserModule({ startMock });

    const initPromise = mod.initMSW();
    const initRejection = expect(initPromise).rejects.toMatchObject({
      code: 'service_worker_ready_timeout',
    });

    await flushMicrotasks(5);

    await vi.advanceTimersByTimeAsync(5_000);
    await initRejection;
  });
});
