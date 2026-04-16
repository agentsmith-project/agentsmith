import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  MinioObjectStore,
  MongoJsonDocStore,
  PostgresProjectRepo,
  RedisCache,
} from './index.js';
import { Pool } from 'pg';

const POSTGRES_URL = process.env.POSTGRES_URL ?? 'postgresql://mbos:mbos_dev_password@localhost:15432/mbos';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:16379';
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
const MONGO_DB = process.env.MONGO_DB ?? 'mbos';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'localhost';
const MINIO_PORT = Number(process.env.MINIO_PORT ?? '19000');
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? 'mbos';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? 'mbos_dev_password';
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? 'mbos-dev';

const describeRealIntegration = process.env.RUN_ADAPTERS_PRIVATE_INTEGRATION === 'true' ? describe : describe.skip;

describe('MinioObjectStore stream lifecycle', () => {
  it('aborts uploads by cancelling the source stream and rejecting with AbortError', async () => {
    const store = new MinioObjectStore({
      endPoint: 'localhost',
      port: 19000,
      useSSL: false,
      accessKey: 'mbos',
      secretKey: 'mbos_dev_password',
    });
    const controller = new AbortController();
    const cancelSpy = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        await new Promise(() => {});
      },
      cancel: cancelSpy,
    });

    (store as unknown as {
      client: {
        putObject: (
          bucket: string,
          key: string,
          stream: PassThrough,
          size?: number,
          metadata?: Record<string, string>,
        ) => Promise<void>;
      };
    }).client = {
      putObject: vi.fn().mockImplementation(
        async (_bucket: string, _key: string, stream: PassThrough, _size?: number, _metadata?: Record<string, string>) =>
          new Promise<void>((_resolve, reject) => {
            stream.on('error', reject);
            stream.resume();
          }),
      ),
    };

    const uploadPromise = store.putObjectStream(MINIO_BUCKET, 'abort.txt', body, {
      signal: controller.signal,
    });

    controller.abort(new Error('client_aborted'));

    await expect(uploadPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('returns a cancellable download handle that destroys the backing node stream', async () => {
    const store = new MinioObjectStore({
      endPoint: 'localhost',
      port: 19000,
      useSSL: false,
      accessKey: 'mbos',
      secretKey: 'mbos_dev_password',
    });
    const stream = new PassThrough();
    const destroySpy = vi.spyOn(stream, 'destroy');

    (store as unknown as {
      client: {
        statObject: (bucket: string, key: string) => Promise<{
          size: number;
          metaData?: Record<string, string>;
          etag?: string;
          lastModified?: Date;
        }>;
        getObject: (bucket: string, key: string) => Promise<PassThrough>;
      };
    }).client = {
      statObject: vi.fn().mockResolvedValue({
        size: 3,
        metaData: { 'content-type': 'text/plain' },
        etag: 'etag-1',
        lastModified: new Date('2026-04-15T00:00:00.000Z'),
      }),
      getObject: vi.fn().mockResolvedValue(stream),
    };

    const object = await store.getObjectStream(MINIO_BUCKET, 'download.txt');

    await object.cancel(new Error('client_disconnected'));

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(destroySpy.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
  });
});

describeRealIntegration('adapters-private integration', () => {
  it('postgres project repo CRUD works against real db', async () => {
    const pool = new Pool({ connectionString: POSTGRES_URL });
    const repo = new PostgresProjectRepo(pool);

    const projectId = `proj_it_${Date.now()}`;
    const workspaceId = 'ws_it';

    await repo.save({
      id: projectId,
      workspace_id: workspaceId,
      name: 'Integration Project',
      description: 'from test',
      visibility: 'private',
      join_policy: 'approval_required',
      owner_id: 'user_it',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const listed = await repo.listByWorkspace(workspaceId);
    expect(listed.some((item) => item.id === projectId)).toBe(true);

    const found = await repo.getById(workspaceId, projectId);
    expect(found?.name).toBe('Integration Project');

    const updated = await repo.update(workspaceId, projectId, {
      name: 'Integration Project Updated',
      updated_at: new Date().toISOString(),
    });
    expect(updated?.name).toBe('Integration Project Updated');

    const deleted = await repo.delete(workspaceId, projectId);
    expect(deleted).toBe(true);

    await pool.end();
  });

  it('redis cache set/get/del works against real redis', async () => {
    const cache = new RedisCache({ url: REDIS_URL });
    const key = `it:redis:${Date.now()}`;

    await cache.set(key, 'value', 30);
    const got = await cache.get(key);
    expect(got).toBe('value');

    await cache.del(key);
    const missing = await cache.get(key);
    expect(missing).toBeNull();

    const counterKey = `it:redis:counter:${Date.now()}`;
    const first = await cache.incr(counterKey, 30);
    const second = await cache.incr(counterKey, 30);
    expect(first).toBe(1);
    expect(second).toBe(2);

    await cache.close();
  });

  it('mongo doc store upsert/get/delete works against real mongo', async () => {
    const store = new MongoJsonDocStore({
      url: MONGO_URL,
      dbName: MONGO_DB,
    });

    const collection = 'it_docs';
    const id = `doc_${Date.now()}`;

    await store.upsert(collection, id, { foo: 'bar', n: 1 });
    const got = await store.get<{ foo: string; n: number }>(collection, id);
    expect(got).toEqual({ foo: 'bar', n: 1 });

    await store.delete(collection, id);
    const missing = await store.get(collection, id);
    expect(missing).toBeNull();

    await store.close();
  });

  it('minio object store put/presign/delete works against real minio', async () => {
    const store = new MinioObjectStore({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: false,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });

    const key = `it/minio-${Date.now()}.txt`;
    await store.putObject(MINIO_BUCKET, key, Buffer.from('hello', 'utf-8'), 'text/plain');

    const signed = await store.presignedGetObject(MINIO_BUCKET, key, 60);
    const signedUrl = new URL(signed);
    expect(signedUrl.pathname).toContain(`/${MINIO_BUCKET}/`);
    expect(signedUrl.pathname).toContain(`/${key}`);

    await store.deleteObject(MINIO_BUCKET, key);
  });
});
