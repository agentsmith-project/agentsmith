import type { JsonDocStorePort } from '@mbos/ports';
import { MongoClient, type MongoClientOptions } from 'mongodb';

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

  async get<T>(collection: string, id: string): Promise<T | null> {
    const col = await this.collection(collection);
    const doc = await col.findOne({ _id: id });
    if (!doc) {
      return null;
    }

    const { _id: _ignored, ...rest } = doc;
    return rest as T;
  }

  async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    const col = await this.collection(collection);
    await col.updateOne(
      { _id: id },
      {
        $set: doc as Record<string, unknown>,
      },
      { upsert: true },
    );
  }

  async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    const col = await this.collection(collection);
    const docs = await col.find(filter).toArray();
    return docs.map((doc) => {
      const { _id: _ignored, ...rest } = doc;
      return rest as T;
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    const col = await this.collection(collection);
    await col.deleteOne({ _id: id });
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
}
