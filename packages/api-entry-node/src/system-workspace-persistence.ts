import * as persistenceModule from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import type { SystemWorkspaceRecord } from '../../../src/lib/system-admin/workspace-registry/types.js';

type PersistenceModule = {
  ensureSystemWorkspaceRegistryReady: () => Promise<unknown>;
  listPersistedSystemWorkspaces: () => Promise<SystemWorkspaceRecord[]>;
  getPersistedSystemWorkspace: (id: string) => Promise<SystemWorkspaceRecord | null>;
  upsertPersistedSystemWorkspace: (record: SystemWorkspaceRecord) => Promise<void>;
  deletePersistedSystemWorkspace: (id: string) => Promise<void>;
  resetSystemWorkspaceRegistryPersistenceForTest: () => void;
  seedPersistedSystemWorkspacesForTest: (records: SystemWorkspaceRecord[]) => void;
};

function resolvePersistenceModule(moduleValue: unknown): PersistenceModule {
  const candidate = (moduleValue && typeof moduleValue === 'object'
    ? ((moduleValue as { default?: unknown }).default
      ?? (moduleValue as { 'module.exports'?: unknown })['module.exports']
      ?? moduleValue)
    : moduleValue) as Partial<PersistenceModule>;

  const requiredKeys: Array<keyof PersistenceModule> = [
    'ensureSystemWorkspaceRegistryReady',
    'listPersistedSystemWorkspaces',
    'getPersistedSystemWorkspace',
    'upsertPersistedSystemWorkspace',
    'deletePersistedSystemWorkspace',
    'resetSystemWorkspaceRegistryPersistenceForTest',
    'seedPersistedSystemWorkspacesForTest',
  ];

  for (const key of requiredKeys) {
    if (typeof candidate[key] !== 'function') {
      throw new TypeError(`system_workspace_persistence_export_invalid:${String(key)}`);
    }
  }

  return candidate as PersistenceModule;
}

const persistence = resolvePersistenceModule(persistenceModule);

export const ensureSystemWorkspaceRegistryReady = persistence.ensureSystemWorkspaceRegistryReady;
export const listPersistedSystemWorkspaces = persistence.listPersistedSystemWorkspaces;
export const getPersistedSystemWorkspace = persistence.getPersistedSystemWorkspace;
export const upsertPersistedSystemWorkspace = persistence.upsertPersistedSystemWorkspace;
export const deletePersistedSystemWorkspace = persistence.deletePersistedSystemWorkspace;
export const resetSystemWorkspaceRegistryPersistenceForTest =
  persistence.resetSystemWorkspaceRegistryPersistenceForTest;
export const seedPersistedSystemWorkspacesForTest = persistence.seedPersistedSystemWorkspacesForTest;
