import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function importPersistence() {
  vi.resetModules();
  return import('../workspace-registry/persistence');
}

const envBackup = {
  NODE_ENV: process.env.NODE_ENV,
  MONGO_URL: process.env.MONGO_URL,
  SYSTEM_WORKSPACE_REGISTRY_MODE: process.env.SYSTEM_WORKSPACE_REGISTRY_MODE,
  SYSTEM_WORKSPACE_REGISTRY_FILE: process.env.SYSTEM_WORKSPACE_REGISTRY_FILE,
};

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = envBackup.NODE_ENV;
  process.env.MONGO_URL = envBackup.MONGO_URL;
  process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = envBackup.SYSTEM_WORKSPACE_REGISTRY_MODE;
  process.env.SYSTEM_WORKSPACE_REGISTRY_FILE = envBackup.SYSTEM_WORKSPACE_REGISTRY_FILE;
  vi.doUnmock('@mbos/adapters-private');
  vi.restoreAllMocks();
});

describe('system workspace registry persistence', () => {
  it('uses in-memory storage in explicit memory mode', async () => {
    process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = 'memory';
    process.env.MONGO_URL = '';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const persistence = await importPersistence();
    await expect(persistence.ensureSystemWorkspaceRegistryReady()).resolves.toBeTruthy();
  });

  it('uses file-backed storage in explicit file mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agentsmith-workspace-registry-'));
    const filePath = join(tempDir, 'system-workspaces.json');
    process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = 'file';
    process.env.SYSTEM_WORKSPACE_REGISTRY_FILE = filePath;
    process.env.MONGO_URL = '';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const persistence = await importPersistence();
    await persistence.upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      workspace_admin_user_id: 'owner',
      workspace_admin_name: 'Owner',
      workspace_admin_binding_required: false,
      project_creators: [],
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'main',
        client_id: 'agentsmith-web',
      },
      directory_idp: {
        client_id: 'agentsmith-web',
      },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        substrate_label: 'primary',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    await expect(persistence.listPersistedSystemWorkspaces()).resolves.toHaveLength(1);
    await expect(readFile(filePath, 'utf8')).resolves.toContain('ws_default');
  });

  it('serializes concurrent file-backed writes across isolated module instances so records are not lost', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agentsmith-workspace-registry-'));
    const filePath = join(tempDir, 'system-workspaces.json');
    process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = 'file';
    process.env.SYSTEM_WORKSPACE_REGISTRY_FILE = filePath;
    process.env.MONGO_URL = '';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const persistence = await importPersistence();
    const importSecondPersistence = async () => {
      vi.resetModules();
      return import('../workspace-registry/persistence');
    };
    const secondPersistence = await importSecondPersistence();
    const createRecord = (id: string) => ({
      id,
      name: `Workspace ${id}`,
      workspace_admin: 'owner@example.com',
      workspace_admin_user_id: 'owner',
      workspace_admin_name: 'Owner',
      workspace_admin_binding_required: false,
      project_creators: [],
      login_idp: {
        kind: 'keycloak' as const,
        url: 'https://login.example.com',
        realm: 'main',
        client_id: 'agentsmith-web',
      },
      directory_idp: {
        client_id: 'agentsmith-web',
      },
      tenant: {
        workspace_id: id,
        workspace_name: `Workspace ${id}`,
        substrate_label: 'primary',
        database_name: `agentsmith_${id}`,
        collection_prefix: `${id}_`,
        key_prefix: `${id}:`,
      },
      provisioning_status: 'ready' as const,
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    await Promise.all([
      persistence.upsertPersistedSystemWorkspace(createRecord('ws_alpha')),
      secondPersistence.upsertPersistedSystemWorkspace(createRecord('ws_beta')),
    ]);

    await expect(persistence.listPersistedSystemWorkspaces()).resolves.toHaveLength(2);
    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).toContain('ws_alpha');
    expect(persisted).toContain('ws_beta');
  });

  it('uses mongo-backed storage when MONGO_URL is configured', async () => {
    process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = '';
    process.env.MONGO_URL = 'mongodb://example.com:27017/admin';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const persistence = await importPersistence();
    await expect(persistence.ensureSystemWorkspaceRegistryReady()).resolves.toBeTruthy();
  });

  it('fails fast outside test mode when shared registry persistence is unconfigured', async () => {
    process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = '';
    process.env.MONGO_URL = '';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const persistence = await importPersistence();
    await expect(persistence.ensureSystemWorkspaceRegistryReady()).rejects.toThrow(
      'system_workspace_registry_unconfigured',
    );
  });

  it('disposes closable mongo-backed storage for CLI-style callers', async () => {
    const close = vi.fn(async () => undefined);
    vi.doMock('@mbos/adapters-private', () => ({
      InMemoryJsonDocStore: class {},
      MongoJsonDocStore: class {
        async get() { return null; }
        async upsert() {}
        async list() { return []; }
        async delete() {}
        close = close;
      },
    }));

    process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = '';
    process.env.MONGO_URL = 'mongodb://example.com:27017/admin';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const persistence = await importPersistence();
    await persistence.ensureSystemWorkspaceRegistryReady();
    await persistence.disposeSystemWorkspaceRegistryPersistence();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
