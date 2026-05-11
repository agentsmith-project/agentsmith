import { describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { AgentTaskModelSettingService } from '../agent-task-model-setting-service.js';
import {
  upsertProjectMembershipRecord,
  upsertProjectMemberPermissionState,
} from '../project-member-governance-persistence.js';
import { apiFetch, apiFetchWithToken, startServer as startBaseServer, startServerWithDeps as startBaseServerWithDeps } from './test-support.js';
import { configureAfscpReadyFileLibraryTestDeps } from './afscp-file-library-test-support.js';

function startServer(): ReturnType<typeof startBaseServer> {
  const started = startBaseServer();
  configureAfscpReadyFileLibraryTestDeps(started.deps);
  return started;
}

function startServerWithDeps(deps: ReturnType<typeof createDefaultNodeApiDeps>): ReturnType<typeof startBaseServerWithDeps> {
  configureAfscpReadyFileLibraryTestDeps(deps);
  return startBaseServerWithDeps(deps);
}

async function seedDefaultManagedTaskRunner(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  projectId = 'proj_1',
): Promise<void> {
  const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
    name: 'file-library-template-credential',
    value: 'sk-test',
  });
  const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', projectId, {
    name: 'file-library-template-endpoint',
    model: 'gpt-5-codex',
    type: 'custom',
    mode: 'openai',
    base_url: 'https://example.com/v1',
    credential_ref: credential.id,
    model_profile: {
      max_context_tokens: 204800,
      max_output_tokens: 128000,
      supports_file: false,
      supports_tool_call: true,
      supports_reasoning: false,
      price_input_per_1m: 0,
      price_output_per_1m: 0,
      cache_read_discount_ratio: 0,
      cache_write_discount_ratio: 0,
    },
  });
  const modelSettingService = new AgentTaskModelSettingService(deps);
  const currentProjectModelSetting = await modelSettingService.getSetting('ws_default', projectId);
  await modelSettingService.patchSetting({
    workspaceId: 'ws_default',
    projectId,
    endpointId: endpoint.id,
    expectedSettingRevision: currentProjectModelSetting?.setting_revision ?? null,
    actorUserId: 'user_test',
  });
  await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', projectId, {
    name: 'file-library-template-default-runner',
    runner_provider: 'managed',
    status: 'enabled',
    presence: 'managed',
    runner_status: 'ready',
    endpointId: endpoint.id,
    owner_id: 'user_test',
    visibility: 'private',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      streaming_completion: true,
    },
  });
}

async function grantProjectPermissions(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  projectId: string,
  userId: string,
  permissions: string[],
): Promise<void> {
  await upsertProjectMembershipRecord(deps.docStore, 'ws_default', projectId, {
    project_id: projectId,
    user_id: userId,
    user_email: `${userId}@example.com`,
    user_name: userId,
    status: 'active',
    joined_at: new Date().toISOString(),
  });
  await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', projectId, userId, {
    mode: 'custom',
    template: null,
    permissions,
  });
}

