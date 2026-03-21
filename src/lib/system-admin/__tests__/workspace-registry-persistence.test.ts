import { afterEach, describe, expect, it, vi } from 'vitest';

async function importPersistence() {
  vi.resetModules();
  return import('../workspace-registry/persistence');
}

const envBackup = {
  NODE_ENV: process.env.NODE_ENV,
  MONGO_URL: process.env.MONGO_URL,
  SYSTEM_WORKSPACE_REGISTRY_MODE: process.env.SYSTEM_WORKSPACE_REGISTRY_MODE,
};

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = envBackup.NODE_ENV;
  process.env.MONGO_URL = envBackup.MONGO_URL;
  process.env.SYSTEM_WORKSPACE_REGISTRY_MODE = envBackup.SYSTEM_WORKSPACE_REGISTRY_MODE;
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
