import type {
  ObjectStorePort,
  ObjectStorePutObjectStreamOptions,
  ObjectStoreStreamHandle,
} from '@mbos/ports';
import { Client as MinioClient } from 'minio';
import { Readable } from 'node:stream';
import type {
  ReadableStream as WebReadableStream,
  ReadableStreamDefaultReader as WebReadableStreamDefaultReader,
} from 'node:stream/web';

export interface MinioObjectStoreOptions {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

function createAbortError(
  reason?: unknown,
  fallbackMessage = 'object_store_stream_aborted',
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
    // ignore best-effort cancellation failures
  }
}

function createAbortableNodeReadable(
  body: WebReadableStream<Uint8Array>,
  signal?: AbortSignal,
): {
  nodeStream: Readable;
  cleanup: () => void;
} {
  const reader = body.getReader();
  let finished = false;
  let cleanupAbort: () => void = () => {};
  const nodeStream = Readable.from((async function* () {
    try {
      while (true) {
        if (signal?.aborted) {
          throw createAbortError(signal.reason);
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
    nodeStream.destroy(createAbortError(reason));
  });

  return {
    nodeStream,
    cleanup: () => cleanupAbort(),
  };
}

export class MinioObjectStore implements ObjectStorePort {
  private readonly client: MinioClient;

  constructor(options: MinioObjectStoreOptions) {
    this.client = new MinioClient({
      endPoint: options.endPoint,
      port: options.port,
      useSSL: options.useSSL,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
  }

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    const payload = Buffer.from(body);
    await this.client.putObject(bucket, key, payload, payload.byteLength, {
      'Content-Type': contentType ?? 'application/octet-stream',
    });
  }

  async putObjectStream(
    bucket: string,
    key: string,
    body: WebReadableStream<Uint8Array>,
    options: ObjectStorePutObjectStreamOptions = {},
  ): Promise<void> {
    const { nodeStream, cleanup } = createAbortableNodeReadable(body, options.signal);
    try {
      await this.client.putObject(bucket, key, nodeStream, options.sizeBytes, {
        'Content-Type': options.contentType ?? 'application/octet-stream',
        ...(options.metadata ?? {}),
      });
      if (options.signal?.aborted) {
        throw createAbortError(options.signal.reason);
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw createAbortError(options.signal.reason);
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  async presignedGetObject(bucket: string, key: string, expirySeconds = 900): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySeconds);
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  async getObjectStream(bucket: string, key: string): Promise<ObjectStoreStreamHandle> {
    const stat = await this.statObject(bucket, key);
    const nodeStream = await this.client.getObject(bucket, key);
    const webStream = Readable.toWeb(nodeStream) as WebReadableStream<Uint8Array>;
    let cancelled = false;
    return {
      body: webStream,
      cancel: async (reason?: unknown) => {
        if (cancelled || nodeStream.destroyed) {
          return;
        }
        cancelled = true;
        nodeStream.destroy(createAbortError(reason));
      },
      sizeBytes: stat.sizeBytes,
      contentType: stat.contentType,
      etag: stat.etag,
      lastModified: stat.lastModified,
      metadata: stat.metadata,
    };
  }

  async statObject(
    bucket: string,
    key: string,
  ): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }> {
    const stat = await this.client.statObject(bucket, key);
    return {
      key,
      sizeBytes: stat.size,
      contentType: stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'],
      etag: stat.etag,
      lastModified: stat.lastModified?.toISOString?.() ?? new Date().toISOString(),
      metadata: (stat.metaData as Record<string, string> | undefined) ?? undefined,
    };
  }

  async listObjects(
    bucket: string,
    options: {
      prefix: string;
      delimiter?: string;
      pageSize?: number;
      continuationToken?: string;
    },
  ): Promise<{
    prefix: string;
    objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }> {
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 200), 1000);
    const delimiter = options.delimiter;
    const recursive = delimiter !== '/';
    const stream = this.client.listObjectsV2(
      bucket,
      options.prefix,
      recursive,
      options.continuationToken ?? undefined,
    );

    const objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }> =
      [];
    const commonPrefixes: string[] = [];
    let lastKey: string | null = null;
    let truncated = false;

    try {
      for await (const item of stream as unknown as AsyncIterable<{
        name?: string;
        prefix?: string;
        size?: number;
        etag?: string;
        lastModified?: Date;
      }>) {
        const prefixRow = typeof item.prefix === 'string' ? item.prefix : null;
        if (prefixRow) {
          commonPrefixes.push(prefixRow);
          lastKey = prefixRow;
        } else if (typeof item.name === 'string') {
          objects.push({
            key: item.name,
            sizeBytes: item.size ?? 0,
            etag: item.etag,
            lastModified: item.lastModified?.toISOString?.() ?? new Date().toISOString(),
          });
          lastKey = item.name;
        }

        if (objects.length + commonPrefixes.length >= pageSize) {
          truncated = true;
          if (typeof (stream as unknown as { destroy?: () => void }).destroy === 'function') {
            (stream as unknown as { destroy: () => void }).destroy();
          }
          break;
        }
      }
    } catch {
      // MinIO list stream may throw after destroy; treat as normal truncation.
    }

    return {
      prefix: options.prefix,
      objects,
      commonPrefixes,
      nextContinuationToken: truncated ? lastKey : null,
    };
  }

  async copyObject(
    bucket: string,
    fromKey: string,
    toKey: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    if (options.overwrite === false) {
      try {
        await this.client.statObject(bucket, toKey);
        throw new Error('destination_exists');
      } catch (err) {
        if (err instanceof Error && err.message === 'destination_exists') throw err;
      }
    }

    await this.client.copyObject(bucket, toKey, `/${bucket}/${fromKey}`);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
  }

  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (
      typeof (this.client as unknown as { removeObjects?: unknown }).removeObjects === 'function'
    ) {
      await (
        this.client as unknown as { removeObjects: (b: string, k: string[]) => Promise<void> }
      ).removeObjects(bucket, keys);
      return;
    }
    for (const key of keys) {
      await this.client.removeObject(bucket, key);
    }
  }
}

export class InMemoryObjectStore implements ObjectStorePort {
  private readonly store = new Map<
    string,
    {
      body: Uint8Array;
      contentType?: string;
      etag?: string;
      lastModified: string;
      metadata?: Record<string, string>;
    }
  >();

  private key(bucket: string, objectKey: string): string {
    return `${bucket}/${objectKey}`;
  }

  async putObject(bucket: string, key: string, body: Uint8Array): Promise<void> {
    this.store.set(this.key(bucket, key), {
      body: new Uint8Array(body),
      lastModified: new Date().toISOString(),
    });
  }

  async putObjectStream(
    bucket: string,
    key: string,
    body: WebReadableStream<Uint8Array>,
    options: ObjectStorePutObjectStreamOptions = {},
  ): Promise<void> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let abortTriggered = false;
    const cleanupAbort = bindAbortSignal(options.signal, (reason) => {
      abortTriggered = true;
      void cancelReader(reader, reason);
    });
    try {
      while (true) {
        if (options.signal?.aborted || abortTriggered) {
          throw createAbortError(options.signal?.reason);
        }
        const { done, value } = await reader.read();
        if (done) {
          if (options.signal?.aborted || abortTriggered) {
            throw createAbortError(options.signal?.reason);
          }
          break;
        }
        if (value) chunks.push(value);
      }
    } finally {
      cleanupAbort();
      reader.releaseLock();
    }
    const joined =
      chunks.length === 1
        ? chunks[0]
        : new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    this.store.set(this.key(bucket, key), {
      body: joined,
      contentType: options.contentType,
      lastModified: new Date().toISOString(),
      metadata: options.metadata,
    });
  }

  async presignedGetObject(bucket: string, key: string): Promise<string> {
    if (!this.store.has(this.key(bucket, key))) {
      throw new Error('object_not_found');
    }
    return `memory://${bucket}/${key}`;
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    const value = this.store.get(this.key(bucket, key));
    if (!value) {
      throw new Error('object_not_found');
    }

    return new Uint8Array(value.body);
  }

  async getObjectStream(bucket: string, key: string): Promise<ObjectStoreStreamHandle> {
    const stat = await this.statObject(bucket, key);
    const obj = this.store.get(this.key(bucket, key));
    if (!obj) throw new Error('object_not_found');
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(obj.body));
          controller.close();
        },
      }) as unknown as WebReadableStream<Uint8Array>,
      cancel: async () => undefined,
      sizeBytes: stat.sizeBytes,
      contentType: stat.contentType,
      etag: stat.etag,
      lastModified: stat.lastModified,
      metadata: stat.metadata,
    };
  }

  async statObject(
    bucket: string,
    key: string,
  ): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }> {
    const obj = this.store.get(this.key(bucket, key));
    if (!obj) throw new Error('object_not_found');
    return {
      key,
      sizeBytes: obj.body.byteLength,
      contentType: obj.contentType,
      etag: obj.etag,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
    };
  }

  async listObjects(
    bucket: string,
    options: { prefix: string; delimiter?: string; pageSize?: number; continuationToken?: string },
  ): Promise<{
    prefix: string;
    objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }> {
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 200), 1000);
    const delimiter = options.delimiter;
    const allKeys = [...this.store.keys()]
      .filter((full) => full.startsWith(`${bucket}/`))
      .map((full) => full.slice(bucket.length + 1))
      .filter((k) => k.startsWith(options.prefix))
      .sort();

    const startAfter = options.continuationToken;
    const startIndex = startAfter ? allKeys.findIndex((k) => k > startAfter) : 0;
    const keys = allKeys.slice(startIndex < 0 ? 0 : startIndex);

    const objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }> =
      [];
    const commonPrefixes = new Set<string>();
    let lastKey: string | null = null;
    let truncated = false;

    for (const key of keys) {
      const rest = key.slice(options.prefix.length);
      if (delimiter === '/' && rest.includes('/')) {
        const seg = rest.split('/')[0]!;
        const p = `${options.prefix}${seg}/`;
        commonPrefixes.add(p);
        lastKey = p;
      } else {
        const obj = this.store.get(this.key(bucket, key));
        if (!obj) continue;
        objects.push({
          key,
          sizeBytes: obj.body.byteLength,
          etag: obj.etag,
          lastModified: obj.lastModified,
        });
        lastKey = key;
      }

      if (objects.length + commonPrefixes.size >= pageSize) {
        truncated = true;
        break;
      }
    }

    return {
      prefix: options.prefix,
      objects,
      commonPrefixes: [...commonPrefixes],
      nextContinuationToken: truncated ? lastKey : null,
    };
  }

  async copyObject(
    bucket: string,
    fromKey: string,
    toKey: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    const src = this.store.get(this.key(bucket, fromKey));
    if (!src) throw new Error('object_not_found');
    const dstKey = this.key(bucket, toKey);
    if (options.overwrite === false && this.store.has(dstKey)) {
      throw new Error('destination_exists');
    }
    this.store.set(dstKey, {
      ...src,
      body: new Uint8Array(src.body),
      lastModified: new Date().toISOString(),
    });
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.store.delete(this.key(bucket, key));
  }

  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(this.key(bucket, key));
    }
  }
}
