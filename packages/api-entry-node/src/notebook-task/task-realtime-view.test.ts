import { afterEach, describe, expect, it } from 'vitest';
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
    deps.agentResourceService.getAgent = async () => ({
      id: 'agent_internal_debt',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Internal debt agent',
      mode: 'internal',
      status: 'enabled',
      interaction_kind: 'notebook',
    }) as never;
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
      agent_id: 'agent_internal_debt',
      agent_name: 'Internal debt agent',
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

    await expect(buildTaskRealtimeView(deps, task.workspace_id, task.project_id, task)).resolves.toMatchObject({
      id: task.id,
      run_state: 'terminating',
      stop_mode: 'terminate',
      can_escalate: false,
      escalation_reason: 'already_terminating',
    });
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
      agent_id: 'agent_realtime_run_started',
      agent_name: 'Realtime run agent',
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
});
