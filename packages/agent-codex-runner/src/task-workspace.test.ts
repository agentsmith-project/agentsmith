import { describe, expect, it } from 'vitest';
import { resolveTaskCwd } from './task-workspace.js';

describe('task-workspace', () => {
  it('prefers WORKSPACE_PATH when provided', () => {
    const resolved = resolveTaskCwd({
      workspacePath: ' /workspace ',
      username: 'alice',
      taskId: 'task_1',
    });
    expect(resolved).toEqual({
      cwd: '/workspace',
      source: 'workspace_path',
    });
  });

  it('falls back to /tmp/{username}/{taskId} when WORKSPACE_PATH is empty', () => {
    const resolved = resolveTaskCwd({
      workspacePath: '   ',
      username: 'alice',
      taskId: 'task_1',
    });
    expect(resolved).toEqual({
      cwd: '/tmp/alice/task_1',
      source: 'tmp_fallback',
    });
  });
});
