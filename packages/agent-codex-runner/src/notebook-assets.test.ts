import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareNotebookWorkspaceAssets } from './notebook-assets.js';
import { buildTaskWorkspacePaths } from './task-workspace.js';

describe('prepareNotebookWorkspaceAssets', () => {
  it('does not overwrite an existing AGENTS.md file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-notebook-assets-'));
    try {
      writeFileSync(join(cwd, 'AGENTS.md'), 'existing-agents');

      await prepareNotebookWorkspaceAssets({
        cwd,
        paths: buildTaskWorkspacePaths(cwd, 'task_1'),
        executionContext: { task_id: 'task_1', run_id: 'run_1', workspace_binding_mode: 'file_library' },
        taskInputs: [],
      });

      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('existing-agents');
      expect(() => readFileSync(join(cwd, '.mbos', 'task-inputs.json'), 'utf8')).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('writes root AGENTS.md for pre-mounted workspaces too', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-notebook-assets-'));
    try {
      await prepareNotebookWorkspaceAssets({
        cwd,
        paths: buildTaskWorkspacePaths(cwd, 'task_2'),
        executionContext: { task_id: 'task_2', run_id: 'run_2', workspace_binding_mode: 'pre_mounted' },
        taskInputs: [],
      });

      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toContain('This workspace root is the persistent notebook environment');
      expect(() => readFileSync(join(cwd, '.mbos', 'task-inputs.json'), 'utf8')).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
