import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';

import {
  handleTaskRoute,
  hasBlockingTaskRunForTerminal,
  resolveTerminalWebSocketBaseUrl,
  resolveTaskWorkspaceMountAccess,
} from './task-route-handler.js';
import { buildNotebookTaskRunState, refreshNotebookTaskRunLease } from './notebook-task/task-run-coordination.js';
import { ACTIVE_RUNS_BY_TASK, ARTIFACTS_BY_TASK, TASKS_BY_PROJECT } from './notebook-task/task-runtime-state.js';
import { notebookTaskArtifactsCollection, notebookTasksCollection } from './notebook-task/task-store.js';

const { createFileLibraryGatewayClientMock } = vi.hoisted(() => ({
  createFileLibraryGatewayClientMock: vi.fn(),
}));

vi.mock('./file-library-gateway-client.js', async () => {
  const actual = await vi.importActual<typeof import('./file-library-gateway-client.js')>('./file-library-gateway-client.js');
  return {
    ...actual,
    createFileLibraryGatewayClient: createFileLibraryGatewayClientMock,
  };
});

describe('task-route-handler workspace access', () => {
  beforeEach(() => {
    ACTIVE_RUNS_BY_TASK.clear();
    ARTIFACTS_BY_TASK.clear();
    TASKS_BY_PROJECT.clear();
    createFileLibraryGatewayClientMock.mockReset();
  });

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
    const previousStorageEndpoint = process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'postgres-external.agentsmith-sandbox.svc.cluster.local';
    process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '5432';
    process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000';
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
      if (previousStorageEndpoint === undefined) delete process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
      else process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = previousStorageEndpoint;
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
    const previousDockerManualHost = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousDockerManualPort = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousDockerManualEndpoint = process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    const previousClientPgPort = process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
    const previousMinioApiPort = process.env.MINIO_API_PORT;
    process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'host.docker.internal';
    process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '15432';
    process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://host.docker.internal:19000';
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
      if (previousDockerManualHost === undefined) delete process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      else process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousDockerManualHost;
      if (previousDockerManualPort === undefined) delete process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      else process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousDockerManualPort;
      if (previousDockerManualEndpoint === undefined) delete process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      else process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousDockerManualEndpoint;
      if (previousClientPgPort === undefined) delete process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
      else process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = previousClientPgPort;
      if (previousMinioApiPort === undefined) delete process.env.MINIO_API_PORT;
      else process.env.MINIO_API_PORT = previousMinioApiPort;
    }
  });

  it('rewrites loopback mount access for internal agent execution', () => {
    const previousMetaHost = process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousMetaPort = process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousStorageEndpoint = process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'postgres-external.agentsmith-sandbox.svc.cluster.local';
    process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '5432';
    process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000';
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
        delete process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
      } else {
        process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = previousStorageEndpoint;
      }
    }
  });

  it('cancels workspace-library artifact fallback downloads when the client disconnects', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();

    await docStore.upsert('project_file_libraries', 'lib_1', {
      id: 'lib_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_1', {
      id: 'artifact_1',
      task_id: 'task_1',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 12,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockResolvedValue(objectStream),
    });

    const req = new EventEmitter() as http.IncomingMessage;
    req.headers = {};
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/artifacts/artifact_1/download';
    const res = new PassThrough() as PassThrough & http.ServerResponse;
    res.statusCode = 200;
    res.setHeader = vi.fn();

    await expect(handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        artifactId: 'artifact_1',
      } as never,
      method: 'GET',
      req,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    res.emit('close');

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('cancels artifact fallback downloads when the client already aborted before the bridge attaches listeners', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();
    await docStore.upsert('project_file_libraries', 'lib_1', {
      id: 'lib_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_1', {
      id: 'artifact_1',
      task_id: 'task_1',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    let resolveGetObject: ((stream: PassThrough) => void) | null = null;
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 12,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockImplementation(() => new Promise<PassThrough>((resolve) => {
        resolveGetObject = resolve;
      })),
    });

    const req = new EventEmitter() as http.IncomingMessage & { aborted: boolean };
    req.headers = {};
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/artifacts/artifact_1/download';
    req.aborted = false;
    const res = new PassThrough() as PassThrough & http.ServerResponse;
    res.statusCode = 200;
    res.setHeader = vi.fn();

    const routePromise = handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        artifactId: 'artifact_1',
      } as never,
      method: 'GET',
      req,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    req.aborted = true;
    req.emit('aborted');
    resolveGetObject?.(objectStream);

    await expect(routePromise).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
