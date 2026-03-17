import type { JsonDocStorePort } from '@mbos/ports';
import { MongoClient } from 'mongodb';

export interface MongoJsonDocStoreOptions {
  url: string;
  dbName: string;
}

export class MongoJsonDocStore implements JsonDocStorePort {
  private readonly client: MongoClient;
  private readonly dbName: string;

  constructor(options: MongoJsonDocStoreOptions) {
    this.client = new MongoClient(options.url);
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
