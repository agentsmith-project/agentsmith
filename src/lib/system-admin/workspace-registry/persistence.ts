import { InMemoryJsonDocStore, MongoJsonDocStore } from '@mbos/adapters-private';
import type { JsonDocStorePort } from '@mbos/ports';
import type { SystemWorkspaceRecord } from './types';

const SYSTEM_WORKSPACE_COLLECTION = 'system_workspaces';

let sharedDocStore: JsonDocStorePort | null = null;
type StoredSystemWorkspaceRecord = SystemWorkspaceRecord;

function createDocStore(): JsonDocStorePort {
  const mongoUrl = process.env.MONGO_URL?.trim();
  if (mongoUrl) {
    return new MongoJsonDocStore({
      url: mongoUrl,
      dbName: process.env.MONGO_DB_NAME ?? 'mbos',
    });
  }
  return new InMemoryJsonDocStore();
}

function getDocStore(): JsonDocStorePort {
  if (!sharedDocStore) {
    sharedDocStore = createDocStore();
  }
  return sharedDocStore;
}

function sortRecords(records: SystemWorkspaceRecord[]): SystemWorkspaceRecord[] {
  return [...records].sort((left, right) => left.name.localeCompare(right.name));
}

async function listStoredRecords(docStore: JsonDocStorePort): Promise<SystemWorkspaceRecord[]> {
  const items = await docStore.list<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, {});
  return sortRecords(items);
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
  return record ?? null;
}

export async function upsertPersistedSystemWorkspace(record: SystemWorkspaceRecord): Promise<void> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  await docStore.upsert<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, record.id, record);
}

export async function deletePersistedSystemWorkspace(id: string): Promise<void> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  await docStore.delete(SYSTEM_WORKSPACE_COLLECTION, id);
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
