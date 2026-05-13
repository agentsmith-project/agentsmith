import type {
  JsonDocCasCondition,
  JsonDocConditionalCreateResult,
  JsonDocConditionalDeleteResult,
  JsonDocConditionalUpdateResult,
  JsonDocStorePort,
} from '@mbos/ports';
import { MongoClient, MongoNetworkError, type MongoClientOptions } from 'mongodb';

export type MongoJsonDocStorePoolContract = Pick<
  MongoClientOptions,
  'maxPoolSize' | 'minPoolSize' | 'maxIdleTimeMS' | 'maxConnecting' | 'waitQueueTimeoutMS'
>;

export const DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS = Object.freeze({
  maxPoolSize: 20,
  minPoolSize: 0,
  maxIdleTimeMS: 10_000,
  maxConnecting: 2,
  waitQueueTimeoutMS: 5_000,
} satisfies MongoJsonDocStorePoolContract);

const MONGO_JSON_DOC_STORE_TRANSIENT_RETRY_ATTEMPTS = 3;
const MONGO_JSON_DOC_STORE_TRANSIENT_RETRY_DELAY_MS = 50;
const MONGO_TRANSIENT_MESSAGE_PATTERN = /\b(connection \d+ to .* closed|connection closed|socket closed|ECONNRESET|network error)\b/i;

export interface MongoJsonDocStoreOptions {
  url: string;
  dbName: string;
  mongoClientOptions?: Partial<MongoJsonDocStorePoolContract>;
}

export class MongoJsonDocStore implements JsonDocStorePort {
  private readonly client: MongoClient;
  private readonly dbName: string;
  readonly mongoClientOptions: MongoJsonDocStorePoolContract;

  constructor(options: MongoJsonDocStoreOptions) {
    this.mongoClientOptions = {
      ...DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
      ...options.mongoClientOptions,
    };
    this.client = new MongoClient(options.url, this.mongoClientOptions);
    this.dbName = options.dbName;
  }

  private async collection(collection: string) {
    await this.client.connect();
    return this.client
      .db(this.dbName)
      .collection<Record<string, unknown> & { _id: string }>(collection);
  }

