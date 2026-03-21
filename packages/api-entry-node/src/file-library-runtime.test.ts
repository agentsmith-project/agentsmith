import { describe, expect, it } from 'vitest';

import { getFileLibraryRuntimeReadiness, resolveFileLibraryRuntimeConfig } from './file-library-runtime.js';

describe('file-library-runtime readiness', () => {
  it('reports missing executables and env explicitly', async () => {
    const readiness = await getFileLibraryRuntimeReadiness({
      juicefsBin: 'missing-juicefs-cli',
      mcBin: 'missing-mc-cli',
      env: {},
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.juicefs).toBe('missing');
    expect(readiness.checks.mc).toBe('missing');
    expect(readiness.checks.database_url).toBe('missing');
    expect(readiness.errors).toContain('file_library_juicefs_cli_missing');
    expect(readiness.errors).toContain('file_library_mc_cli_missing');
    expect(readiness.errors).toContain('file_library_env_missing_database_url');
    expect(readiness.errors).toContain('file_library_env_missing_minio_endpoint');
    expect(readiness.errors).toContain('file_library_env_missing_minio_access_key');
    expect(readiness.errors).toContain('file_library_env_missing_minio_secret_key');
  });

  it('separates internal provisioning endpoints from public mount endpoints', () => {
    const config = resolveFileLibraryRuntimeConfig({
      DATABASE_URL: 'postgresql://mbos:secret@postgres:5432/mbos',
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: '9000',
      MINIO_ACCESS_KEY: 'mbos',
      MINIO_SECRET_KEY: 'secret',
      FILE_LIBRARY_POSTGRES_PUBLIC_HOST: 'localhost',
      FILE_LIBRARY_POSTGRES_PUBLIC_PORT: '15432',
      FILE_LIBRARY_MINIO_PUBLIC_ENDPOINT: 'http://localhost:19000',
    });

    expect(config.pgConnectHost).toBe('postgres');
    expect(config.pgConnectPort).toBe(5432);
    expect(config.pgPublicHost).toBe('localhost');
    expect(config.pgPublicPort).toBe(15432);
    expect(config.minioStorageEndpoint).toBe('http://minio:9000');
    expect(config.minioPublicEndpoint).toBe('http://localhost:19000');
  });
});
