import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  markNotebookTaskRunHardTeardownFailed,
} from './task-run-coordination.js';
import { buildTaskRealtimeView, mapTaskMessagesForExecution } from './task-realtime-view.js';
import { MESSAGES_BY_TASK } from './task-runtime-state.js';
import type { TaskRecord } from './task-models.js';

describe('mapTaskMessagesForExecution', () => {
  afterEach(() => {
    MESSAGES_BY_TASK.clear();
  });

  it('only forwards the latest non-empty user turn for resumed notebook execution', () => {
    MESSAGES_BY_TASK.set('task_1', [
      {
        id: 'msg_user_1',
        task_id: 'task_1',
        role: 'user',
        content: 'first user turn',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg_agent_1',
        task_id: 'task_1',
        role: 'agent',
        content: 'first assistant reply',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg_user_2',
        task_id: 'task_1',
        role: 'user',
        content: 'second user turn',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg_agent_pending',
        task_id: 'task_1',
        role: 'agent',
        content: '',
        created_at: new Date().toISOString(),
      },
    ]);

    expect(mapTaskMessagesForExecution('task_1', 'msg_agent_pending')).toEqual([
      {
        role: 'user',
        content: 'second user turn',
      },
    ]);
  });

  it('returns no execution messages when there is no prior user turn', () => {
    MESSAGES_BY_TASK.set('task_2', [
      {
        id: 'msg_agent_pending',
        task_id: 'task_2',
        role: 'agent',
        content: '',
        created_at: new Date().toISOString(),
      },
    ]);

    expect(mapTaskMessagesForExecution('task_2', 'msg_agent_pending')).toEqual([]);
  });

  it('exposes terminal hard teardown debt as terminating realtime truth without an active run', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn();
    deps.internalWorkloadCoordinator = {
      requestHardTeardown: async () => undefined,
    } as never;
    const now = '2026-03-18T12:00:00.000Z';
    const task: TaskRecord = {
      id: 'task_realtime_debt',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Realtime debt task',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };

    await markNotebookTaskRunHardTeardownFailed(deps.cache, {
      taskId: task.id,
      runId: 'run_realtime_debt',
      attemptedAt: now,
      errorMessage: 'release failed after active run cleared',
    });

    const realtime = await buildTaskRealtimeView(deps, task.workspace_id, task.project_id, task);
    expect(realtime).toMatchObject({
      id: task.id,
      run_state: 'terminating',
      stop_mode: 'terminate',
      can_escalate: false,
      escalation_reason: 'unsupported_runner',
    });
    expect(realtime).not.toHaveProperty('agent_id');
    expect(realtime).not.toHaveProperty('agent_name');
    expect(realtime).not.toHaveProperty('agent_presence');
    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
  });

  it('does not derive runner or presence truth from legacy task agent fields without an active run', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => {
      throw new Error('legacy task agent field must not be used');
    });
    const now = '2026-03-18T12:00:00.000Z';
    const task = {
      id: 'task_realtime_legacy_only',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Legacy-only task',
      agent_id: 'agent_legacy_only',
      agent_name: 'Legacy-only agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    } as unknown as TaskRecord;

    const realtime = await buildTaskRealtimeView(deps, task.workspace_id, task.project_id, task);

    expect(realtime).toMatchObject({
      id: task.id,
      run_state: 'idle',
    });
    expect(realtime).not.toHaveProperty('agent_id');
    expect(realtime).not.toHaveProperty('agent_name');
    expect(realtime).not.toHaveProperty('agent_presence');
    expect(realtime).not.toHaveProperty('active_run');
    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
  });

  it('exposes the active run start timestamp from shared run state', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = async () => ({
      id: 'agent_realtime_run_started',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Realtime run agent',
      mode: 'external',
      presence: 'online',
      status: 'enabled',
      interaction_kind: 'notebook',
    }) as never;
    const now = '2026-03-18T12:00:00.000Z';
    const startedAt = '2026-03-18T12:00:03.000Z';
    const task: TaskRecord = {
      id: 'task_realtime_run_started',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Realtime run started task',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };

    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_realtime_started',
      startedAt,
    }))).resolves.toBe(true);

    await expect(buildTaskRealtimeView(deps, task.workspace_id, task.project_id, task)).resolves.toMatchObject({
      id: task.id,
      run_state: 'running',
      active_run_started_at: startedAt,
    });
  });

  it('uses active_run.resolved_runner_id for runner presence even when legacy task fields disagree', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async (_workspaceId, _projectId, agentId) => {
      if (agentId !== 'runner_active_truth') {
        throw new Error(`legacy runner lookup attempted:${agentId}`);
      }
      return {
        id: 'runner_active_truth',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Active truth runner',
        mode: 'external',
        runner_provider: 'developer',
        presence: 'online',
        status: 'enabled',
        interaction_kind: 'notebook',
      } as never;
    });
    const now = '2026-03-18T12:00:00.000Z';
    const task = {
      id: 'task_realtime_runner_truth',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Realtime runner truth task',
      agent_id: 'agent_legacy_wrong',
      agent_name: 'Legacy wrong runner',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    } as unknown as TaskRecord;
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_realtime_runner_truth',
      runnerId: 'runner_active_truth',
      resolvedRunnerId: 'runner_active_truth',
      startedAt: now,
    }))).resolves.toBe(true);

    const realtime = await buildTaskRealtimeView(deps, task.workspace_id, task.project_id, task);

    expect(deps.agentResourceService.getAgent).toHaveBeenCalledWith('ws_default', 'proj_1', 'runner_active_truth');
    expect(realtime).toMatchObject({
      id: task.id,
      agent_presence: 'online',
      active_run: {
        id: 'run_realtime_runner_truth',
        runner_id: 'runner_active_truth',
        status: 'running',
      },
    });
    expect(realtime).not.toHaveProperty('agent_id');
    expect(realtime).not.toHaveProperty('agent_name');
  });

  it('does not render unresolved runner_id fallback as active runner evidence', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => {
      throw new Error('unresolved runner_id fallback must not be used as runner evidence');
    });
    const now = '2026-03-18T12:00:00.000Z';
    const task: TaskRecord = {
      id: 'task_realtime_runner_unresolved',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Realtime unresolved runner task',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_realtime_runner_unresolved',
      runnerId: 'runner_legacy_fallback',
      startedAt: now,
    }))).resolves.toBe(true);

    const realtime = await buildTaskRealtimeView(deps, task.workspace_id, task.project_id, task);

    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
    expect(realtime).toMatchObject({
      id: task.id,
      run_state: 'running',
    });
    expect(realtime).not.toHaveProperty('agent_presence');
    expect(realtime).not.toHaveProperty('active_run');
  });
});
