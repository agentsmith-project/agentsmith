import { describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore, MongoJsonDocStore } from './json-doc-store.js';

interface VersionedDoc {
  id: string;
  status: 'ready' | 'deleting';
  version: number;
  task_id?: string;
  binding_generation?: number;
}

describe('InMemoryJsonDocStore conditional writes', () => {
  it('rejects duplicate conditional creates without replacing the original document', async () => {
    const store = new InMemoryJsonDocStore();

    await expect(store.createIfAbsent<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1',
      status: 'ready',
      version: 1,
    })).resolves.toEqual({ ok: true });

    await expect(store.createIfAbsent<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1_replacement',
      status: 'deleting',
      version: 2,
    })).resolves.toMatchObject({
      ok: false,
      reason: 'exists',
      current: {
        id: 'doc_1',
        status: 'ready',
        version: 1,
      },
    });

    await expect(store.get<VersionedDoc>('docs', 'doc_1')).resolves.toMatchObject({
      id: 'doc_1',
      status: 'ready',
      version: 1,
    });
  });

  it('updates only when the expected CAS fields still match', async () => {
    const store = new InMemoryJsonDocStore();
    await store.upsert<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1',
      status: 'ready',
      version: 7,
    });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 7,
      },
      patch: {
        status: 'deleting',
        version: 8,
      },
    })).resolves.toMatchObject({
      ok: true,
      doc: {
        id: 'doc_1',
        status: 'deleting',
        version: 8,
      },
    });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 7,
      },
      patch: {
        status: 'deleting',
        version: 9,
      },
    })).resolves.toMatchObject({
      ok: false,
      reason: 'condition_failed',
      current: {
        id: 'doc_1',
        status: 'deleting',
        version: 8,
      },
    });
  });

  it('deletes only when the expected task and binding generation match', async () => {
    const store = new InMemoryJsonDocStore();
    await store.upsert<VersionedDoc>('bindings', 'binding_1', {
      id: 'binding_1',
      status: 'ready',
      version: 1,
      task_id: 'task_1',
      binding_generation: 3,
    });

    await expect(store.deleteIfMatch<VersionedDoc>('bindings', 'binding_1', {
      expected: {
        task_id: 'task_1',
        binding_generation: 2,
      },
    })).resolves.toMatchObject({
      ok: false,
      reason: 'condition_failed',
      current: {
        task_id: 'task_1',
        binding_generation: 3,
      },
    });

    await expect(store.deleteIfMatch<VersionedDoc>('bindings', 'binding_1', {
      expected: {
        task_id: 'task_1',
        binding_generation: 3,
      },
    })).resolves.toEqual({ ok: true, deleted: true });
    await expect(store.get<VersionedDoc>('bindings', 'binding_1')).resolves.toBeNull();
  });
});

type MongoStoredDoc = Record<string, unknown> & { _id: string };

