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
  it('selects the current ASBCP pod by raw ASBCP annotations when workload_id label carries a generated suffix', () => {
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
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': 'task-other',
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
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': taskWorkloadId,
              },
            },
          },
        ],
      },
    });

    expect(selected).toEqual({
      podName: `workload-${taskWorkloadId}`,
      workloadId: taskWorkloadId,
    });
  });

  it('selects ASBCP scoped/hash pod names by annotation truth instead of deriving the pod name locally', () => {
    const scopedPodName = `asbcp-ws-default-proj-default-${taskWorkloadId}-8f3c2b1a`;
    const selected = selectManagedWorkloadPodForTask({
      taskId,
      workspaceId,
      projectId,
      payload: {
        items: [
          {
            metadata: {
              name: scopedPodName,
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': taskWorkloadId,
              },
            },
          },
        ],
      },
    });

    expect(selected).toEqual({
      podName: scopedPodName,
      workloadId: taskWorkloadId,
    });
  });

  it('rejects ambiguous ASBCP pods that share the same raw workspace/project/workload annotations', () => {
    expect(() => selectManagedWorkloadPodForTask({
      taskId,
      workspaceId,
      projectId,
      payload: {
        items: [
          {
            metadata: {
              name: `asbcp-ws-default-proj-default-${taskWorkloadId}-aaaa`,
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': taskWorkloadId,
              },
            },
          },
          {
            metadata: {
              name: `asbcp-ws-default-proj-default-${taskWorkloadId}-bbbb`,
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': taskWorkloadId,
              },
            },
          },
        ],
      },
    })).toThrow('ambiguous_managed_workload_pod');
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
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': 'task-a512d9e420464a398d0f813b5f3d15a4',
              },
            },
          },
        ],
      },
    });

    expect(selected).toBeNull();
  });

  it('does not match task-extra when looking for task even if the hashed label shares the task prefix', () => {
    const selected = selectManagedWorkloadPodForTask({
      taskId: 'task',
      workspaceId,
      projectId,
      payload: {
        items: [
          {
            metadata: {
              name: 'workload-task-extra',
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-default-e04b05f9bca4',
                workload_id: 'task-extra-15772034fcfa',
              },
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': 'task-extra',
              },
            },
          },
        ],
      },
    });

    expect(selected).toBeNull();
  });

  it('requires raw ASBCP identity annotations instead of accepting legacy labels only', () => {
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
                app: 'managed-workload',
                workspace_id: workspaceId,
                project_id: projectId,
                workload_id: `${taskWorkloadId}-15772034fcfa`,
              },
            },
          },
        ],
      },
    });

    expect(selected).toBeNull();
  });

  it('requires the stable managed workload app label and raw project annotation before accepting a task pod', () => {
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
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': projectId,
                'mbos.io/workload-id': taskWorkloadId,
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
              annotations: {
                'mbos.io/workspace-id': workspaceId,
                'mbos.io/project-id': 'proj_other',
                'mbos.io/workload-id': taskWorkloadId,
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
