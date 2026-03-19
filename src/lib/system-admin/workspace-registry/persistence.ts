import { InMemoryJsonDocStore, MongoJsonDocStore } from '@mbos/adapters-private';
import type { JsonDocStorePort } from '@mbos/ports';
import type { SystemWorkspaceRecord } from './types';
import { readRegistryFile, writeRegistryFile } from './storage';

const SYSTEM_WORKSPACE_COLLECTION = 'system_workspaces';

let sharedDocStore: JsonDocStorePort | null = null;
let legacyImportPromise: Promise<void> | null = null;

type StoredSystemWorkspaceRecord = SystemWorkspaceRecord & {
  legacy_registry_imported_at?: string | null;
};

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
  return sortRecords(items.map(({ legacy_registry_imported_at: _ignored, ...record }) => record));
}

async function mirrorRegistryFile(docStore: JsonDocStorePort): Promise<void> {
  await writeRegistryFile(await listStoredRecords(docStore));
}

async function importLegacyRegistryFileIfNeeded(docStore: JsonDocStorePort): Promise<void> {
  const existing = await docStore.list<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, {});
  if (existing.length > 0) {
    return;
  }
  const legacyRecords = await readRegistryFile();
  if (legacyRecords.length === 0) {
    return;
  }
  const importedAt = new Date().toISOString();
  await Promise.all(
    legacyRecords.map((record) =>
      docStore.upsert<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, record.id, {
        ...record,
        legacy_registry_imported_at: importedAt,
      })),
  );
  await mirrorRegistryFile(docStore);
}

export async function ensureSystemWorkspaceRegistryReady(): Promise<JsonDocStorePort> {
  const docStore = getDocStore();
  if (!legacyImportPromise) {
    legacyImportPromise = importLegacyRegistryFileIfNeeded(docStore).finally(() => {
      legacyImportPromise = null;
    });
  }
  await legacyImportPromise;
  return docStore;
}

export async function listPersistedSystemWorkspaces(): Promise<SystemWorkspaceRecord[]> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  return listStoredRecords(docStore);
}

export async function getPersistedSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  const record = await docStore.get<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, id);
  if (!record) return null;
  const { legacy_registry_imported_at: _ignored, ...workspace } = record;
  return workspace;
}

export async function upsertPersistedSystemWorkspace(record: SystemWorkspaceRecord): Promise<void> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  await docStore.upsert<StoredSystemWorkspaceRecord>(SYSTEM_WORKSPACE_COLLECTION, record.id, record);
  await mirrorRegistryFile(docStore);
}

export async function deletePersistedSystemWorkspace(id: string): Promise<void> {
  const docStore = await ensureSystemWorkspaceRegistryReady();
  await docStore.delete(SYSTEM_WORKSPACE_COLLECTION, id);
  await mirrorRegistryFile(docStore);
}

export function resetSystemWorkspaceRegistryPersistenceForTest(): void {
  sharedDocStore = null;
  legacyImportPromise = null;
}
