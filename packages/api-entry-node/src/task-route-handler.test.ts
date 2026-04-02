import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';

import {
  hasBlockingTaskRunForTerminal,
  resolveTerminalWebSocketBaseUrl,
  resolveTaskWorkspaceMountAccess,
} from './task-route-handler.js';
import { buildNotebookTaskRunState, refreshNotebookTaskRunLease } from './notebook-task/task-run-coordination.js';
import { ACTIVE_RUNS_BY_TASK } from './notebook-task/task-runtime-state.js';

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

  it('clears stale in-memory active runs before terminal creation checks', async () => {
    const cache = new InMemoryCache();
    ACTIVE_RUNS_BY_TASK.add('task_terminal');

    await expect(hasBlockingTaskRunForTerminal(cache, 'task_terminal')).resolves.toBe(false);
    expect(ACTIVE_RUNS_BY_TASK.has('task_terminal')).toBe(false);
  });

  it('keeps blocking terminal creation when shared run state still exists', async () => {
    const cache = new InMemoryCache();
    ACTIVE_RUNS_BY_TASK.add('task_terminal_busy');
    await refreshNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: 'task_terminal_busy',
      runId: 'run_1',
      startedAt: '2026-04-02T08:00:00.000Z',
    }));

    await expect(hasBlockingTaskRunForTerminal(cache, 'task_terminal_busy')).resolves.toBe(true);
    expect(ACTIVE_RUNS_BY_TASK.has('task_terminal_busy')).toBe(true);
  });

  it('prefers the configured public api base for terminal websocket urls', () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:21000/';
    try {
      const resolved = resolveTerminalWebSocketBaseUrl({
        headers: {
          host: 'localhost:3101',
          'x-forwarded-host': 'localhost:3101',
          'x-forwarded-proto': 'http',
        },
      } as never);

      expect(resolved).toBe('ws://localhost:21000');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('rewrites client-visible mount access for internal agents when internal overrides are configured', () => {
    const previousMetaHost = process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousMetaPort = process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousStorageEndpoint = process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'postgres-external.agentsmith-sandbox.svc.cluster.local';
    process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '5432';
    process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'internal',
        metadataUrl: 'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'https://files.example.com:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo',
      });
    } finally {
      if (previousMetaHost === undefined) delete process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      else process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousMetaHost;
      if (previousMetaPort === undefined) delete process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      else process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousMetaPort;
      if (previousStorageEndpoint === undefined) delete process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      else process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousStorageEndpoint;
    }
  });

  it('rewrites loopback mount access for external runner execution', () => {
    const previousExternalExecutionBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://172.18.0.1:20000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'external',
        agentConfig: {
          runner_runtime: 'dev_direct',
        },
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
        agentConfig: {
          runner_runtime: 'dev_direct',
        },
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

  it('prefers explicit external runner JuiceFS overrides when configured', () => {
    const previousExternalExecutionBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    const previousExternalMetaHost = process.env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousExternalMetaPort = process.env.EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousExternalStorageEndpoint = process.env.EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';
    process.env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = '192.168.0.220';
    process.env.EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '15432';
    process.env.EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://192.168.0.220:19000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'external',
        agentConfig: {
          runner_runtime: 'dev_direct',
        },
        metadataUrl: 'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://files.example.com:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://192.168.0.220:19000/jfs-lib-demo',
      });
    } finally {
      if (previousExternalExecutionBase === undefined) delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      if (previousExternalMetaHost === undefined) delete process.env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      else process.env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousExternalMetaHost;
      if (previousExternalMetaPort === undefined) delete process.env.EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      else process.env.EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousExternalMetaPort;
      if (previousExternalStorageEndpoint === undefined) delete process.env.EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      else process.env.EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousExternalStorageEndpoint;
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

  it('rewrites client-visible mount access for docker-manual external runner execution', () => {
    const previousClientPgPort = process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
    const previousMinioApiPort = process.env.MINIO_API_PORT;
    process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = '15432';
    process.env.MINIO_API_PORT = '19000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'external',
        agentConfig: {
          runner_runtime: 'docker_manual',
        },
        metadataUrl: 'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://192.168.0.220:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@host.docker.internal:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://host.docker.internal:19000/jfs-lib-demo',
      });
    } finally {
      if (previousClientPgPort === undefined) delete process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
      else process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = previousClientPgPort;
      if (previousMinioApiPort === undefined) delete process.env.MINIO_API_PORT;
      else process.env.MINIO_API_PORT = previousMinioApiPort;
    }
  });

  it('rewrites loopback mount access for internal agent execution', () => {
    const previousMetaHost = process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousMetaPort = process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousStorageEndpoint = process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'postgres-external.agentsmith-sandbox.svc.cluster.local';
    process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '5432';
    process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        agentMode: 'internal',
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo',
      });
    } finally {
      if (previousMetaHost === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousMetaHost;
      }
      if (previousMetaPort === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousMetaPort;
      }
      if (previousStorageEndpoint === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousStorageEndpoint;
      }
    }
  });
});
