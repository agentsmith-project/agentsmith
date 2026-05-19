import { describe, expect, it } from 'vitest';
import {
  sanitizeWorkloadId,
  selectManagedWorkloadPodForTask,
} from './agent-task-workload-pod-selector.mjs';

const taskId = 'task_a512d9e420464a398d0f813b5f3d15a3';
const taskWorkloadId = 'task-a512d9e420464a398d0f813b5f3d15a3';
const workspaceId = 'ws_default';
const projectId = 'proj_default';

describe('agent task workload pod selector', () => {
  it('selects the current ASBCP pod when workload_id carries a generated suffix', () => {
    const selected = selectManagedWorkloadPodForTask({
      taskId,
      workspaceId,
      projectId,
      payload: {
        items: [
          {
            metadata: {
              name: 'workload-task-other',
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: 'task-other-15772034fcfa',
              },
            },
          },
          {
            metadata: {
              name: `workload-${taskWorkloadId}`,
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
            },
          },
        ],
      },
    });

    expect(selected).toEqual({
      podName: `workload-${taskWorkloadId}`,
      workloadId: `${taskWorkloadId}-15772034fcfa`,
    });
  });

  it('does not match another task pod that only shares the managed workload app label', () => {
    const selected = selectManagedWorkloadPodForTask({
      taskId,
      workspaceId,
      projectId,
      payload: {
        items: [
          {
            metadata: {
              name: 'workload-task-a512d9e420464a398d0f813b5f3d15a4',
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: 'task-a512d9e420464a398d0f813b5f3d15a4-15772034fcfa',
              },
            },
          },
        ],
      },
    });

    expect(selected).toBeNull();
  });

  it('requires the stable managed workload app and project labels before accepting a task-derived pod name', () => {
    const selected = selectManagedWorkloadPodForTask({
      taskId,
      workspaceId,
      projectId,
      payload: {
        items: [
          {
            metadata: {
              name: `workload-${taskWorkloadId}`,
              labels: {
                app: 'legacy-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
            },
          },
          {
            metadata: {
              name: `workload-${taskWorkloadId}`,
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj_other',
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
            },
          },
        ],
      },
    });

    expect(selected).toBeNull();
  });

  it('uses the same task workload sanitizer as the internal AgentSmith runtime contract', () => {
    expect(sanitizeWorkloadId('TASK_ABC.123###')).toBe('task-abc-123');
    expect(sanitizeWorkloadId('---')).toBe('workload');
  });
});
