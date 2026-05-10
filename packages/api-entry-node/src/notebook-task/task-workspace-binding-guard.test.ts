import { describe, expect, it } from 'vitest';

import { createDefaultNodeApiDeps } from '../index.js';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryCatalogRepo,
} from '../file-library-persistence.js';
import { JsonDocTaskFileLibraryBindingRepo } from './task-file-library-bindings.js';
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
});
