import type http from 'node:http';
import { Readable } from 'node:stream';
import type {
  ReadableStream as WebReadableStream,
  ReadableStreamDefaultReader as WebReadableStreamDefaultReader,
} from 'node:stream/web';
import type { ObjectStorePutObjectStreamOptions } from '@mbos/ports';
import type { Client as MinioClient } from 'minio';

export interface GatewayObjectDownloadHandle {
  stream: Readable;
  cancel: (reason?: unknown) => Promise<void>;
}

export interface HttpOperationEnvelope {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  cleanup: () => void;
}

type MultipartUploadFilePart = Readable & {
  on(event: 'limit', listener: () => void): void;
  resume(): void;
  destroy(error?: Error): void;
  destroyed?: boolean;
};

export function createAbortError(
  reason?: unknown,
  fallbackMessage = 'stream_aborted',
): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : fallbackMessage,
  );
  error.name = 'AbortError';
  if (reason instanceof Error) {
    (error as Error & { cause?: unknown }).cause = reason;
  }
  return error;
}

export function bindAbortSignal(
  signal: AbortSignal | undefined,
  onAbort: (reason?: unknown) => void,
): () => void {
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    onAbort(signal.reason);
    return () => {};
  }
  const handleAbort = () => onAbort(signal.reason);
  signal.addEventListener('abort', handleAbort, { once: true });
  return () => signal.removeEventListener('abort', handleAbort);
}

function isResponseUnavailable(res: http.ServerResponse): boolean {
  return Boolean(
    (res as http.ServerResponse & { destroyed?: boolean }).destroyed
      || (res as http.ServerResponse & { writableDestroyed?: boolean }).writableDestroyed
      || res.writableEnded,
  );
}

function isRequestUnavailable(req: http.IncomingMessage): boolean {
  return Boolean(
    req.aborted
      || (req as http.IncomingMessage & { destroyed?: boolean }).destroyed,
  );
}

function supportsEventEmitterLifecycle(
  value: unknown,
): value is Pick<NodeJS.EventEmitter, 'on' | 'removeListener'> {
  return Boolean(
    value
      && typeof (value as NodeJS.EventEmitter).on === 'function'
      && typeof (value as NodeJS.EventEmitter).removeListener === 'function',
  );
}

function destroyReadableSafely(stream: Readable, error: Error): void {
  if (stream.listenerCount('error') === 0) {
    stream.once('error', () => {});
  }
  stream.destroy(error);
}

export function createHttpOperationEnvelope(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
}): HttpOperationEnvelope {
  const { req, res } = args;
  const controller = new AbortController();
  let cleaned = false;
  let finished = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (supportsEventEmitterLifecycle(req)) {
      req.removeListener('aborted', handleRequestAborted);
      req.removeListener('error', handleRequestError);
    }
    if (supportsEventEmitterLifecycle(res)) {
      res.removeListener('close', handleResponseClose);
      res.removeListener('error', handleResponseError);
      res.removeListener('finish', handleResponseFinish);
    }
  };

  const abort = (reason?: unknown) => {
    if (finished || controller.signal.aborted) {
      cleanup();
      return;
    }
    controller.abort(createAbortError(reason, 'http_operation_aborted'));
    cleanup();
  };

  const handleRequestAborted = () => abort('client_request_aborted');
  const handleRequestError = (error: Error) => abort(error);
  const handleResponseClose = () => {
    if (finished || res.writableEnded) {
      cleanup();
      return;
    }
    abort('client_response_closed');
  };
  const handleResponseError = (error: Error) => abort(error);
  const handleResponseFinish = () => {
    finished = true;
    cleanup();
  };

  if (supportsEventEmitterLifecycle(req)) {
    req.on('aborted', handleRequestAborted);
    req.on('error', handleRequestError);
  }
  if (supportsEventEmitterLifecycle(res)) {
    res.on('close', handleResponseClose);
    res.on('error', handleResponseError);
    res.on('finish', handleResponseFinish);
  }

  if (isRequestUnavailable(req)) {
    abort('client_request_aborted');
  } else if (isResponseUnavailable(res)) {
    abort('client_response_closed');
  }

  return {
    signal: controller.signal,
    abort,
    cleanup,
  };
}

