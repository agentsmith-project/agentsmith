import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';

import { fileHandlers } from '@/mocks/handlers/files';
import { taskHandlers } from '@/mocks/handlers/tasks';

const server = setupServer(...fileHandlers, ...taskHandlers);
const baseUrl = 'http://localhost/api/v1/workspaces/ws_default/projects/proj_001';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function postJson(path: string, body?: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

async function postJsonWithIdempotency(path: string, body: Record<string, unknown>, idempotencyKey: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function uploadTextFile(libraryId: string, name: string, content: string) {
  const boundary = `agentsmith-test-${Date.now()}`;
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${name}"`,
    'Content-Type: text/plain',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return fetch(`${baseUrl}/file-libraries/${libraryId}/upload`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function listEntryNames(libraryId: string) {
  const response = await fetch(`${baseUrl}/file-libraries/${libraryId}/entries`);
  expect(response.status).toBe(200);
  const payload = await response.json() as { items?: Array<{ name?: string }> };
  return (payload.items ?? []).map((item) => item.name);
}

async function downloadTextFile(libraryId: string, path: string) {
  const response = await fetch(`${baseUrl}/file-libraries/${libraryId}/download?path=${encodeURIComponent(path)}`);
  expect(response.status).toBe(200);
  return response.text();
}

async function deletePaths(libraryId: string, paths: string[]) {
  return postJson(`/file-libraries/${libraryId}/delete`, { paths });
}

async function createSavePointAndReadFirst(libraryId: string, message: string) {
  const save = await postJsonWithIdempotency(
    `/file-libraries/${libraryId}/save-points`,
    { message },
    `save-point-${libraryId}-${message}`,
  );
  expect(save.status).toBe(202);
  await expect(save.json()).resolves.toMatchObject({
    kind: 'save_point_create',
    status: expect.stringMatching(/^(accepted|running|succeeded)$/),
    file_library_id: libraryId,
    message,
  });
  const active = await fetch(`${baseUrl}/file-libraries/${libraryId}/operations/active`);
  expect(active.status).toBe(200);
  await expect(active.json()).resolves.toMatchObject({
    operation: expect.objectContaining({
      kind: 'save_point_create',
      file_library_id: libraryId,
    }),
  });
  const list = await fetch(`${baseUrl}/file-libraries/${libraryId}/save-points`);
  expect(list.status).toBe(200);
  const listBody = await list.json() as { items?: Array<{ id?: string; file_library_id?: string; message?: string }> };
  const savePoint = (listBody.items ?? []).find((item) => item.message === message);
  expect(savePoint).toMatchObject({
    file_library_id: libraryId,
    message,
  });
  return savePoint ?? {};
}

async function getFileLibrary(libraryId: string) {
  const response = await fetch(`${baseUrl}/file-libraries/${libraryId}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    id: string;
    task_home_binding_status: 'bound' | 'unbound';
    bound_task_visible: boolean;
    bound_task_id?: string;
    bound_task_title?: string;
    bound_task_status?: 'active' | 'archived';
  }>;
}

describe('file-library recovery and task-template MSW contracts', () => {
  it('matches backend validation status when save point creation omits Idempotency-Key', async () => {
    const response = await postJson('/file-libraries/lib_shared_default/save-points', {
      message: 'Missing idempotency key',
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message: 'idempotency_key_required',
    });
  });

  it('reuses one mock save point operation and save point for repeated Idempotency-Key', async () => {
    const library = await postJson('/file-libraries', {
      name: `Save point idempotent ${Date.now()}`,
    });
    expect(library.status).toBe(201);
    const libraryPayload = await library.json() as { id?: string };
    const libraryId = libraryPayload.id ?? '';

    const first = await postJsonWithIdempotency(
      `/file-libraries/${libraryId}/save-points`,
      { message: 'Before idempotent save' },
      'msw-save-point-key-repeat',
    );
    expect(first.status).toBe(202);
    const firstPayload = await first.json() as { id?: string; message?: string };

    const second = await postJsonWithIdempotency(
      `/file-libraries/${libraryId}/save-points`,
      { message: 'Retry should not create a second point' },
      'msw-save-point-key-repeat',
    );
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({
      id: firstPayload.id,
      message: 'Before idempotent save',
    });

    const list = await fetch(`${baseUrl}/file-libraries/${libraryId}/save-points`);
    expect(list.status).toBe(200);
    const listBody = await list.json() as { items?: Array<{ message?: string }> };
    expect((listBody.items ?? []).filter((item) => item.message === 'Before idempotent save')).toHaveLength(1);
    expect((listBody.items ?? []).filter((item) => item.message === 'Retry should not create a second point')).toHaveLength(0);

    const firstActive = await fetch(`${baseUrl}/file-libraries/${libraryId}/operations/active`);
    expect(firstActive.status).toBe(200);
    await expect(firstActive.json()).resolves.toMatchObject({
      operation: expect.objectContaining({
        id: firstPayload.id,
        kind: 'save_point_create',
        status: 'running',
      }),
    });

    const converged = await fetch(`${baseUrl}/file-libraries/${libraryId}/operations/active`);
    expect(converged.status).toBe(200);
    await expect(converged.json()).resolves.toEqual({ operation: null });
  });

  it('creates save points and restores file-library contents through direct restore without hidden save points', async () => {
    const libraryId = 'lib_shared_default';
    const before = await uploadTextFile(libraryId, 'direct-restore-target.txt', 'before restore');
    expect(before.status, await before.text()).toBe(201);
    const savePoint = await createSavePointAndReadFirst(libraryId, 'Before temporary change');

    const deleteOriginal = await deletePaths(libraryId, ['direct-restore-target.txt']);
    expect(deleteOriginal.status, await deleteOriginal.text()).toBe(200);
    const mutation = await uploadTextFile(libraryId, 'direct-restore-target.txt', 'after restore');
    expect(mutation.status, await mutation.text()).toBe(201);
    const afterOnly = await uploadTextFile(libraryId, 'post-savepoint-only.txt', 'remove me');
    expect(afterOnly.status, await afterOnly.text()).toBe(201);
    await expect(downloadTextFile(libraryId, 'direct-restore-target.txt')).resolves.toBe('after restore');
    await expect(listEntryNames(libraryId)).resolves.toContain('post-savepoint-only.txt');

    const savePointListBefore = await fetch(`${baseUrl}/file-libraries/${libraryId}/save-points`);
    expect(savePointListBefore.status).toBe(200);
    const savePointIdsBefore = new Set(
      ((await savePointListBefore.json()) as { items?: Array<{ id?: string }> }).items?.map((item) => item.id) ?? [],
    );

    const restore = await postJsonWithIdempotency(`/file-libraries/${libraryId}/restore`, {
      save_point_id: savePoint.id,
    }, 'msw-direct-restore-key-1');
    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({
      source_save_point_id: savePoint.id,
      status: 'succeeded',
    });
    const activeAfterTerminalRestore = await fetch(`${baseUrl}/file-libraries/${libraryId}/operations/active`);
    expect(activeAfterTerminalRestore.status).toBe(200);
    await expect(activeAfterTerminalRestore.json()).resolves.toMatchObject({
      operation: expect.objectContaining({
        kind: 'restore',
        source_save_point_id: savePoint.id,
        status: 'succeeded',
      }),
    });

    await expect(downloadTextFile(libraryId, 'direct-restore-target.txt')).resolves.toBe('before restore');
    await expect(listEntryNames(libraryId)).resolves.not.toContain('post-savepoint-only.txt');

    const savePointListAfter = await fetch(`${baseUrl}/file-libraries/${libraryId}/save-points`);
    expect(savePointListAfter.status).toBe(200);
    const savePointIdsAfter = new Set(
      ((await savePointListAfter.json()) as { items?: Array<{ id?: string }> }).items?.map((item) => item.id) ?? [],
    );
    expect(savePointIdsAfter).toEqual(savePointIdsBefore);
  });

  it('returns the same direct restore operation for a repeated idempotency key', async () => {
    const library = await postJson('/file-libraries', {
      name: `Restore idempotent ${Date.now()}`,
    });
    expect(library.status).toBe(201);
    const libraryPayload = await library.json() as { id?: string };
    const libraryId = libraryPayload.id ?? '';
    const upload = await uploadTextFile(libraryId, 'restore-idempotent.txt', 'before restore');
    expect(upload.status, await upload.text()).toBe(201);
    const savePoint = await createSavePointAndReadFirst(libraryId, 'Before idempotent restore');
    const deleteOriginal = await deletePaths(libraryId, ['restore-idempotent.txt']);
    expect(deleteOriginal.status, await deleteOriginal.text()).toBe(200);
    const mutation = await uploadTextFile(libraryId, 'restore-idempotent.txt', 'after restore');
    expect(mutation.status, await mutation.text()).toBe(201);

    const first = await postJsonWithIdempotency(`/file-libraries/${libraryId}/restore`, {
      save_point_id: savePoint.id,
    }, 'msw-direct-restore-key-repeat');
    expect(first.status).toBe(200);
    const firstPayload = await first.json() as { id?: string; source_save_point_id?: string; status?: string };
    expect(firstPayload).toMatchObject({
      source_save_point_id: savePoint.id,
      status: 'succeeded',
    });

    const second = await postJsonWithIdempotency(`/file-libraries/${libraryId}/restore`, {
      save_point_id: savePoint.id,
    }, 'msw-direct-restore-key-repeat');
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      id: firstPayload.id,
      source_save_point_id: savePoint.id,
      status: 'succeeded',
    });
  });

  it('matches backend validation status when direct restore omits Idempotency-Key', async () => {
    const restore = await postJson('/file-libraries/lib_shared_default/restore', {
      save_point_id: 'sp_missing_key_check',
    });

    expect(restore.status).toBe(422);
    await expect(restore.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message: 'idempotency_key_required',
    });
  });

  it('publishes task file templates and clones their files into a new task workspace', async () => {
    const createTemplate = await postJsonWithIdempotency(
      '/task-file-templates',
      {
        source_library_id: 'lib_shared_default',
        name: `Starter template ${Date.now()}`,
        description: 'Reusable task files',
      },
      'task-template-msw-key-1',
    );
    expect(createTemplate.status).toBe(201);
    const template = await createTemplate.json() as { id?: string; status?: string };
    expect(template.status).toBe('unpublished');

    const publish = await postJson(`/task-file-templates/${template.id}/publish`);
    expect(publish.status).toBe(200);
    await expect(publish.json()).resolves.toMatchObject({
      id: template.id,
      status: 'published',
    });

    const task = await postJson('/tasks', {
      title: 'Task from template',
      workspace_mode: 'use_template',
      task_file_template_id: template.id,
    });
    expect(task.status).toBe(201);
    const taskPayload = await task.json() as { workspace_file_library_id?: string; workspace_file_library_name?: string };
    expect(taskPayload.workspace_file_library_id).toBeTruthy();
    expect(taskPayload.workspace_file_library_name).toBe('Task from template Workspace');

    await expect(listEntryNames(taskPayload.workspace_file_library_id ?? '')).resolves.toContain('README.txt');
  });

  it('releases only runtime access through the file-library scoped route and keeps the task-home binding durable', async () => {
    const title = `Runtime release ${Date.now()}`;
    const task = await postJson('/tasks', {
      title,
      workspace_mode: 'create_new',
    });
    expect(task.status).toBe(201);
    const taskPayload = await task.json() as { id?: string; workspace_file_library_id?: string };
    const libraryId = taskPayload.workspace_file_library_id ?? '';

    await expect(getFileLibrary(libraryId)).resolves.toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_id: taskPayload.id,
      bound_task_title: title,
      bound_task_status: 'active',
    });

    const release = await postJson(`/file-libraries/${libraryId}/runtime-access/release`);
    expect(release.status).toBe(200);
    await expect(release.json()).resolves.toMatchObject({
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    await expect(getFileLibrary(libraryId)).resolves.toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_id: taskPayload.id,
      bound_task_title: title,
      bound_task_status: 'active',
    });
  });

  it('returns typed active-writer blocked from direct restore without creating a restore operation', async () => {
    const library = await postJson('/file-libraries', {
      name: `Restore blocked ${Date.now()}`,
    });
    expect(library.status).toBe(201);
    const libraryPayload = await library.json() as { id?: string };
    const libraryId = libraryPayload.id ?? '';

    const savePoint = await createSavePointAndReadFirst(libraryId, 'Before task writes');

    const task = await postJson('/tasks', {
      title: 'Active writer task',
      workspace_mode: 'use_existing',
      workspace_file_library_id: libraryId,
    });
    expect(task.status).toBe(201);
    const taskPayload = await task.json() as { id?: string };

    const restore = await postJsonWithIdempotency(`/file-libraries/${libraryId}/restore`, {
      save_point_id: savePoint.id,
    }, 'msw-direct-restore-blocked');
    expect(restore.status).toBe(409);
    await expect(restore.json()).resolves.toMatchObject({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      bound_task_visible: true,
      bound_task_id: taskPayload.id,
      blockers: [{ code: 'active_writer_sessions' }],
    });

    const active = await fetch(`${baseUrl}/file-libraries/${libraryId}/operations/active`);
    expect(active.status).toBe(200);
    await expect(active.json()).resolves.toEqual({ operation: null });
  });
});
