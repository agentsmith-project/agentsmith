import { describe, expect, it } from 'vitest';

import {
  resolveFileLibraryMetadataUrlForDockerManualExternalExecution,
  getFileLibraryRuntimeReadiness,
  resolveFileLibraryMetadataUrlForComposeManagedExternalExecution,
  resolveFileLibraryMetadataUrlForExternalExecution,
  resolveFileLibraryMetadataUrlForInternalExecution,
  resolveFileLibraryRuntimeConfig,
  resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution,
  resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution,
  resolveFileLibraryStorageBucketUrlForExternalExecution,
  resolveFileLibraryStorageBucketUrlForInternalExecution,
} from './file-library-runtime.js';

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
      FILE_LIBRARY_CLIENT_POSTGRES_HOST: 'files.example.com',
      FILE_LIBRARY_CLIENT_POSTGRES_PORT: '15432',
      FILE_LIBRARY_CLIENT_MINIO_ENDPOINT: 'https://files.example.com:19000',
    });

    expect(config.pgConnectHost).toBe('postgres');
    expect(config.pgConnectPort).toBe(5432);
    expect(config.pgClientHost).toBe('files.example.com');
    expect(config.pgClientPort).toBe(15432);
    expect(config.minioStorageEndpoint).toBe('http://minio:9000');
    expect(config.minioClientEndpoint).toBe('https://files.example.com:19000');
  });

  it('rewrites loopback file library access for external runner execution', () => {
    const env = {
      EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL: 'http://172.18.0.1:20000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForExternalExecution(
        'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@172.18.0.1:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForExternalExecution(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://172.18.0.1:19000/jfs-lib-demo');
  });

  it('prefers explicit external runner JuiceFS overrides over execution API host inference', () => {
    const env = {
      EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL: 'http://host.docker.internal:20000',
      EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: '192.168.0.220',
      EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: '15432',
      EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE: 'http://192.168.0.220:19000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForExternalExecution(
        'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForExternalExecution(
        'https://files.example.com:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://192.168.0.220:19000/jfs-lib-demo');
  });

  it('rewrites loopback file library access for compose-managed external runner execution', () => {
    const env = {
      DATABASE_URL: 'postgresql://mbos:secret@postgres:5432/mbos',
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: '9000',
      MINIO_USE_SSL: 'false',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForComposeManagedExternalExecution(
        'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@postgres:5432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://minio:9000/jfs-lib-demo');
  });

  it('rewrites client-visible file library access for docker-manual external runner execution', () => {
    const env = {
      FILE_LIBRARY_CLIENT_POSTGRES_PORT: '15432',
      MINIO_API_PORT: '19000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForDockerManualExternalExecution(
        'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@127.0.0.1:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution(
        'http://192.168.0.220:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://127.0.0.1:19000/jfs-lib-demo');
  });

  it('preserves non-loopback file library access for external runner execution', () => {
    const env = {
      EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL: 'http://172.18.0.1:20000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForExternalExecution(
        'postgres://jfsu_user:secret@postgres.example.internal:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@172.18.0.1:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForExternalExecution(
        'http://minio.example.internal:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://172.18.0.1:19000/jfs-lib-demo');
  });

  it('rewrites loopback file library access for internal agent execution', () => {
    const env = {
      INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: 'postgres-external.agentsmith-sandbox.svc.cluster.local',
      INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: '5432',
      INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForInternalExecution(
        'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForInternalExecution(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo');
  });

  it('rewrites client-visible file library access for internal agent execution', () => {
    const env = {
      INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: 'postgres-external.agentsmith-sandbox.svc.cluster.local',
      INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: '5432',
      INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForInternalExecution(
        'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForInternalExecution(
        'https://files.example.com:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo');
  });
});
