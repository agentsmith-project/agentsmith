import { describe, expect, it, vi } from 'vitest';

import { createDefaultNodeApiDeps } from '../index.js';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryCatalogRepo,
} from '../file-library-persistence.js';
import {
  JsonDocTaskFileLibraryBindingRepo,
  RUNTIME_ACCESS_RELEASE_FENCE_LEASE_TTL_MS,
} from './task-file-library-bindings.js';
import { resolveTaskWorkspaceBindingGuard } from './task-workspace-binding-guard.js';
import { notebookTasksCollection } from './task-store.js';

describe('resolveTaskWorkspaceBindingGuard', () => {
  it('resolves from task HOME binding state without accepting raw mount access flags', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = '2026-05-09T12:00:00.000Z';

    await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).save(buildFileLibraryRecord({
      id: 'lib_guard_home',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Guard HOME Library',
      status: 'ready',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_guard_home',
      now,
    }));

    const acquired = await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'lib_guard_home',
      taskId: 'task_guard_home',
      taskTitle: 'Guard HOME task',
      taskStatus: 'active',
      ownerUserId: 'user_1',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_guard_home',
      now,
    });
    if (!acquired.ok) throw new Error('expected binding acquire to succeed');

    const task = {
      id: 'task_guard_home',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Guard HOME task',
      task_home_segment: 'task_guard_home',
      workspace_file_library_id: 'lib_guard_home',
      workspace_file_library_name: 'Guard HOME Library',
      file_library_binding_generation: acquired.binding.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_guard_home', task);

    const result = await resolveTaskWorkspaceBindingGuard({
      deps,
      task: task as never,
      actorUserId: 'user_1',
      canUpdateProjectFiles: async () => true,
      requireMountAccess: true,
    } as Parameters<typeof resolveTaskWorkspaceBindingGuard>[0] & { requireMountAccess: true });

    expect(result).toMatchObject({
      library: { id: 'lib_guard_home' },
      binding: {
        taskId: 'task_guard_home',
        fileLibraryId: 'lib_guard_home',
        bindingGeneration: acquired.binding.bindingGeneration,
      },
    });
    expect(result).not.toHaveProperty('mountAccess');
  });

  it('rejects workspace access while the task HOME binding is releasing', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = '2026-05-09T12:00:00.000Z';

    await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).save(buildFileLibraryRecord({
      id: 'lib_guard_releasing',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Guard Releasing Library',
      status: 'ready',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_guard_releasing',
      now,
    }));

    const repo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const acquired = await repo.acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'lib_guard_releasing',
      taskId: 'task_guard_releasing',
      taskTitle: 'Guard releasing task',
      taskStatus: 'active',
      ownerUserId: 'user_1',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_guard_releasing',
      now,
    });
    if (!acquired.ok) throw new Error('expected binding acquire to succeed');

    const task = {
      id: 'task_guard_releasing',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Guard releasing task',
      task_home_segment: 'task_guard_releasing',
      workspace_file_library_id: 'lib_guard_releasing',
      workspace_file_library_name: 'Guard Releasing Library',
      file_library_binding_generation: acquired.binding.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_guard_releasing', task);
    await expect(repo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'lib_guard_releasing',
      taskId: 'task_guard_releasing',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'req_guard_releasing_begin',
    })).resolves.toMatchObject({ ok: true });

    await expect(resolveTaskWorkspaceBindingGuard({
      deps,
      task: task as never,
      actorUserId: 'user_1',
      canUpdateProjectFiles: async () => true,
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      message: 'agent_task_workspace_binding_conflict',
      metadata: {
        taskId: 'task_guard_releasing',
        fileLibraryId: 'lib_guard_releasing',
        bindingGeneration: acquired.binding.bindingGeneration,
      },
    });
  });

  it('allows workspace access again after a completed runtime release fence lease expires', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = '2026-05-09T12:00:00.000Z';

    await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).save(buildFileLibraryRecord({
      id: 'lib_guard_release_expired',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Guard Expired Release Library',
      status: 'ready',
      createdByUserId: 'user_1',
      fileLibraryHomeSegment: 'flibhome_guard_release_expired',
      now,
    }));

    const repo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const acquired = await repo.acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'lib_guard_release_expired',
      taskId: 'task_guard_release_expired',
      taskTitle: 'Guard expired release task',
      taskStatus: 'active',
      ownerUserId: 'user_1',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_guard_release_expired',
      now,
    });
    if (!acquired.ok) throw new Error('expected binding acquire to succeed');

    const task = {
      id: 'task_guard_release_expired',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Guard expired release task',
      task_home_segment: 'task_guard_release_expired',
      workspace_file_library_id: 'lib_guard_release_expired',
      workspace_file_library_name: 'Guard Expired Release Library',
      file_library_binding_generation: acquired.binding.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_guard_release_expired', task);
    await expect(repo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'lib_guard_release_expired',
      taskId: 'task_guard_release_expired',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'req_guard_release_expired_begin',
      now,
    })).resolves.toMatchObject({ ok: true });
    await expect(repo.completeRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'lib_guard_release_expired',
      taskId: 'task_guard_release_expired',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'req_guard_release_expired_complete',
      now,
    })).resolves.toMatchObject({ ok: true });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.parse(now) + RUNTIME_ACCESS_RELEASE_FENCE_LEASE_TTL_MS + 1));

      await expect(resolveTaskWorkspaceBindingGuard({
        deps,
        task: task as never,
        actorUserId: 'user_1',
        canUpdateProjectFiles: async () => true,
      })).resolves.toMatchObject({
        binding: {
          taskId: 'task_guard_release_expired',
          fileLibraryId: 'lib_guard_release_expired',
          bindingState: 'bound',
          correlationId: 'req_guard_release_expired_complete:lease_expired',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
