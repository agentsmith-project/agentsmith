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
  it('creates save points and restores file-library contents through preview/run', async () => {
    const libraryId = 'lib_shared_default';
    const save = await postJson(`/file-libraries/${libraryId}/save-points`, {
      message: 'Before temporary file',
    });
    expect(save.status).toBe(201);
    const savePoint = await save.json() as { id?: string; file_library_id?: string; message?: string };
    expect(savePoint).toMatchObject({
      file_library_id: libraryId,
      message: 'Before temporary file',
    });

    const upload = await uploadTextFile(libraryId, 'temporary-template-input.txt', 'temporary');
    const uploadText = await upload.text();
    expect(upload.status, uploadText).toBe(201);
    expect(JSON.parse(uploadText)).toMatchObject({
      name: 'temporary-template-input.txt',
      path: 'temporary-template-input.txt',
    });
    await expect(listEntryNames(libraryId)).resolves.toContain('temporary-template-input.txt');

    const preview = await postJson(`/file-libraries/${libraryId}/restore-preview`, {
      save_point_id: savePoint.id,
    });
    expect(preview.status).toBe(201);
    const previewPayload = await preview.json() as { id?: string; source_save_point_id?: string; status?: string };
    expect(previewPayload).toMatchObject({
      source_save_point_id: savePoint.id,
      status: 'ready',
    });

    const run = await postJson(`/file-libraries/${libraryId}/restore-run`, {
      restore_preview_id: previewPayload.id,
    });
    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      restore_preview_id: previewPayload.id,
      status: 'succeeded',
    });
    await expect(listEntryNames(libraryId)).resolves.not.toContain('temporary-template-input.txt');
  });

  it('publishes task file templates and clones their files into a new task workspace', async () => {
    const createTemplate = await postJson('/task-file-templates', {
      source_library_id: 'lib_shared_default',
      name: `Starter template ${Date.now()}`,
      description: 'Reusable task files',
    });
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

  it('returns typed active-writer blocked from restore-run when the active preview carries that blocker', async () => {
    const library = await postJson('/file-libraries', {
      name: `Restore blocked ${Date.now()}`,
    });
    expect(library.status).toBe(201);
    const libraryPayload = await library.json() as { id?: string };
    const libraryId = libraryPayload.id ?? '';

    const save = await postJson(`/file-libraries/${libraryId}/save-points`, {
      message: 'Before task writes',
    });
    expect(save.status).toBe(201);
    const savePoint = await save.json() as { id?: string };

    const task = await postJson('/tasks', {
      title: 'Active writer task',
      workspace_mode: 'use_existing',
      workspace_file_library_id: libraryId,
    });
    expect(task.status).toBe(201);
    const taskPayload = await task.json() as { id?: string };

    const preview = await postJson(`/file-libraries/${libraryId}/restore-preview`, {
      save_point_id: savePoint.id,
    });
    expect(preview.status).toBe(201);
    const previewPayload = await preview.json() as {
      id?: string;
      blockers?: Array<{ code?: string }>;
      status?: string;
    };
    expect(previewPayload).toMatchObject({
      status: 'ready',
      blockers: [{ code: 'active_writer_sessions' }],
    });

    const run = await postJson(`/file-libraries/${libraryId}/restore-run`, {
      restore_preview_id: previewPayload.id,
    });
    expect(run.status).toBe(409);
    await expect(run.json()).resolves.toMatchObject({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      restore_preview_id: previewPayload.id,
      bound_task_visible: true,
      bound_task_id: taskPayload.id,
      blockers: [{ code: 'active_writer_sessions' }],
    });
  });
});
