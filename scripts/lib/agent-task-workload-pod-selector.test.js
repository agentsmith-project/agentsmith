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

  it('selects ASBCP scoped/hash pod names by label truth instead of deriving the pod name locally', () => {
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
            },
          },
        ],
      },
    });

    expect(selected).toEqual({
      podName: scopedPodName,
      workloadId: `${taskWorkloadId}-15772034fcfa`,
    });
  });

  it('rejects ambiguous ASBCP pods that share the same workspace/project/workload label truth', () => {
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
            },
          },
        ],
      },
    });

    expect(selected).toBeNull();
  });

  it('accepts legacy raw workspace and project labels while matching the task-derived workload pod', () => {
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

    expect(selected).toEqual({
      podName: `workload-${taskWorkloadId}`,
      workloadId: `${taskWorkloadId}-15772034fcfa`,
    });
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
