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