interface MockMongoCollection {
  findOne: ReturnType<typeof vi.fn<(filter: Record<string, unknown>) => Promise<MongoStoredDoc | null>>>;
  updateOne: ReturnType<typeof vi.fn<(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<{ matchedCount: number }>>>;
  insertOne: ReturnType<typeof vi.fn<(doc: MongoStoredDoc) => Promise<void>>>;
  replaceOne: ReturnType<typeof vi.fn<(
    filter: Record<string, unknown>,
    replacement: MongoStoredDoc,
  ) => Promise<{ matchedCount: number }>>>;
  deleteOne: ReturnType<typeof vi.fn<(filter: Record<string, unknown>) => Promise<{ deletedCount: number }>>>;
  find: ReturnType<typeof vi.fn<(filter: Record<string, string>) => { toArray: () => Promise<MongoStoredDoc[]> }>>;
  toArray: ReturnType<typeof vi.fn<() => Promise<MongoStoredDoc[]>>>;
}

interface MockMongoClient {
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  db: ReturnType<typeof vi.fn<(dbName: string) => {
    collection: (collectionName: string) => MockMongoCollection;
  }>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createMongoJsonDocStoreHarness() {
  const collection = createMockMongoCollection();
  const db = {
    collection: vi.fn<(collectionName: string) => MockMongoCollection>(() => collection),
  };
  const client: MockMongoClient = {
    connect: vi.fn<() => Promise<void>>(async () => undefined),
    db: vi.fn<(dbName: string) => typeof db>(() => db),
    close: vi.fn<() => Promise<void>>(async () => undefined),
  };
  const store = new MongoJsonDocStore({
    url: 'mongodb://unit-test.invalid:27017',
    dbName: 'unit_test',
  });
  (store as unknown as { client: MockMongoClient }).client = client;
  return { client, collection, store };
}

function createMockMongoCollection(): MockMongoCollection {
  const toArray = vi.fn<() => Promise<MongoStoredDoc[]>>(async () => []);
  return {
    findOne: vi.fn<(filter: Record<string, unknown>) => Promise<MongoStoredDoc | null>>(async () => null),
    updateOne: vi.fn<(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<{ matchedCount: number }>>(async () => ({ matchedCount: 1 })),
    insertOne: vi.fn<(doc: MongoStoredDoc) => Promise<void>>(async () => undefined),
    replaceOne: vi.fn<(
      filter: Record<string, unknown>,
      replacement: MongoStoredDoc,
    ) => Promise<{ matchedCount: number }>>(async () => ({ matchedCount: 1 })),
    deleteOne: vi.fn<(filter: Record<string, unknown>) => Promise<{ deletedCount: number }>>(async () => ({
      deletedCount: 1,
    })),
    find: vi.fn<(filter: Record<string, string>) => { toArray: () => Promise<MongoStoredDoc[]> }>(() => ({
      toArray,
    })),
    toArray,
  };
}

function transientConnectionClosedError(): Error {
  return new Error('connection 1 to 127.0.0.1:27017 closed');
}

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
}

describe('MongoJsonDocStore transient retry', () => {
  it('retries transient connection closed errors on reads and returns the document', async () => {
    const { client, collection, store } = createMongoJsonDocStoreHarness();
    collection.findOne
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockResolvedValueOnce({
        _id: 'doc_1',
        id: 'doc_1',
        status: 'ready',
        version: 1,
      });

    await expect(store.get<VersionedDoc>('docs', 'doc_1')).resolves.toEqual({
      id: 'doc_1',
      status: 'ready',
      version: 1,
    });

    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(collection.findOne).toHaveBeenCalledTimes(2);
    expect(collection.findOne).toHaveBeenNthCalledWith(1, { _id: 'doc_1' });
    expect(collection.findOne).toHaveBeenNthCalledWith(2, { _id: 'doc_1' });
  });

  it('retries transient connection closed errors on writes and eventually succeeds', async () => {
    const { client, collection, store } = createMongoJsonDocStoreHarness();
    collection.updateOne
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValueOnce({ matchedCount: 1 });

    await expect(store.upsert<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1',
      status: 'ready',
      version: 1,
    })).resolves.toBeUndefined();

    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(collection.updateOne).toHaveBeenCalledTimes(2);
    expect(collection.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: 'doc_1' },
      {
        $set: {
          id: 'doc_1',
          status: 'ready',
          version: 1,
        },
      },
      { upsert: true },
    );
  });

  it('does not retry non-transient errors', async () => {
    const { client, collection, store } = createMongoJsonDocStoreHarness();
    collection.findOne.mockRejectedValueOnce(new Error('json_doc_business_rule_failed'));

    await expect(store.get<VersionedDoc>('docs', 'doc_1')).rejects.toThrow(
      'json_doc_business_rule_failed',
    );

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenCalledTimes(1);
  });

