import type http from 'node:http';

type DownstreamAbortControllerOptions = {
  req?: http.IncomingMessage;
  res?: http.ServerResponse;
  parentSignal?: AbortSignal;
  timeoutMs?: number;
  timeoutMessage?: string;
  requestAbortedMessage?: string;
  requestClosedMessage?: string;
  responseClosedMessage?: string;
  parentAbortMessage?: string;
};

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function normalizeAbortReason(reason: unknown, fallback: string): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  if (reason instanceof Error) {
    const error = createAbortError(reason.message || fallback);
    (error as Error & { cause?: unknown }).cause = reason;
    return error;
  }
  if (typeof reason === 'string' && reason.trim()) {
    return createAbortError(reason);
  }
  return createAbortError(fallback);
}

export function throwIfAborted(signal: AbortSignal | undefined, fallback: string): void {
  if (!signal?.aborted) {
    return;
  }
  throw normalizeAbortReason(signal.reason, fallback);
}

export function createDownstreamAbortController(
  options: DownstreamAbortControllerOptions,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const request = options.req as (
    http.IncomingMessage & {
      destroyed?: boolean;
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    }
  ) | undefined;
  const requestSocket = request?.socket as (
    {
      destroyed?: boolean;
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    }
  ) | undefined;
  const response = options.res as (
    http.ServerResponse & {
      destroyed?: boolean;
      writableDestroyed?: boolean;
      writableFinished?: boolean;
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    }
  ) | undefined;
  const responseSocket = response?.socket as (
    {
      destroyed?: boolean;
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    }
  ) | undefined;
  let cleanedUp = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const responseHasFinished = () => Boolean(response?.writableEnded || response?.writableFinished);
  const requestCloseAbortReason = () => {
    if (request?.aborted) {
      return createAbortError(options.requestAbortedMessage ?? 'client_request_aborted');
    }
    if (request?.complete === false) {
      return createAbortError(options.requestClosedMessage ?? 'client_request_closed');
    }
    return null;
  };

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
    request?.removeListener?.('aborted', handleRequestAborted);
    request?.removeListener?.('close', handleRequestClose);
    requestSocket?.removeListener?.('close', handleRequestSocketClose);
    response?.removeListener?.('close', handleResponseClose);
    response?.removeListener?.('finish', handleResponseFinish);
    responseSocket?.removeListener?.('close', handleResponseSocketClose);
    options.parentSignal?.removeEventListener('abort', handleParentAbort);
  };

  const abortWithReason = (reason: unknown) => {
    if (controller.signal.aborted) {
      cleanup();
      return;
    }
    controller.abort(normalizeAbortReason(reason, 'downstream_request_aborted'));
    cleanup();
  };

  const handleRequestAborted = () => {
    abortWithReason(createAbortError(options.requestAbortedMessage ?? 'client_request_aborted'));
  };
  const handleRequestClose = () => {
    if (responseHasFinished()) {
      cleanup();
      return;
    }
    const abortReason = requestCloseAbortReason();
    if (!abortReason) {
      return;
    }
    abortWithReason(abortReason);
  };
  const handleRequestSocketClose = () => {
    if (responseHasFinished()) {
      cleanup();
      return;
    }
    abortWithReason(createAbortError(options.requestClosedMessage ?? 'client_request_closed'));
  };
  const handleResponseClose = () => {
    if (responseHasFinished()) {
      cleanup();
      return;
    }
    abortWithReason(createAbortError(options.responseClosedMessage ?? 'client_response_closed'));
  };
  const handleResponseSocketClose = () => {
    if (responseHasFinished()) {
      cleanup();
      return;
    }
    abortWithReason(createAbortError(options.responseClosedMessage ?? 'client_response_closed'));
  };
  const handleResponseFinish = () => {
    cleanup();
  };
  const handleParentAbort = () => {
    abortWithReason(normalizeAbortReason(options.parentSignal?.reason, options.parentAbortMessage ?? 'parent_signal_aborted'));
  };

  const earlyAbortReason = (() => {
    if (options.parentSignal?.aborted) {
      return normalizeAbortReason(options.parentSignal.reason, options.parentAbortMessage ?? 'parent_signal_aborted');
    }
    if (request?.aborted) {
      return createAbortError(options.requestAbortedMessage ?? 'client_request_aborted');
    }
    if (request?.destroyed && request.complete === false) {
      return createAbortError(options.requestClosedMessage ?? 'client_request_closed');
    }
    if ((requestSocket?.destroyed || responseSocket?.destroyed) && !responseHasFinished()) {
      return createAbortError(options.responseClosedMessage ?? 'client_response_closed');
    }
    if ((response?.destroyed || response?.writableDestroyed) && !responseHasFinished()) {
      return createAbortError(options.responseClosedMessage ?? 'client_response_closed');
    }
    return null;
  })();

  if (typeof options.timeoutMs === 'number') {
    timeoutHandle = setTimeout(() => {
      abortWithReason(createAbortError(options.timeoutMessage ?? 'request_timed_out'));
    }, Math.max(0, options.timeoutMs));
    timeoutHandle.unref?.();
  }

  request?.on?.('aborted', handleRequestAborted);
  request?.on?.('close', handleRequestClose);
  requestSocket?.on?.('close', handleRequestSocketClose);
  response?.on?.('close', handleResponseClose);
  response?.on?.('finish', handleResponseFinish);
  responseSocket?.on?.('close', handleResponseSocketClose);
  options.parentSignal?.addEventListener('abort', handleParentAbort, { once: true });

  if (earlyAbortReason) {
    abortWithReason(earlyAbortReason);
  }

  return {
    signal: controller.signal,
    cleanup,
  };
}
