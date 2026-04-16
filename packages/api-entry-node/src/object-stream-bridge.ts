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

function createAbortError(
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

function bindAbortSignal(
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
): Promise<GatewayObjectDownloadHandle> {
  const stream = await client.getObject(bucket, key);
  let cancelled = false;
  return {
    stream,
    cancel: async (reason?: unknown) => {
      if (cancelled || stream.destroyed) {
        return;
      }
      cancelled = true;
      stream.destroy(createAbortError(reason, 'gateway_download_aborted'));
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
        file: Readable & { on(event: 'limit', listener: () => void): void; resume(): void },
        info: { filename?: string; mimeType?: string },
      ) => void,
    ): void;
    on(event: 'error', listener: (error: Error) => void): void;
    on(event: 'finish', listener: () => void): void;
  } & NodeJS.WritableStream,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    const busboy = createBusboy(req.headers);
    let prefix: string | undefined;
    let overwrite = false;
    let uploadPromise: Promise<unknown> | null = null;
    let fileSeen = false;
    let settled = false;

    const cleanup = () => {
      req.removeListener('aborted', handleAbort);
      req.removeListener('error', handleRequestError);
      abortController.signal.removeEventListener('abort', handleSignalAbort);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const abortUpload = (reason?: unknown) => {
      if (abortController.signal.aborted) return;
      abortController.abort(createAbortError(reason, 'file_library_upload_aborted'));
    };

    const handleAbort = () => abortUpload('file_library_upload_aborted');
    const handleRequestError = (error: Error) => abortUpload(error);
    const handleSignalAbort = () =>
      settle(() => reject(createAbortError(abortController.signal.reason, 'file_library_upload_aborted')));

    req.on('aborted', handleAbort);
    req.on('error', handleRequestError);
    abortController.signal.addEventListener('abort', handleSignalAbort, { once: true });

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
      fileSeen = true;
      const fileStream = Readable.toWeb(file) as unknown as WebReadableStream<Uint8Array>;
      uploadPromise = execute({
        fileName: info.filename || 'upload.bin',
        fileStream,
        contentType: info.mimeType || 'application/octet-stream',
        contentLength: undefined,
        prefix,
        overwrite,
        signal: abortController.signal,
      });
      uploadPromise.catch((error) => settle(() => reject(error)));
      file.on('limit', () => {
        abortUpload('file_library_max_file_size_exceeded');
      });
    });

    busboy.on('error', (error) => settle(() => reject(error)));
    busboy.on('finish', async () => {
      if (!fileSeen || !uploadPromise) {
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
