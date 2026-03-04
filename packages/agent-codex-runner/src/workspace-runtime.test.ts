import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveTaskCwd, shouldResumeNotebookSession } from './workspace-runtime.js';

describe('workspace-runtime', () => {
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

  it('resumes notebook session from memory marker first', () => {
    const result = shouldResumeNotebookSession({
      isNotebookMode: true,
      cwd: '/tmp/a/b',
      hasSessionInMemory: true,
    });
    expect(result).toEqual({
      resumeLast: true,
      source: 'memory',
    });
  });

  it('resumes notebook session from filesystem marker when memory marker is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'runner-ws-'));
    try {
      mkdirSync(join(root, '.codex', 'sessions'), { recursive: true });
      const result = shouldResumeNotebookSession({
        isNotebookMode: true,
        cwd: root,
        hasSessionInMemory: false,
      });
      expect(result).toEqual({
        resumeLast: true,
        source: 'filesystem',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not resume outside notebook mode', () => {
    const result = shouldResumeNotebookSession({
      isNotebookMode: false,
      cwd: '/tmp/a/b',
      hasSessionInMemory: true,
    });
    expect(result).toEqual({
      resumeLast: false,
      source: 'none',
    });
  });
});
