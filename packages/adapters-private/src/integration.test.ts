import { describe, expect, it } from 'vitest';
import {
  MinioObjectStore,
  MongoJsonDocStore,
  PgVectorStore,
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

describe('adapters-private integration', () => {
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

  it('pgvector store upsert/search/delete works against real postgres', async () => {
    const store = new PgVectorStore({
      databaseUrl: POSTGRES_URL,
      embeddingDimensions: 4,
      tableName: 'source_embeddings_it',
    });
    await store.ensureSchema();

    const workspaceId = 'ws_it';
    const projectId = 'proj_it';
    const libraryId = 'lib_it';
    const sourceId = `src_it_${Date.now()}`;

    await store.upsertChunks(workspaceId, projectId, libraryId, [
      {
        chunkId: 'c1',
        sourceId,
        content: 'hello world',
        embedding: [1, 0, 0, 0],
        metadata: { order: 1 },
      },
      {
        chunkId: 'c2',
        sourceId,
        content: 'goodbye world',
        embedding: [0, 1, 0, 0],
        metadata: { order: 2 },
      },
    ]);

    const count = await store.countByLibrary(workspaceId, projectId, libraryId);
    expect(count).toBeGreaterThanOrEqual(2);

    const results = await store.search({
      workspaceId,
      projectId,
      libraryId,
      queryEmbedding: [1, 0, 0, 0],
      topK: 2,
    });
    expect(results).toHaveLength(2);
    expect(results[0].chunkId).toBe('c1');
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);

    await store.deleteBySource(workspaceId, projectId, libraryId, sourceId);
    const afterDelete = await store.search({
      workspaceId,
      projectId,
      libraryId,
      queryEmbedding: [1, 0, 0, 0],
      topK: 2,
    });
    expect(afterDelete.find((item) => item.sourceId === sourceId)).toBeUndefined();

    await store.close();
  });
});
