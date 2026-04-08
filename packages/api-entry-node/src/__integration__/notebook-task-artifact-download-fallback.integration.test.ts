import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiFetchWithToken, startServer } from './test-support.js';
import { notebookTaskArtifactsCollection, notebookTasksCollection } from '../notebook-task/task-store.js';
import { getTasks } from '../notebook-task/task-runtime-state.js';

const { createFileLibraryGatewayClientMock } = vi.hoisted(() => ({
  createFileLibraryGatewayClientMock: vi.fn(),
}));

vi.mock('../file-library-gateway-client.js', async () => {
  const actual = await vi.importActual<typeof import('../file-library-gateway-client.js')>('../file-library-gateway-client.js');
  return {
    ...actual,
    createFileLibraryGatewayClient: createFileLibraryGatewayClientMock,
  };
});

afterEach(() => {
  createFileLibraryGatewayClientMock.mockReset();
});

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

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_fallback', {
      id: 'task_fallback',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'Fallback Download Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: workspaceLibrary.id,
      workspace_file_library_name: workspaceLibrary.name,
      status: 'active',
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

    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 12,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockResolvedValue(Readable.from(Buffer.from('hello world\n', 'utf-8'))),
    });

    const response = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_fallback/artifacts/artifact_fallback/download',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toContain('result.txt');
    await expect(response.text()).resolves.toBe('hello world\n');
    expect(createFileLibraryGatewayClientMock).toHaveBeenCalledTimes(1);
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

    const now = new Date().toISOString();
    const ownerTask = {
      id: 'task_owner_artifact',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'Shared Artifact Name',
      agent_id: 'agent_owner',
      agent_name: 'Owner Agent',
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
      agent_id: 'agent_other',
      agent_name: 'Other Agent',
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

    createFileLibraryGatewayClientMock.mockImplementation(async (args: { libraryId: string; filesystemName: string }) => {
      const body = args.libraryId === ownerLibrary.id ? 'owner result\n' : 'other result\n';
      return {
        statObject: vi.fn().mockResolvedValue({
          size: body.length,
          metaData: { 'content-type': 'text/plain' },
        }),
        getObject: vi.fn().mockResolvedValue(Readable.from(Buffer.from(body, 'utf-8'))),
      };
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

    expect(createFileLibraryGatewayClientMock).toHaveBeenCalledTimes(2);
    expect(createFileLibraryGatewayClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ libraryId: ownerLibrary.id }),
    );
    expect(createFileLibraryGatewayClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ libraryId: otherLibrary.id }),
    );
  });
});
