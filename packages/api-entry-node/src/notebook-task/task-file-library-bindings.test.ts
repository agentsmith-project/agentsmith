import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  JsonDocTaskFileLibraryBindingRepo,
  JsonDocTaskWorkspaceHolderRepo,
  buildFileLibraryTaskHomeBindingFields,
  hydrateTaskFileLibraryBindingsForProject,
} from './task-file-library-bindings.js';

const NOW = '2026-05-09T12:00:00.000Z';

function bindingInput(overrides: Partial<Parameters<JsonDocTaskFileLibraryBindingRepo['acquire']>[0]> = {}) {
  return {
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    fileLibraryId: 'flib_home',
    taskId: 'task_1',
    taskTitle: 'Task One',
    taskStatus: 'active' as const,
    ownerUserId: 'user_1',
    runtimeWritableAffordance: 'task_internal_home' as const,
    correlationId: 'req_1',
    now: NOW,
    ...overrides,
  };
}

describe('JsonDocTaskFileLibraryBindingRepo', () => {
  it('keeps binding exclusivity in durable store across repository instances', async () => {
    const docStore = new InMemoryJsonDocStore();
    const firstRepo = new JsonDocTaskFileLibraryBindingRepo(docStore);
    const secondRepo = new JsonDocTaskFileLibraryBindingRepo(docStore);

    const acquired = await firstRepo.acquire(bindingInput());
    expect(acquired).toMatchObject({
      ok: true,
      binding: {
        taskId: 'task_1',
        bindingGeneration: expect.any(Number),
        runtimeWritableAffordance: 'task_internal_home',
        bindingState: 'bound',
      },
    });

    const conflicted = await secondRepo.acquire(bindingInput({
      taskId: 'task_2',
      taskTitle: 'Task Two',
      correlationId: 'req_2',
    }));
    expect(conflicted).toMatchObject({
      ok: false,
      code: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
      binding: {
        taskId: 'task_1',
      },
    });
  });

  it('does not let process cache hide durable binding deletion', async () => {
    const docStore = new InMemoryJsonDocStore();
    const firstRepo = new JsonDocTaskFileLibraryBindingRepo(docStore);
    const acquired = await firstRepo.acquire(bindingInput());
    if (!acquired.ok) throw new Error('expected acquire to succeed');

    await expect(firstRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toMatchObject({
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
    });

    await docStore.delete('agent_task_file_library_bindings', 'ws_default::proj_1::flib_home');

    await expect(firstRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toBeNull();
  });

  it('releases only when task id and binding generation both match', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocTaskFileLibraryBindingRepo(docStore);
    const acquired = await repo.acquire(bindingInput());
    if (!acquired.ok) throw new Error('expected acquire to succeed');

    await expect(repo.release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration + 1,
      correlationId: 'release_wrong_generation',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: {
        taskId: 'task_1',
        bindingGeneration: acquired.binding.bindingGeneration,
      },
    });

    await expect(repo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toMatchObject({
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
    });

    await expect(repo.release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_ok',
    })).resolves.toEqual({ ok: true, released: true });
    await expect(repo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toBeNull();
  });

  it('keeps a releasing CAS fence after completing runtime access release', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocTaskFileLibraryBindingRepo(docStore);
    const acquired = await repo.acquire(bindingInput());
    if (!acquired.ok) throw new Error('expected acquire to succeed');

    await expect(repo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration + 1,
      correlationId: 'release_wrong_generation',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: {
        taskId: 'task_1',
        bindingState: 'bound',
      },
    });

    const begun = await repo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_begin',
    });
    expect(begun).toMatchObject({
      ok: true,
      binding: {
        taskId: 'task_1',
        bindingGeneration: acquired.binding.bindingGeneration,
        bindingState: 'releasing',
        correlationId: 'release_begin',
      },
    });

    await expect(repo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_begin_idempotent',
    })).resolves.toMatchObject({
      ok: true,
      binding: {
        taskId: 'task_1',
        bindingGeneration: acquired.binding.bindingGeneration,
        bindingState: 'releasing',
      },
    });

    await expect(repo.release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'legacy_release_during_fence',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: {
        bindingState: 'releasing',
      },
    });

    await expect(repo.completeRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_complete',
    })).resolves.toEqual({ ok: true, released: true });
    await expect(repo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toMatchObject({
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      bindingState: 'releasing',
      correlationId: 'release_complete',
    });

    await hydrateTaskFileLibraryBindingsForProject({
      docStore,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      tasks: [{
        id: 'task_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Task One',
        status: 'active',
        workspace_file_library_id: 'flib_home',
        file_library_binding_generation: acquired.binding.bindingGeneration,
        runtime_writable_affordance: 'task_internal_home',
      } as never],
    });
    await expect(repo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toMatchObject({
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      bindingState: 'releasing',
    });
  });

  it('rolls back only the matching releasing fence and treats missing bindings as no-op', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocTaskFileLibraryBindingRepo(docStore);
    const acquired = await repo.acquire(bindingInput());
    if (!acquired.ok) throw new Error('expected acquire to succeed');

    await expect(repo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_begin_for_rollback',
    })).resolves.toMatchObject({ ok: true });

    await expect(repo.rollbackRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_2',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_rollback_wrong_task',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: {
        taskId: 'task_1',
        bindingState: 'releasing',
      },
    });

    await expect(repo.rollbackRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_rollback',
    })).resolves.toEqual({ ok: true, rolledBack: true });

    await expect(repo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
    })).resolves.toMatchObject({
      taskId: 'task_1',
      bindingState: 'bound',
      correlationId: 'release_rollback',
    });

    await expect(repo.completeRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_complete_without_fence',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      binding: {
        bindingState: 'bound',
      },
    });

    await repo.release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_after_rollback',
    });

    await expect(repo.rollbackRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_rollback_missing',
    })).resolves.toEqual({ ok: true, rolledBack: false });
    await expect(repo.completeRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_home',
      taskId: 'task_1',
      bindingGeneration: acquired.binding.bindingGeneration,
      correlationId: 'release_complete_missing',
    })).resolves.toEqual({ ok: true, released: false });
  });

  it('redacts bound task identity fields when actor cannot see the binding owner', () => {
    expect(buildFileLibraryTaskHomeBindingFields({
      binding: {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: 'flib_home',
        taskId: 'task_hidden',
        taskTitle: 'Hidden task',
        taskStatus: 'archived',
        ownerUserId: 'user_hidden',
        bindingGeneration: 1,
        runtimeWritableAffordance: 'files_update',
        bindingState: 'bound',
        correlationId: 'req_1',
      },
      actorUserId: 'user_viewer',
    })).toEqual({
      task_home_binding_status: 'bound',
      bound_task_visible: false,
    });
  });

  it('does not hydrate deleting task tombstones back into file-library bindings', async () => {
    const docStore = new InMemoryJsonDocStore();
    const repo = new JsonDocTaskFileLibraryBindingRepo(docStore);

    await hydrateTaskFileLibraryBindingsForProject({
      docStore,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      tasks: [{
        id: 'task_deleting',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Deleting task',
        status: 'active',
        deletion_state: 'deleting',
        workspace_file_library_id: 'flib_deleting',
        file_library_binding_generation: 42,
        runtime_writable_affordance: 'task_internal_home',
      } as never],
    });

    await expect(repo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: 'flib_deleting',
    })).resolves.toBeNull();
  });

  it('tracks live workspace holders with ttl and fences release by binding generation plus lease epoch', async () => {
    const docStore = new InMemoryJsonDocStore();
    const holderRepo = new JsonDocTaskWorkspaceHolderRepo(docStore);
    const now = '2026-05-09T12:00:00.000Z';

    const acquired = await holderRepo.acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_holder',
      fileLibraryId: 'flib_holder',
      taskHomeSegment: 'flibhome_holder',
      bindingGeneration: 100,
      holderId: 'holder_reused',
      holderKind: 'runner_workspace',
      leaseEpoch: 'lease_current',
      issuedAt: now,
      expiresAt: '2026-05-09T12:05:00.000Z',
    });
    expect(acquired).toMatchObject({ ok: true });

    await expect(holderRepo.release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_holder',
      fileLibraryId: 'flib_holder',
      holderId: 'holder_reused',
      bindingGeneration: 100,
      leaseEpoch: 'lease_stale',
      releasedAt: '2026-05-09T12:01:00.000Z',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
    });

    await expect(holderRepo.listLiveByTask({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_holder',
      now: '2026-05-09T12:01:00.000Z',
    })).resolves.toHaveLength(1);

    await expect(holderRepo.release({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_holder',
      fileLibraryId: 'flib_other',
      holderId: 'holder_reused',
      bindingGeneration: 100,
      leaseEpoch: 'lease_current',
      releasedAt: '2026-05-09T12:02:00.000Z',
    })).resolves.toMatchObject({
      ok: false,
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
    });

    await expect(holderRepo.listLiveByTask({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_holder',
      now: '2026-05-09T12:02:00.000Z',
    })).resolves.toHaveLength(1);

    await expect(holderRepo.listLiveByTask({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_holder',
      now: '2026-05-09T12:06:00.000Z',
    })).resolves.toHaveLength(0);
  });
});
