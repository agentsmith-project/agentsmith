import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareTaskWorkspaceAssets } from './task-assets.js';
import { buildTaskWorkspacePaths } from './task-workspace.js';

describe('prepareTaskWorkspaceAssets', () => {
  it('does not overwrite an existing AGENTS.md file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-task-assets-'));
    const runtimeStateRoot = `${cwd}-runtime`;
    try {
      process.env.MBOS_AGENT_CODEX_STATE_ROOT = runtimeStateRoot;
      const paths = buildTaskWorkspacePaths(cwd, 'developer');
      writeFileSync(join(cwd, 'AGENTS.md'), 'existing-agents');

      await prepareTaskWorkspaceAssets({
        cwd,
        paths,
        executionContext: { task_id: 'task_1', run_id: 'run_1', workspace_binding_mode: 'file_library' },
        taskInputs: [],
      });

      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('existing-agents');
      expect(() => readFileSync(join(cwd, '.mbos', 'RUNNER_RUNTIME.md'), 'utf8')).toThrow();
      const runtimeContract = readFileSync(join(paths.mbosDir, 'RUNNER_RUNTIME.md'), 'utf8');
      expect(runtimeContract).not.toContain('HOME == cwd');
      expect(runtimeContract).toContain('runner-private runtime home');
      expect(() => readFileSync(join(cwd, '.mbos', 'task-inputs.json'), 'utf8')).toThrow();
    } finally {
      delete process.env.MBOS_AGENT_CODEX_STATE_ROOT;
      rmSync(runtimeStateRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('writes root AGENTS.md for pre-mounted workspaces too', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-task-assets-'));
    const runtimeStateRoot = `${cwd}-runtime`;
    try {
      process.env.MBOS_AGENT_CODEX_STATE_ROOT = runtimeStateRoot;
      const paths = buildTaskWorkspacePaths(cwd, 'managed_platform');
      await prepareTaskWorkspaceAssets({
        cwd,
        paths,
        executionContext: { task_id: 'task_2', run_id: 'run_2', workspace_binding_mode: 'pre_mounted' },
        taskInputs: [],
      });

      const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
      const runtime = readFileSync(join(paths.mbosDir, 'RUNNER_RUNTIME.md'), 'utf8');
      expect(agents).not.toContain('HOME` is the same directory as the current workspace root');
      expect(agents).toContain('The current working directory is the user file workspace root');
      expect(agents).toContain('capability-aware builtin skills');
      expect(agents).toContain('member/task context');
      expect(agents).toContain('inspect project_member context');
      expect(runtime).not.toContain('HOME == cwd');
      expect(runtime).toContain('runner-private runtime home');
      expect(runtime).toContain('project_member');
      expect(runtime).toContain('machine-readable capability contracts');
      expect(runtime).toContain('read project_member');
      expect(runtime).toContain('write member/task');
      expect(() => readFileSync(join(cwd, '.mbos', 'task-inputs.json'), 'utf8')).toThrow();
    } finally {
      delete process.env.MBOS_AGENT_CODEX_STATE_ROOT;
      rmSync(runtimeStateRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
