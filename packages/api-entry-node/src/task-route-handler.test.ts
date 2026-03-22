import { describe, expect, it } from 'vitest';

import { resolveTaskWorkspaceMountAccess } from './task-route-handler.js';

describe('task-route-handler workspace access', () => {
  it('keeps local mount access untouched for non-external agents', () => {
    const resolved = resolveTaskWorkspaceMountAccess({
      agentMode: 'internal',
      metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
    });

    expect(resolved).toEqual({
      metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
    });
  });

  it('rewrites loopback mount access for external runner execution', () => {
    const previousExternalExecutionBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://172.18.0.1:20000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'external',
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@172.18.0.1:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://172.18.0.1:19000/jfs-lib-demo',
      });
    } finally {
      if (previousExternalExecutionBase === undefined) {
        delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      }
    }
  });

  it('rewrites non-loopback mount access to the docker-manual runner host', () => {
    const previousExternalExecutionBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'external',
        metadataUrl: 'postgres://jfsu_user:secret@mbos.imotion.ai:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://mbos.imotion.ai:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@host.docker.internal:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://host.docker.internal:19000/jfs-lib-demo',
      });
    } finally {
      if (previousExternalExecutionBase === undefined) {
        delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      }
    }
  });

  it('rewrites loopback mount access for compose-managed external runner execution', () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousMinioEndpoint = process.env.MINIO_ENDPOINT;
    const previousMinioPort = process.env.MINIO_PORT;
    const previousMinioUseSsl = process.env.MINIO_USE_SSL;
    process.env.DATABASE_URL = 'postgresql://mbos:secret@postgres:5432/mbos';
    process.env.MINIO_ENDPOINT = 'minio';
    process.env.MINIO_PORT = '9000';
    process.env.MINIO_USE_SSL = 'false';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'external',
        agentConfig: {
          runner_runtime: 'compose_managed',
        },
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@postgres:5432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://minio:9000/jfs-lib-demo',
      });
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousMinioEndpoint === undefined) delete process.env.MINIO_ENDPOINT;
      else process.env.MINIO_ENDPOINT = previousMinioEndpoint;
      if (previousMinioPort === undefined) delete process.env.MINIO_PORT;
      else process.env.MINIO_PORT = previousMinioPort;
      if (previousMinioUseSsl === undefined) delete process.env.MINIO_USE_SSL;
      else process.env.MINIO_USE_SSL = previousMinioUseSsl;
    }
  });

  it('rewrites loopback mount access for internal agent execution', () => {
    const previousMetaHost = process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousStorageEndpoint = process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = '10.88.0.1';
    process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://10.88.0.1:19000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'internal',
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@10.88.0.1:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://10.88.0.1:19000/jfs-lib-demo',
      });
    } finally {
      if (previousMetaHost === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousMetaHost;
      }
      if (previousStorageEndpoint === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousStorageEndpoint;
      }
    }
  });
});
