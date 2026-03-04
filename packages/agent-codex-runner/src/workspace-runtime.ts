import { existsSync } from 'node:fs';
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

export function shouldResumeNotebookSession(input: {
  isNotebookMode: boolean;
  cwd: string;
  hasSessionInMemory: boolean;
}): {
  resumeLast: boolean;
  source: 'memory' | 'filesystem' | 'none';
} {
  if (!input.isNotebookMode) {
    return { resumeLast: false, source: 'none' };
  }
  if (input.hasSessionInMemory) {
    return { resumeLast: true, source: 'memory' };
  }
  const hasPersistedSession = existsSync(join(input.cwd, '.codex', 'sessions'));
  if (hasPersistedSession) {
    return { resumeLast: true, source: 'filesystem' };
  }
  return { resumeLast: false, source: 'none' };
}
