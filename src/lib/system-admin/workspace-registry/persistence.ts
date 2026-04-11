import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { InMemoryJsonDocStore, MongoJsonDocStore } from '@mbos/adapters-private';
import type { JsonDocStorePort } from '@mbos/ports';
import type { SystemWorkspaceRecord } from './types';

const SYSTEM_WORKSPACE_COLLECTION = 'system_workspaces';

let sharedDocStore: JsonDocStorePort | null = null;
type StoredSystemWorkspaceRecord = SystemWorkspaceRecord;
type ClosableJsonDocStore = JsonDocStorePort & { close?: () => Promise<void> };
type StoredCollections = Record<string, Record<string, unknown>>;

class FileJsonDocStore implements JsonDocStorePort {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readCollections(): Promise<StoredCollections> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null ? parsed as StoredCollections : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeCollections(collections: StoredCollections): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(collections, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }

  private async waitForPendingWrites(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
  }

  private async acquireWriteLock(): Promise<() => Promise<void>> {
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        const handle = await open(lockPath, 'wx');
        await handle.writeFile(`${process.pid}\n`, 'utf8');
        await handle.close();
        return async () => {
          await unlink(lockPath).catch(() => undefined);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          continue;
        }
        throw error;
      }
    }
  }

  private scheduleWrite(operation: () => Promise<void>): Promise<void> {
    const pending = this.writeQueue
      .catch(() => undefined)
      .then(operation);
    this.writeQueue = pending;
    return pending;
  }

  async list<T>(collection: string): Promise<T[]> {
    await this.waitForPendingWrites();
    const collections = await this.readCollections();
    return Object.values(collections[collection] ?? {}) as T[];
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    await this.waitForPendingWrites();
    const collections = await this.readCollections();
    const record = collections[collection]?.[id];
    return (record as T | undefined) ?? null;
  }

  async upsert<T>(collection: string, id: string, record: T): Promise<void> {
    await this.scheduleWrite(async () => {
      const releaseLock = await this.acquireWriteLock();
      try {
        const collections = await this.readCollections();
        const nextCollection = {
          ...(collections[collection] ?? {}),
          [id]: record as unknown,
        };
        await this.writeCollections({
          ...collections,
          [collection]: nextCollection,
        });
      } finally {
        await releaseLock();
      }
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.scheduleWrite(async () => {
      const releaseLock = await this.acquireWriteLock();
      try {
        const collections = await this.readCollections();
        if (!collections[collection]?.[id]) {
          return;
        }
        const nextCollection = { ...(collections[collection] ?? {}) };
        delete nextCollection[id];
        await this.writeCollections({
          ...collections,
          [collection]: nextCollection,
        });
      } finally {
        await releaseLock();
      }
    });
  }

  async close(): Promise<void> {
    await Promise.resolve();
  }
}

function normalizeStoredRecord(record: StoredSystemWorkspaceRecord): SystemWorkspaceRecord {
  const legacyRecord = record as SystemWorkspaceRecord & {
    idp?: {
      kind: 'keycloak';
      url: string;
      realm: string;
      client_id: string;
      client_secret?: string;
    };
  };

  if (legacyRecord.login_idp) {
    return record;
  }

  if (!legacyRecord.idp) {
    return record;
  }

  return {
    ...record,
    login_idp: {
      kind: legacyRecord.idp.kind,
      url: legacyRecord.idp.url,
      realm: legacyRecord.idp.realm,
      client_id: legacyRecord.idp.client_id,
    },
    directory_idp: {
      client_id: legacyRecord.idp.client_id,
      client_secret: legacyRecord.idp.client_secret,
    },
  };
}

function createDocStore(): JsonDocStorePort {
  const mode = process.env.SYSTEM_WORKSPACE_REGISTRY_MODE?.trim().toLowerCase();
  const filePath = process.env.SYSTEM_WORKSPACE_REGISTRY_FILE?.trim();
  const mongoUrl = process.env.MONGO_URL?.trim();
  if (mode === 'file') {
    if (!filePath) {
      throw new Error('system_workspace_registry_file_unconfigured');
    }
    return new FileJsonDocStore(filePath);
  }
  if (mode === 'memory') {
    return new InMemoryJsonDocStore();
  }
  if (mongoUrl) {
    return new MongoJsonDocStore({
      url: mongoUrl,
      dbName: process.env.MONGO_DB_NAME ?? 'mbos',
    });
  }
  if (process.env.NODE_ENV === 'test') {
    return new InMemoryJsonDocStore();
  }
  throw new Error('system_workspace_registry_unconfigured');
}

function getDocStore(): JsonDocStorePort {
  if (!sharedDocStore) {
    sharedDocStore = createDocStore();
  }
  return sharedDocStore;
}

async function closeDocStore(docStore: JsonDocStorePort | null): Promise<void> {
  if (!docStore) {
    return;
  }
  const closableStore = docStore as ClosableJsonDocStore;
  if (typeof closableStore.close === 'function') {
    await closableStore.close();
  }
}

function sortRecords(records: SystemWorkspaceRecord[]): SystemWorkspaceRecord[] {
  return [...records].sort((left, right) => left.name.localeCompare(right.name));
}

async function listStoredRecords(docStore: JsonDocStorePort): Promise<SystemWorkspaceRecord[]> {
  const items = await docStore.list<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, {});
  return sortRecords(items.map(normalizeStoredRecord));
}

export async function ensureSystemWorkspaceRegistryReady(): Promise<JsonDocStorePort> {
  return getDocStore();
}

export async function listPersistedSystemWorkspaces(): Promise<SystemWorkspaceRecord[]> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  return listStoredRecords(docStore);
}

export async function getPersistedSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  const record = await docStore.get<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, id);
  return record ? normalizeStoredRecord(record) : null;
}

export async function upsertPersistedSystemWorkspace(record: SystemWorkspaceRecord): Promise<void> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  await docStore.upsert<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, record.id, record);
}

export async function deletePersistedSystemWorkspace(id: string): Promise<void> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  await docStore.delete(SYSTEM_WORKSPACE_COLLECTION, id);
}

export async function disposeSystemWorkspaceRegistryPersistence(): Promise<void> {
  const docStore = sharedDocStore;
  sharedDocStore = null;
  await closeDocStore(docStore);
}

export function resetSystemWorkspaceRegistryPersistenceForTest(): void {
  sharedDocStore = null;
}

export function seedPersistedSystemWorkspacesForTest(records: SystemWorkspaceRecord[]): void {
  const docStore = new InMemoryJsonDocStore();
  sharedDocStore = docStore;
  for (const record of records) {
    void docStore.upsert<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, record.id, record);
  }
}
