import { describe, expect, it } from 'vitest';
import { requiredProjectPermissions } from './required-project-permissions.js';

describe('requiredProjectPermissions', () => {
  it('requires endpoint and agent use permissions for terminal session routes', () => {
    expect(
      requiredProjectPermissions(
        {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        },
        'POST',
      ),
    ).toEqual(['project:endpoint:use', 'project:agent:use']);

    expect(
      requiredProjectPermissions(
        {
          kind: 'taskTerminalSession',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          terminalSessionId: 'term_1',
        },
        'GET',
      ),
    ).toEqual(['project:endpoint:use', 'project:agent:use']);
  });
});
