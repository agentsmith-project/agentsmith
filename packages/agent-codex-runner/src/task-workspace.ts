import { join } from 'node:path';

function sanitizeWorkspacePath(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return value;
}

export function resolveTaskCwd(input: {
  workspacePath?: string;
  username: string;
  taskId: string;
}): { cwd: string; source: 'workspace_path' | 'tmp_fallback' } {
  const workspacePath = sanitizeWorkspacePath(input.workspacePath);
  if (workspacePath) {
    return {
      cwd: workspacePath,
      source: 'workspace_path',
    };
  }
  return {
    cwd: join('/tmp', input.username, input.taskId),
    source: 'tmp_fallback',
  };
}