export async function awaitAbortableOperation<T>(
  operation: Promise<T>,
  options: {
    signal?: AbortSignal;
    abortMessage?: string;
    onLateResolve?: (value: T, reason?: unknown) => void | Promise<void>;
  } = {},
): Promise<T> {
  const { signal, abortMessage = 'http_operation_aborted', onLateResolve } = options;
  if (!signal) {
    return operation;
  }
  if (signal.aborted) {
    throw createAbortError(signal.reason, abortMessage);
  }

  let removeAbortListener: () => void = () => {};
  let aborted = false;
  const trackedOperation = operation.then((value) => {
    if (aborted) {
      void onLateResolve?.(value, signal.reason);
    }
    return value;
  });

  const abortPromise = new Promise<never>((_resolve, reject) => {
    removeAbortListener = bindAbortSignal(signal, (reason) => {
      aborted = true;
      reject(createAbortError(reason, abortMessage));
    });
  });

  try {
    return await Promise.race([trackedOperation, abortPromise]);
  } finally {
    removeAbortListener();
  }
}

async function cancelReader(
  reader: WebReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // best-effort cancellation
  }
}

function createAbortableNodeReadable(
  body: WebReadableStream<Uint8Array>,
  signal?: AbortSignal,
): {
  stream: Readable;
  cleanup: () => void;
} {
  const reader = body.getReader();
  let finished = false;
  let cleanupAbort: () => void = () => {};
  const stream = Readable.from((async function* () {
    try {
      while (true) {
        if (signal?.aborted) {
          throw createAbortError(signal.reason, 'gateway_upload_aborted');
        }
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        if (value) {
          yield Buffer.from(value);
        }
      }
    } finally {
      cleanupAbort();
      if (!finished) {
        await cancelReader(reader, signal?.reason);
      }
      reader.releaseLock();
    }
  })());

  cleanupAbort = bindAbortSignal(signal, (reason) => {
    void cancelReader(reader, reason);
    stream.destroy(createAbortError(reason, 'gateway_upload_aborted'));
  });

  return {
    stream,
    cleanup: () => cleanupAbort(),
  };
}