  it('keeps duplicate key conditional create semantics without retrying the insert', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.insertOne.mockRejectedValueOnce(duplicateKeyError());
    collection.findOne.mockResolvedValueOnce({
      _id: 'doc_1',
      id: 'doc_1',
      status: 'ready',
      version: 1,
    });

    await expect(store.createIfAbsent<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1_replacement',
      status: 'deleting',
      version: 2,
    })).resolves.toEqual({
      ok: false,
      reason: 'exists',
      current: {
        id: 'doc_1',
        status: 'ready',
        version: 1,
      },
    });

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenCalledTimes(1);
  });

  it('does not retry conditional create inserts after a transient write error', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.insertOne
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockRejectedValueOnce(duplicateKeyError());
    collection.findOne.mockResolvedValueOnce({
      _id: 'doc_1',
      id: 'doc_1',
      status: 'ready',
      version: 1,
    });

    await expect(store.createIfAbsent<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1_replacement',
      status: 'deleting',
      version: 2,
    })).rejects.toThrow('connection 1 to 127.0.0.1:27017 closed');

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).not.toHaveBeenCalled();
  });

  it('keeps conditional update not_found results without retrying the update', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    collection.findOne.mockResolvedValueOnce(null);

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'missing_doc', {
      expected: {
        status: 'ready',
        version: 1,
      },
      patch: {
        status: 'deleting',
        version: 2,
      },
    })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
      current: null,
    });

    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenCalledTimes(1);
  });

  it('does not retry conditional updates after a transient write error', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.updateOne
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockResolvedValueOnce({ matchedCount: 0 });
    collection.findOne.mockResolvedValueOnce({
      _id: 'doc_1',
      id: 'doc_1',
      status: 'ready',
      version: 2,
    });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 1,
      },
      patch: {
        status: 'deleting',
        version: 3,
      },
    })).rejects.toThrow('connection 1 to 127.0.0.1:27017 closed');

    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).not.toHaveBeenCalled();
  });

  it('retries only the post-write read after a conditional update succeeds', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    collection.findOne
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockResolvedValueOnce({
        _id: 'doc_1',
        id: 'doc_1',
        status: 'deleting',
        version: 3,
      });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 2,
      },
      patch: {
        status: 'deleting',
        version: 3,
      },
    })).resolves.toEqual({
      ok: true,
      doc: {
        id: 'doc_1',
        status: 'deleting',
        version: 3,
      },
    });

    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenCalledTimes(2);
  });

  it('does not rerun conditional updates when post-write read retries are exhausted', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    collection.findOne
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockResolvedValueOnce({
        _id: 'doc_1',
        id: 'doc_1',
        status: 'deleting',
        version: 3,
      });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 2,
      },
      patch: {
        status: 'deleting',
        version: 3,
      },
    })).rejects.toThrow('connection 1 to 127.0.0.1:27017 closed');

    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenCalledTimes(3);
  });

  it('keeps conditional update condition_failed results without retrying the update', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    collection.findOne.mockResolvedValueOnce({
      _id: 'doc_1',
      id: 'doc_1',
      status: 'ready',
      version: 2,
    });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 1,
      },
      patch: {
        status: 'deleting',
        version: 3,
      },
    })).resolves.toEqual({
      ok: false,
      reason: 'condition_failed',
      current: {
        id: 'doc_1',
        status: 'ready',
        version: 2,
      },
    });

    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenCalledTimes(1);
  });

  it('does not retry conditional deletes after a transient write error', async () => {
    const { collection, store } = createMongoJsonDocStoreHarness();
    collection.deleteOne
      .mockRejectedValueOnce(transientConnectionClosedError())
      .mockResolvedValueOnce({ deletedCount: 0 });
    collection.findOne.mockResolvedValueOnce(null);

    await expect(store.deleteIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 1,
      },
    })).rejects.toThrow('connection 1 to 127.0.0.1:27017 closed');

    expect(collection.deleteOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).not.toHaveBeenCalled();
  });
});