  private async withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MONGO_JSON_DOC_STORE_TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isRetryableMongoJsonDocStoreError(error) || attempt === MONGO_JSON_DOC_STORE_TRANSIENT_RETRY_ATTEMPTS - 1) {
          throw error;
        }
        await waitForMongoJsonDocStoreRetry(attempt);
      }
    }
    throw new Error('mongo_json_doc_store_retry_exhausted');
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    return this.withTransientRetry(async () => {
      const col = await this.collection(collection);
      const doc = await col.findOne({ _id: id });
      if (!doc) {
        return null;
      }

      const { _id: _ignored, ...rest } = doc;
      return rest as T;
    });
  }

  async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    await this.withTransientRetry(async () => {
      const col = await this.collection(collection);
      await col.updateOne(
        { _id: id },
        {
          $set: doc as Record<string, unknown>,
        },
        { upsert: true },
      );
    });
  }

  async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    return this.withTransientRetry(async () => {
      const col = await this.collection(collection);
      const docs = await col.find(filter).toArray();
      return docs.map((doc) => {
        const { _id: _ignored, ...rest } = doc;
        return rest as T;
      });
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.withTransientRetry(async () => {
      const col = await this.collection(collection);
      await col.deleteOne({ _id: id });
    });
  }

  async createIfAbsent<T>(
    collection: string,
    id: string,
    doc: T,
  ): Promise<JsonDocConditionalCreateResult<T>> {
    const col = await this.collection(collection);
    try {
      await col.insertOne({
        _id: id,
        ...(doc as Record<string, unknown>),
      });
      return { ok: true };
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) {
        throw error;
      }
      const current = await this.get<T>(collection, id);
      if (!current) {
        throw error;
      }
      return {
        ok: false,
        reason: 'exists',
        current,
      };
    }
  }

  async updateIfMatch<T>(
    collection: string,
    id: string,
    operation: {
      expected: JsonDocCasCondition;
      patch?: Partial<T>;
      replace?: T;
    },
  ): Promise<JsonDocConditionalUpdateResult<T>> {
    const nextPatch = operation.replace
      ? operation.replace as Record<string, unknown>
      : operation.patch as Record<string, unknown> | undefined;
    if (!nextPatch) {
      const current = await this.get<T>(collection, id);
      if (!current) {
        return { ok: false, reason: 'not_found', current: null };
      }
      if (!matchesCondition(current as Record<string, unknown>, operation.expected)) {
        return { ok: false, reason: 'condition_failed', current };
      }
      return { ok: true, doc: current };
    }

    const col = await this.collection(collection);
    const filter = buildMongoConditionalFilter(id, operation.expected);
    const result = operation.replace
      ? await col.replaceOne(filter, {
          _id: id,
          ...nextPatch,
        })
      : await col.updateOne(filter, {
          $set: nextPatch,
        });
    if (result.matchedCount > 0) {
      const updated = await this.get<T>(collection, id);
      if (!updated) {
        return { ok: false, reason: 'not_found', current: null };
      }
      return { ok: true, doc: updated };
    }

    const current = await this.get<T>(collection, id);
    return {
      ok: false,
      reason: current ? 'condition_failed' : 'not_found',
      current,
    };
  }

  async deleteIfMatch<T>(
    collection: string,
    id: string,
    operation: {
      expected: JsonDocCasCondition;
    },
  ): Promise<JsonDocConditionalDeleteResult<T>> {
    const col = await this.collection(collection);
    const result = await col.deleteOne(buildMongoConditionalFilter(id, operation.expected));
    if (result.deletedCount > 0) {
      return { ok: true, deleted: true };
    }
    const current = await this.get<T>(collection, id);
    return {
      ok: false,
      reason: current ? 'condition_failed' : 'not_found',
      current,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class InMemoryJsonDocStore implements JsonDocStorePort {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  private collection(name: string): Map<string, Record<string, unknown>> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return this.collections.get(name)!;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const doc = this.collection(collection).get(id);
    return (doc as T | undefined) ?? null;
  }

  async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    this.collection(collection).set(id, doc as Record<string, unknown>);
  }

  async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    const docs = [...this.collection(collection).values()];
    const filtered = docs.filter((doc) =>
      Object.entries(filter).every(([key, value]) => String(doc[key]) === value),
    );
    return filtered as T[];
  }

  async delete(collection: string, id: string): Promise<void> {
    this.collection(collection).delete(id);
  }

  async createIfAbsent<T>(
    collection: string,
    id: string,
    doc: T,
  ): Promise<JsonDocConditionalCreateResult<T>> {
    const col = this.collection(collection);
    const existing = col.get(id);
    if (existing) {
      return {
        ok: false,
        reason: 'exists',
        current: existing as T,
      };
    }
    col.set(id, doc as Record<string, unknown>);
    return { ok: true };
  }

  async updateIfMatch<T>(
    collection: string,
    id: string,
    operation: {
      expected: JsonDocCasCondition;
      patch?: Partial<T>;
      replace?: T;
    },
  ): Promise<JsonDocConditionalUpdateResult<T>> {
    const col = this.collection(collection);
    const existing = col.get(id);
    if (!existing) {
      return { ok: false, reason: 'not_found', current: null };
    }
    if (!matchesCondition(existing, operation.expected)) {
      return {
        ok: false,
        reason: 'condition_failed',
        current: existing as T,
      };
    }
    const next = operation.replace
      ? operation.replace as Record<string, unknown>
      : {
          ...existing,
          ...(operation.patch as Record<string, unknown> | undefined),
        };
    col.set(id, next);
    return {
      ok: true,
      doc: next as T,
    };
  }

  async deleteIfMatch<T>(
    collection: string,
    id: string,
    operation: {
      expected: JsonDocCasCondition;
    },
  ): Promise<JsonDocConditionalDeleteResult<T>> {
    const col = this.collection(collection);
    const existing = col.get(id);
    if (!existing) {
      return { ok: false, reason: 'not_found', current: null };
    }
    if (!matchesCondition(existing, operation.expected)) {
      return {
        ok: false,
        reason: 'condition_failed',
        current: existing as T,
      };
    }
    col.delete(id);
    return { ok: true, deleted: true };
  }
}

function isRetryableMongoJsonDocStoreError(error: unknown): boolean {
  if (error instanceof MongoNetworkError) {
    return true;
  }
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return false;
  }
  const { message } = error as { message?: unknown };
  return typeof message === 'string' && MONGO_TRANSIENT_MESSAGE_PATTERN.test(message);
}

function waitForMongoJsonDocStoreRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, MONGO_JSON_DOC_STORE_TRANSIENT_RETRY_DELAY_MS * (attempt + 1));
  });
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 11000
  );
}

function buildMongoConditionalFilter(
  id: string,
  expected: JsonDocCasCondition,
): Record<string, unknown> {
  return {
    _id: id,
    ...expected,
  };
}

function matchesCondition(
  doc: Record<string, unknown>,
  expected: JsonDocCasCondition,
): boolean {
  return Object.entries(expected).every(([key, expectedValue]) => (
    Object.prototype.hasOwnProperty.call(doc, key)
    && doc[key] === expectedValue
  ));
}
