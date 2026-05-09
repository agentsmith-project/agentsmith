import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareTaskWorkspaceAssets } from './task-assets.js';
import { buildTaskWorkspacePaths } from './task-workspace.js';

describe('prepareTaskWorkspaceAssets', () => {
  it('does not overwrite an existing AGENTS.md file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-task-assets-'));
    const taskHome = join(cwd, 'home', 'task_1');
    const workspace = join(taskHome, 'workspace');
    try {
      const paths = buildTaskWorkspacePaths({
        mode: 'developer',
        taskHomePath: taskHome,
        workspacePath: workspace,
        artifactsPath: join(workspace, '.artifacts'),
      });
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'AGENTS.md'), 'existing-agents');

      await prepareTaskWorkspaceAssets({
        cwd: workspace,
        paths,
        executionContext: { task_id: 'task_1', run_id: 'run_1', workspace_binding_mode: 'file_library' },
        taskInputs: [],
      });

      expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toBe('existing-agents');
      expect(() => readFileSync(join(workspace, '.mbos', 'RUNNER_RUNTIME.md'), 'utf8')).toThrow();
      const runtimeContract = readFileSync(join(paths.mbosDir, 'RUNNER_RUNTIME.md'), 'utf8');
      expect(runtimeContract).not.toContain('HOME == cwd');
      expect(runtimeContract).not.toContain('runner-private runtime home');
      expect(runtimeContract).not.toContain('separate from `cwd`');
      expect(runtimeContract).not.toContain('auth material');
      expect(runtimeContract).not.toContain('mutable auth');
      expect(runtimeContract).toContain('persistent task HOME');
      expect(() => readFileSync(join(workspace, '.mbos', 'task-inputs.json'), 'utf8')).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('writes root AGENTS.md for pre-mounted workspaces too', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-task-assets-'));
    const taskHome = join(cwd, 'home', 'task_2');
    const workspace = join(taskHome, 'workspace');
    try {
      const paths = buildTaskWorkspacePaths({
        mode: 'developer',
        taskHomePath: taskHome,
        workspacePath: workspace,
        artifactsPath: join(workspace, '.artifacts'),
      });
      await prepareTaskWorkspaceAssets({
        cwd: workspace,
        paths,
        executionContext: { task_id: 'task_2', run_id: 'run_2', workspace_binding_mode: 'pre_mounted' },
        taskInputs: [],
      });

      const agents = readFileSync(join(workspace, 'AGENTS.md'), 'utf8');
      const runtime = readFileSync(join(paths.mbosDir, 'RUNNER_RUNTIME.md'), 'utf8');
      expect(agents).not.toContain('HOME` is the same directory as the current workspace root');
      expect(agents).not.toContain('runner-private runtime home');
      expect(agents).not.toContain('outside `cwd`');
      expect(agents).not.toContain('auth material');
      expect(agents).not.toContain('mutable auth');
      expect(agents).toContain('The current working directory is `$HOME/workspace`');
      expect(agents).toContain('capability-aware builtin skills');
      expect(agents).toContain('member/task context');
      expect(agents).toContain('inspect project_member context');
      expect(runtime).not.toContain('HOME == cwd');
      expect(runtime).not.toContain('runner-private runtime home');
      expect(runtime).not.toContain('separate from `cwd`');
      expect(runtime).not.toContain('auth material');
      expect(runtime).not.toContain('mutable auth');
      expect(runtime).toContain('persistent task HOME');
      expect(runtime).toContain('project_member');
      expect(runtime).toContain('machine-readable capability contracts');
      expect(runtime).toContain('read project_member');
      expect(runtime).toContain('write member/task');
      expect(() => readFileSync(join(workspace, '.mbos', 'task-inputs.json'), 'utf8')).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
