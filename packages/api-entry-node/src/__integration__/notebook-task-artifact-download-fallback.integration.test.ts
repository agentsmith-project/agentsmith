import { afterEach, describe, expect, it } from 'vitest';
import { apiFetch, apiFetchWithToken, startServer as startBaseServer } from './test-support.js';
import { notebookTaskArtifactsCollection, notebookTasksCollection } from '../notebook-task/task-store.js';
import { getTasks } from '../notebook-task/task-runtime-state.js';
import { __resetTaskFileLibraryBindingsForTests } from '../notebook-task/task-file-library-bindings.js';
import {
  configureAfscpReadyFileLibraryTestDeps,
  type InMemoryAfscpFileLibraryStorageAdapter,
} from './afscp-file-library-test-support.js';

afterEach(() => {
  __resetTaskFileLibraryBindingsForTests();
});

function startServer(): ReturnType<typeof startBaseServer> {
  const started = startBaseServer();
  configureAfscpReadyFileLibraryTestDeps(started.deps);
  return started;
}

async function createFileLibrary(baseUrl: string, name = 'Artifact Fallback Workspace'): Promise<{ id: string; name: string }> {
  const response = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

describe('api-entry-node notebook task artifact download fallback', () => {
  it('downloads metadata-only artifacts from the backing workspace file library', async () => {
    const { baseUrl, deps } = startServer();
    const workspaceLibrary = await createFileLibrary(baseUrl);
    const storageAdapter = deps.fileLibraryStorageAdapter as InMemoryAfscpFileLibraryStorageAdapter;

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_fallback', {
      id: 'task_fallback',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'Fallback Download Task',
      workspace_file_library_id: workspaceLibrary.id,
      workspace_file_library_name: workspaceLibrary.name,
      status: 'active' as const,
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    await deps.docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_fallback', {
      id: 'artifact_fallback',
      task_id: 'task_fallback',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    storageAdapter.seedFile({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: workspaceLibrary.id,
      path: 'workspace/.artifacts/result.txt',
      body: 'hello world\n',
      contentType: 'text/plain',
    });

    const response = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_fallback/artifacts/artifact_fallback/download',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toContain('result.txt');
    await expect(response.text()).resolves.toBe('hello world\n');
  });

  it('keeps artifact download fallback scoped to each task owner when artifact paths match', async () => {
    const { baseUrl, deps } = startServer();
    const ownerLibrary = await createFileLibrary(baseUrl, 'Owner Collision Workspace');
    const otherLibraryResponse = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'owner-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Other Collision Workspace' }),
      },
    );
    expect(otherLibraryResponse.status).toBe(201);
    const otherLibrary = (await otherLibraryResponse.json()) as { id: string; name: string };
    const storageAdapter = deps.fileLibraryStorageAdapter as InMemoryAfscpFileLibraryStorageAdapter;

    const now = new Date().toISOString();
    const ownerTask = {
      id: 'task_owner_artifact',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'Shared Artifact Name',
      workspace_file_library_id: ownerLibrary.id,
      workspace_file_library_name: ownerLibrary.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    const otherTask = {
      id: 'task_other_artifact',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_owner',
      title: 'Shared Artifact Name',
      workspace_file_library_id: otherLibrary.id,
      workspace_file_library_name: otherLibrary.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    getTasks('ws_default', 'proj_1').push(ownerTask, otherTask);
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), ownerTask.id, ownerTask);
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), otherTask.id, otherTask);

    await deps.docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_owner_shared', {
      id: 'artifact_owner_shared',
      task_id: 'task_owner_artifact',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 14,
      created_at: now,
    });
    await deps.docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_other_shared', {
      id: 'artifact_other_shared',
      task_id: 'task_other_artifact',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 14,
      created_at: now,
    });

    storageAdapter.seedFile({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: ownerLibrary.id,
      path: 'workspace/.artifacts/result.txt',
      body: 'owner result\n',
      contentType: 'text/plain',
    });
    storageAdapter.seedFile({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: otherLibrary.id,
      path: 'workspace/.artifacts/result.txt',
      body: 'other result\n',
      contentType: 'text/plain',
    });

    const ownerDownload = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_owner_artifact/artifacts/artifact_owner_shared/download',
      'test-token',
    );
    expect(ownerDownload.status).toBe(200);
    await expect(ownerDownload.text()).resolves.toBe('owner result\n');

    const otherDownload = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_other_artifact/artifacts/artifact_other_shared/download',
      'owner-token',
    );
    expect(otherDownload.status).toBe(200);
    await expect(otherDownload.text()).resolves.toBe('other result\n');

    const crossOwnerDownload = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_other_artifact/artifacts/artifact_other_shared/download',
      'test-token',
    );
    expect(crossOwnerDownload.status).toBe(404);
  });
});
