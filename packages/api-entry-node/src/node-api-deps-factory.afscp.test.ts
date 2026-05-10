import { afterEach, describe, expect, it, vi } from 'vitest';
import { AfscpConfigError } from './afscp-config.js';
import { createNodeApiDepsFromEnv } from './node-api-deps-factory.js';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
};

async function shutdownSafe(lifecycle: { shutdown: () => Promise<void> | void }): Promise<void> {
  await lifecycle.shutdown();
}

function readRuntimeProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return property in value ? (value as Record<string, unknown>)[property] : undefined;
}

describe('createNodeApiDepsFromEnv AFSCP wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses no-op project storage bootstrap when AFSCP env is absent', async () => {
    const { deps, lifecycle } = createNodeApiDepsFromEnv({ ...baseEnv });
    try {
      expect('afscpClient' in deps).toBe(false);
      expect(deps.projectStorageBootstrapService.enabled).toBe(false);
      expect(typeof deps.projectStorageBootstrapService.ensureProjectStorageReady).toBe('function');
      expect(deps.afscpResourceOwnershipGuard.enabled).toBe(false);
      expect(deps.fileLibraryStorageAdapter?.enabled).toBe(false);
      expect(readRuntimeProperty(deps, 'fileLibraryOrchestrator')).toBeUndefined();
      expect(readRuntimeProperty(deps, 'fileLibraryGatewayManager')).toBeUndefined();
    } finally {
      await shutdownSafe(lifecycle);
    }
  });

  it('wires AFSCP client, bootstrap service, namespace store, and ownership guard when env is complete', async () => {
    const { deps, lifecycle } = createNodeApiDepsFromEnv({
      ...baseEnv,
      AFSCP_BASE_URL: 'https://afscp.internal/api',
      AFSCP_CALLER_SERVICE: 'agentsmith-api',
      AFSCP_SERVICE_TOKEN: 'svc-secret-token',
      AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-secret-token',
      AFSCP_DEFAULT_VOLUME_ID: 'vol_default',
      AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
    });
    try {
      expect('afscpClient' in deps).toBe(false);
      expect(deps.projectAfscpNamespaceStore).toBeDefined();
      expect(deps.projectStorageBootstrapService.enabled).toBe(true);
      expect(typeof deps.projectStorageBootstrapService.ensureProjectStorageReady).toBe('function');
      expect(deps.afscpResourceOwnershipGuard.enabled).toBe(true);
      expect(deps.fileLibraryStorageAdapter?.enabled).toBe(true);
      const productClient = readRuntimeProperty(deps.fileLibraryStorageAdapter, 'client');
      expect(readRuntimeProperty(productClient, 'upsertNamespace')).toBeUndefined();
      expect(readRuntimeProperty(productClient, 'putNamespaceVolumeBinding')).toBeUndefined();
      expect(readRuntimeProperty(deps, 'fileLibraryOrchestrator')).toBeUndefined();
      expect(readRuntimeProperty(deps, 'fileLibraryGatewayManager')).toBeUndefined();
    } finally {
      await shutdownSafe(lifecycle);
    }
  });

  it('does not enable the legacy per-library JuiceFS runtime from DATABASE_URL or MINIO env', async () => {
    const { deps, lifecycle } = createNodeApiDepsFromEnv({
      ...baseEnv,
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/agentsmith',
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: '19000',
      MINIO_ACCESS_KEY: 'minio-access',
      MINIO_SECRET_KEY: 'minio-secret',
      });
    try {
      expect(deps.fileLibraryStorageAdapter?.enabled).toBe(false);
      expect(readRuntimeProperty(deps, 'fileLibraryOrchestrator')).toBeUndefined();
      expect(readRuntimeProperty(deps, 'fileLibraryGatewayManager')).toBeUndefined();
    } finally {
      await shutdownSafe(lifecycle);
    }
  });

  it('fails fast with the AFSCP config error when env is partial', () => {
    expect(() => createNodeApiDepsFromEnv({
      ...baseEnv,
      AFSCP_BASE_URL: 'https://afscp.internal',
      AFSCP_SERVICE_TOKEN: 'svc-secret-token',
    })).toThrow(AfscpConfigError);
  });

  it('fails fast when AFSCP bootstrap caller is missing', () => {
    let caught: unknown;
    try {
      createNodeApiDepsFromEnv({
        ...baseEnv,
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-secret-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-secret-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_default',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INCOMPLETE',
      missing: ['AFSCP_BOOTSTRAP_CALLER_SERVICE'],
    });
    expect(JSON.stringify(caught)).not.toContain('svc-secret-token');
  });

  it('fails fast when AFSCP bootstrap caller is not separated from product caller', () => {
    let caught: unknown;
    try {
      createNodeApiDepsFromEnv({
        ...baseEnv,
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-secret-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-secret-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_default',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-api',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BOOTSTRAP_CALLER_SERVICE'],
    });
    expect(JSON.stringify(caught)).not.toContain('svc-secret-token');
  });

  it('fails fast when AFSCP product and bootstrap tokens are the same', () => {
    let caught: unknown;
    try {
      createNodeApiDepsFromEnv({
        ...baseEnv,
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'same-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'same-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_default',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BOOTSTRAP_SERVICE_TOKEN'],
    });
    expect(JSON.stringify(caught)).not.toContain('same-token');
  });
});