describe.sequential('api-entry-node project file libraries integration', () => {
  it('supports file libraries CRUD flow through the AFSCP storage adapter', async () => {
    const { baseUrl } = startServer();

    const listBefore = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries');
    expect(listBefore.status).toBe(200);
    const listBeforeBody = (await listBefore.json()) as { items: Array<{ id: string }> };
    expect(Array.isArray(listBeforeBody.items)).toBe(true);
    const initialCount = listBeforeBody.items.length;

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Project Uploads', description: 'default uploads library' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      name: string;
      description?: string;
      status: string;
      source: string;
    };
    expect(created.id).toContain('flib_');
    expect(created.name).toBe('Project Uploads');
    expect(created.description).toBe('default uploads library');
    expect(created.status).toBe('ready');
    expect(created.source).toBe('agent_task_files');
    expect(created).not.toHaveProperty('filesystem_name');

    const updateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'managed upload library' }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { description?: string };
    expect(updated.description).toBe('managed upload library');

    const listAfter = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries');
    expect(listAfter.status).toBe(200);
    const listed = (await listAfter.json()) as { items: Array<{ id: string; name: string }> };
    expect(listed.items).toHaveLength(initialCount + 1);
    expect(listed.items.some((item) => item.id === created.id && item.name === 'Project Uploads')).toBe(true);

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);
  });

  it('supports save point restore and task file template publish and clone through HTTP APIs', async () => {
    const { baseUrl, deps } = startServer();
    const createProjectRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Template API Project',
          visibility: 'private',
          join_policy: 'approval_required',
        }),
      },
    );
    expect(createProjectRes.status).toBe(201);
    const project = (await createProjectRes.json()) as { id: string };
    const projectPath = `/api/v1/workspaces/ws_default/projects/${project.id}`;
    await grantProjectPermissions(deps, project.id, 'user_test', ['project:files:update', 'project:agent_task:use']);
    await seedDefaultManagedTaskRunner(deps, project.id);

    const createLibraryRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Template Source', description: 'source for task templates' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const sourceLibrary = (await createLibraryRes.json()) as { id: string; status: string };
    expect(sourceLibrary.status).toBe('ready');

    const createFolderRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries/${sourceLibrary.id}/folders`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'template-docs' }),
      },
    );
    expect(createFolderRes.status).toBe(204);

    const createSavePointRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries/${sourceLibrary.id}/save-points`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Before restore' }),
      },
    );
    expect(createSavePointRes.status).toBe(201);
    const savePoint = (await createSavePointRes.json()) as { id: string; file_library_id: string };
    expect(savePoint.file_library_id).toBe(sourceLibrary.id);

    const listSavePointsRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries/${sourceLibrary.id}/save-points`,
    );
    expect(listSavePointsRes.status).toBe(200);
    const listedSavePoints = (await listSavePointsRes.json()) as { items: Array<{ id: string }> };
    expect(listedSavePoints.items.some((item) => item.id === savePoint.id)).toBe(true);

    const restorePreviewRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries/${sourceLibrary.id}/restore-preview`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ save_point_id: savePoint.id }),
      },
    );
    expect(restorePreviewRes.status).toBe(201);
    const restorePreview = (await restorePreviewRes.json()) as { id: string; source_save_point_id: string };
    expect(restorePreview.source_save_point_id).toBe(savePoint.id);

    const restoreRunRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries/${sourceLibrary.id}/restore-run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restore_preview_id: restorePreview.id }),
      },
    );
    expect(restoreRunRes.status).toBe(200);

    const createTemplateRes = await apiFetch(
      baseUrl,
      `${projectPath}/task-file-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Published Template Source',
          source_library_id: sourceLibrary.id,
        }),
      },
    );
    expect(createTemplateRes.status).toBe(201);
    const template = (await createTemplateRes.json()) as { id: string; status: string; source_library_id: string };
    expect(template).toMatchObject({
      status: 'unpublished',
      source_library_id: sourceLibrary.id,
    });

    const publishTemplateRes = await apiFetch(
      baseUrl,
      `${projectPath}/task-file-templates/${template.id}/publish`,
      { method: 'POST' },
    );
    expect(publishTemplateRes.status).toBe(200);

    const listTemplatesRes = await apiFetch(
      baseUrl,
      `${projectPath}/task-file-templates`,
    );
    expect(listTemplatesRes.status).toBe(200);
    const listedTemplates = (await listTemplatesRes.json()) as { items: Array<{ id: string; status: string }> };
    expect(listedTemplates.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: template.id, status: 'published' }),
    ]));

    const createTaskRes = await apiFetch(
      baseUrl,
      `${projectPath}/tasks`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Task from published template',
          workspace_mode: 'use_template',
          task_file_template_id: template.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as {
      id: string;
      workspace_file_library_id: string;
      workspace_file_library_name: string;
    };
    expect(task.workspace_file_library_id).toMatch(/^flib_/);
    expect(task.workspace_file_library_id).not.toBe(sourceLibrary.id);
    expect(task.workspace_file_library_name).toBe('Task from published template Workspace');

    const clonedEntriesRes = await apiFetch(
      baseUrl,
      `${projectPath}/file-libraries/${task.workspace_file_library_id}/entries`,
    );
    expect(clonedEntriesRes.status).toBe(200);
    const clonedEntries = (await clonedEntriesRes.json()) as {
      items: Array<{ kind: string; path: string; name: string }>;
    };
    expect(clonedEntries.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'directory', path: 'template-docs/', name: 'template-docs' }),
    ]));
    expect(JSON.stringify({ sourceLibrary, savePoint, restorePreview, template, task, clonedEntries })).not.toMatch(
      /repo_|tmpl_|sp_user_|sp_template|credential|control_root/,
    );
  });

  it('preserves file libraries across api restarts when the same deps/doc store are reused', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstServer = startServerWithDeps(deps);

    const createRes = await apiFetch(
      firstServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Restart Persistence', description: 'persists across restart' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };

    firstServer.server.closeAllConnections?.();
    firstServer.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

    const secondServer = startServerWithDeps(deps);
    const listRes = await apiFetch(secondServer.baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries');
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { items: Array<{ id: string; name: string }> };
    expect(listed.items.some((item) => item.id === created.id && item.name === created.name)).toBe(true);
  });

  it('lists and reads file libraries by project scope instead of creator ownership', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'test-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Private Library', description: 'owner only' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };

    const ownerList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'test-token',
    );
    expect(ownerList.status).toBe(200);
    await expect(ownerList.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: created.id, name: created.name })]),
    });

    const otherList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'owner-token',
    );
    expect(otherList.status).toBe(200);
    const otherListBody = (await otherList.json()) as { items: Array<{ id: string }> };
    expect(otherListBody.items.some((item) => item.id === created.id)).toBe(true);

    const itemRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${created.id}`,
      'owner-token',
    );
    expect(itemRes.status).toBe(200);
    await expect(itemRes.json()).resolves.toMatchObject({
      id: created.id,
      created_by_user_id: 'user_test',
      source: 'agent_task_files',
    });
  });
});
