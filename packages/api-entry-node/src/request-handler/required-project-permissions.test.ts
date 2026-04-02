import { describe, expect, it } from 'vitest';
import { requiredProjectPermissions } from './required-project-permissions.js';

describe('requiredProjectPermissions', () => {
  it('requires explicit terminal permission for terminal session routes', () => {
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
    ).toEqual(['project:terminal:use']);

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
    ).toEqual(['project:terminal:use']);
  });
});
