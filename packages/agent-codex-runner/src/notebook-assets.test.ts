import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareNotebookWorkspaceAssets } from './notebook-assets.js';
import { buildTaskWorkspacePaths } from './task-workspace.js';

describe('prepareNotebookWorkspaceAssets', () => {
  it('does not overwrite an existing AGENTS.md file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-notebook-assets-'));
    try {
      mkdirSync(join(cwd, '.mbos'), { recursive: true });
      writeFileSync(join(cwd, 'AGENTS.md'), 'existing-agents');

      await prepareNotebookWorkspaceAssets({
        cwd,
        paths: buildTaskWorkspacePaths(cwd, 'task_1'),
        executionContext: { task_id: 'task_1', run_id: 'run_1' },
        taskInputs: [],
      });

      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('existing-agents');
      expect(readFileSync(join(cwd, '.mbos', 'tasks', 'task_1', 'task-inputs.json'), 'utf8')).toContain('"task_id": "task_1"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