export async function putGatewayObjectStream(
  client: MinioClient,
  bucket: string,
  key: string,
  body: WebReadableStream<Uint8Array>,
  options: ObjectStorePutObjectStreamOptions = {},
): Promise<void> {
  const { stream, cleanup } = createAbortableNodeReadable(body, options.signal);
  try {
    await client.putObject(bucket, key, stream, options.sizeBytes, {
      'Content-Type': options.contentType ?? 'application/octet-stream',
      ...(options.metadata ?? {}),
    });
    if (options.signal?.aborted) {
      throw createAbortError(options.signal.reason, 'gateway_upload_aborted');
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw createAbortError(options.signal.reason, 'gateway_upload_aborted');
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function openGatewayObjectDownload(
  client: MinioClient,
  bucket: string,
  key: string,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<GatewayObjectDownloadHandle> {
  const stream = await awaitAbortableOperation(
    client.getObject(bucket, key),
    {
      signal: options.signal,
      abortMessage: 'gateway_download_aborted',
      onLateResolve: async (lateStream, reason) => {
        if (!lateStream.destroyed) {
          destroyReadableSafely(lateStream, createAbortError(reason, 'gateway_download_aborted'));
        }
      },
    },
  );
  let cancelled = false;
  return {
    stream,
    cancel: async (reason?: unknown) => {
      if (cancelled || stream.destroyed) {
        return;
      }
      cancelled = true;
      destroyReadableSafely(stream, createAbortError(reason, 'gateway_download_aborted'));
    },
  };
}

export function pipeGatewayDownloadToHttpResponse(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  download: GatewayObjectDownloadHandle;
  streamErrorMessage: string;
}): void {
  const { req, res, download, streamErrorMessage } = args;
  let settled = false;
  let upstreamCancelled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    req.removeListener('aborted', handleRequestAborted);
    req.removeListener('error', handleRequestError);
    res.removeListener('close', handleResponseClose);
    res.removeListener('error', handleResponseError);
    res.removeListener('finish', handleFinish);
    download.stream.removeListener('error', handleStreamError);
  };

  const cancelUpstream = (reason?: unknown) => {
    upstreamCancelled = true;
    void download.cancel(reason).finally(() => {
      setImmediate(() => {
        cleanup();
      });
    });
  };

  const handleRequestAborted = () => cancelUpstream(createAbortError('client_request_aborted'));
  const handleRequestError = (error: Error) => cancelUpstream(error);
  const handleResponseClose = () => {
    if (!res.writableEnded) {
      cancelUpstream(createAbortError('client_response_closed'));
    } else {
      cleanup();
    }
  };
  const handleResponseError = (error: Error) => cancelUpstream(error);
  const handleFinish = () => cleanup();
  const handleStreamError = () => {
    cleanup();
    if (!upstreamCancelled && !res.writableEnded) {
      res.destroy(new Error(streamErrorMessage));
    }
  };

  const earlyDisconnectReason = (() => {
    if (req.aborted) {
      return createAbortError('client_request_aborted');
    }
    if ((req as http.IncomingMessage & { destroyed?: boolean }).destroyed) {
      return createAbortError('client_request_destroyed');
    }
    if ((res as http.ServerResponse & { destroyed?: boolean; writableDestroyed?: boolean }).destroyed) {
      return createAbortError('client_response_closed');
    }
    if ((res as http.ServerResponse & { writableDestroyed?: boolean }).writableDestroyed) {
      return createAbortError('client_response_closed');
    }
    return null;
  })();

  download.stream.on('error', handleStreamError);

  if (earlyDisconnectReason) {
    cancelUpstream(earlyDisconnectReason);
    return;
  }

  req.on('aborted', handleRequestAborted);
  req.on('error', handleRequestError);
  res.on('close', handleResponseClose);
  res.on('error', handleResponseError);
  res.on('finish', handleFinish);
  download.stream.pipe(res);
}

export async function parseMultipartUploadAndExecute(
  req: http.IncomingMessage,
  execute: (input: {
    fileName: string;
    fileStream: WebReadableStream<Uint8Array>;
    contentType?: string;
    contentLength?: number;
    prefix?: string;
    overwrite?: boolean;
    signal: AbortSignal;
  }) => Promise<unknown>,
  createBusboy: (
    headers: http.IncomingHttpHeaders,
    maxFileSizeBytes?: number,
  ) => {
    on(event: 'field', listener: (name: string, value: string) => void): void;
    on(
      event: 'file',
      listener: (
        name: string,
        file: MultipartUploadFilePart,
        info: { filename?: string; mimeType?: string },
      ) => void,
    ): void;
    on(event: 'error', listener: (error: Error) => void): void;
    on(event: 'finish', listener: () => void): void;
  } & NodeJS.WritableStream,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    const busboy = createBusboy(req.headers);
    let prefix: string | undefined;
    let overwrite = false;
    let uploadPromise: Promise<unknown> | null = null;
    let fileSeen = false;
    let settled = false;
    let requestDetached = false;
    let activeFile: MultipartUploadFilePart | null = null;
    let suppressSignalSettle = false;
    let cleanupExternalAbort: () => void = () => {};

    const fileAbortError = (reason?: unknown) =>
      createAbortError(reason, 'file_library_upload_aborted');

    const cleanup = () => {
      req.removeListener('aborted', handleAbort);
      req.removeListener('error', handleRequestError);
      abortController.signal.removeEventListener('abort', handleSignalAbort);
      cleanupExternalAbort();
      if (activeFile) {
        activeFile.removeListener('limit', handleLimit);
      }
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const detachRequest = () => {
      if (requestDetached) {
        return;
      }
      requestDetached = true;
      req.unpipe(busboy);
      if (!req.complete) {
        req.resume();
      }
    };

    const disposeMultipartFile = (
      file: MultipartUploadFilePart | null,
      reason?: unknown,
    ) => {
      if (!file) {
        return;
      }
      file.removeListener('limit', handleLimit);
      if (file.destroyed) {
        return;
      }
      if (file.listenerCount('error') === 0) {
        file.once('error', () => {});
      }
      file.resume();
      file.destroy(fileAbortError(reason));
    };

    const disposeActiveFile = (reason?: unknown) => {
      const file = activeFile;
      activeFile = null;
      disposeMultipartFile(file, reason);
    };

    const closeEnvelope = (reason?: unknown) => {
      detachRequest();
      disposeActiveFile(reason);
    };

    const abortUpload = (
      reason?: unknown,
      options: {
        preserveOriginalError?: boolean;
      } = {},
    ) => {
      closeEnvelope(reason);
      if (options.preserveOriginalError) {
        suppressSignalSettle = true;
      }
      if (!abortController.signal.aborted) {
        abortController.abort(fileAbortError(reason));
      }
    };

    const handleAbort = () => abortUpload('file_library_upload_aborted');
    const handleRequestError = (error: Error) => abortUpload(error);
    const handleSignalAbort = () => {
      closeEnvelope(abortController.signal.reason);
      if (suppressSignalSettle) {
        return;
      }
      settle(() => reject(fileAbortError(abortController.signal.reason)));
    };
    const handleLimit = () => {
      abortUpload('file_library_max_file_size_exceeded');
    };

    req.on('aborted', handleAbort);
    req.on('error', handleRequestError);
    abortController.signal.addEventListener('abort', handleSignalAbort, { once: true });
    cleanupExternalAbort = bindAbortSignal(options.signal, (reason) => {
      abortUpload(reason);
    });

    busboy.on('field', (name, value) => {
      if (name === 'prefix') {
        prefix = value;
      } else if (name === 'overwrite') {
        overwrite = value === 'true' || value === '1';
      }
    });

    busboy.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume();
        return;
      }
      if (fileSeen) {
        const duplicateFileError = new Error(
          'file_library_multiple_files_not_supported',
        );
        disposeMultipartFile(file, duplicateFileError);
        abortUpload(duplicateFileError, { preserveOriginalError: true });
        settle(() => reject(duplicateFileError));
        return;
      }
      fileSeen = true;
      activeFile = file;
      file.on('limit', handleLimit);
      const fileStream = Readable.toWeb(file) as unknown as WebReadableStream<Uint8Array>;
      try {
        uploadPromise = Promise.resolve(
          execute({
            fileName: info.filename || 'upload.bin',
            fileStream,
            contentType: info.mimeType || 'application/octet-stream',
            contentLength: undefined,
            prefix,
            overwrite,
            signal: abortController.signal,
          }),
        );
      } catch (error) {
        abortUpload(error, { preserveOriginalError: true });
        settle(() => reject(error));
        return;
      }
      uploadPromise.catch((error) => {
        abortUpload(error, { preserveOriginalError: true });
        settle(() => reject(error));
      });
    });

    busboy.on('error', (error) => {
      abortUpload(error, { preserveOriginalError: true });
      settle(() => reject(error));
    });
    busboy.on('finish', async () => {
      if (settled) {
        return;
      }
      if (!fileSeen || !uploadPromise) {
        closeEnvelope('file_required');
        settle(() => reject(new Error('file_required')));
        return;
      }
      try {
        const result = await uploadPromise;
        settle(() => resolve(result));
      } catch (error) {
        settle(() => reject(error));
      }
    });

    req.pipe(busboy);
  });
}
