import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diffWorkspaceFileSnapshots,
  filterNewArtifactsForRun,
  rememberArtifactsForRun,
  scanArtifactsDirectory,
  scanWorkspaceFilesSnapshot,
  type ScannedArtifact,
} from './artifact-scan.js';

function makeArtifact(
  path: string,
  size = 100,
  mtime = 1,
): ScannedArtifact {
  return {
    filename: path.split('/').pop() ?? 'artifact.txt',
    task_relative_path: path,
    artifact_type: 'text',
    file_size: size,
    mtime_ms: mtime,
  };
}

describe('filterNewArtifactsForRun', () => {
  it('deduplicates repeated artifacts within the same run key', () => {
    const seen = new Map<string, Set<string>>();
    const artifact = makeArtifact('.artifacts/result.md');

    expect(filterNewArtifactsForRun(seen, 'run-a', [artifact])).toEqual([artifact]);
    expect(filterNewArtifactsForRun(seen, 'run-a', [artifact])).toEqual([]);
  });

  it('does not suppress the same artifact path across different run keys', () => {
    const seen = new Map<string, Set<string>>();
    const artifact = makeArtifact('.artifacts/result.md');

    expect(filterNewArtifactsForRun(seen, 'run-a', [artifact])).toEqual([artifact]);
    expect(filterNewArtifactsForRun(seen, 'run-b', [artifact])).toEqual([artifact]);
  });

  it('can seed an existing run with artifacts that predated the run', () => {
    const seen = new Map<string, Set<string>>();
    const existing = makeArtifact('.artifacts/old.png', 100, 1);
    const created = makeArtifact('.artifacts/new.png', 101, 2);

    rememberArtifactsForRun(seen, 'run-a', [existing]);

    expect(filterNewArtifactsForRun(seen, 'run-a', [existing, created])).toEqual([created]);
  });
});

describe('scanArtifactsDirectory', () => {
  it('scans only workspace/.artifacts and ignores HOME-level runtime directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runner-artifact-scan-'));
    try {
      const taskHome = join(root, 'task_home');
      const workspace = join(taskHome, 'workspace');
      const artifactsDir = join(workspace, '.artifacts');
      mkdirSync(artifactsDir, { recursive: true });
      mkdirSync(join(taskHome, '.artifacts'), { recursive: true });
      mkdirSync(join(taskHome, '.mbos'), { recursive: true });
      mkdirSync(join(taskHome, '.codex'), { recursive: true });
      mkdirSync(join(taskHome, '.agents'), { recursive: true });
      mkdirSync(join(taskHome, '.local'), { recursive: true });
      writeFileSync(join(artifactsDir, 'result.txt'), 'from workspace artifacts');
      writeFileSync(join(taskHome, '.artifacts', 'ignored-home-artifact.txt'), 'from home artifacts');
      writeFileSync(join(taskHome, '.mbos', 'ignored-runner-state.txt'), 'runner state');
      writeFileSync(join(taskHome, '.codex', 'ignored-codex-state.txt'), 'codex state');
      writeFileSync(join(taskHome, '.agents', 'ignored-skill.txt'), 'skill');
      writeFileSync(join(taskHome, '.local', 'ignored-install.txt'), 'install');

      const artifacts = await scanArtifactsDirectory(artifactsDir, 'task_1');

      expect(artifacts.map((artifact) => artifact.task_relative_path)).toEqual(['.artifacts/result.txt']);
      expect(artifacts[0]?.content).toBe('from workspace artifacts');
      expect(JSON.stringify(artifacts)).not.toContain('ignored-home-artifact');
      expect(JSON.stringify(artifacts)).not.toContain('ignored-runner-state');
      expect(JSON.stringify(artifacts)).not.toContain('ignored-codex-state');
      expect(JSON.stringify(artifacts)).not.toContain('ignored-skill');
      expect(JSON.stringify(artifacts)).not.toContain('ignored-install');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('workspace file snapshots', () => {
  it('filters file-library reserved namespaces and runtime/cache roots from workspace diffs', async () => {
    const visibleRoot = mkdtempSync(join(tmpdir(), 'runner-workspace-scan-'));
    try {
      const runtimeRoot = join(visibleRoot, '.runner-runtime');
      mkdirSync(join(visibleRoot, '.trash'), { recursive: true });
      mkdirSync(join(visibleRoot, '.minio.sys'), { recursive: true });
      mkdirSync(join(visibleRoot, '.cache'), { recursive: true });
      mkdirSync(join(visibleRoot, '.config'), { recursive: true });
      mkdirSync(join(visibleRoot, '.local'), { recursive: true });
      mkdirSync(join(visibleRoot, '.agents', 'skills'), { recursive: true });
      mkdirSync(join(visibleRoot, '.codex'), { recursive: true });
      mkdirSync(join(visibleRoot, '.mbos'), { recursive: true });
      mkdirSync(runtimeRoot, { recursive: true });
      writeFileSync(join(visibleRoot, 'user.txt'), 'user file');
      writeFileSync(join(visibleRoot, '.trash', 'deleted.txt'), 'reserved');
      writeFileSync(join(visibleRoot, '.minio.sys', 'meta.bin'), 'reserved');
      writeFileSync(join(visibleRoot, '.cache', 'tool-cache'), 'cache');
      writeFileSync(join(visibleRoot, '.config', 'tool.json'), 'config');
      writeFileSync(join(visibleRoot, '.local', 'state.db'), 'local');
      writeFileSync(join(visibleRoot, '.agents', 'skills', 'skill.md'), 'skill');
      writeFileSync(join(visibleRoot, '.codex', 'state.sqlite'), 'state');
      writeFileSync(join(visibleRoot, '.mbos', 'RUNNER_RUNTIME.md'), 'runtime');
      writeFileSync(join(runtimeRoot, 'state.json'), 'runtime root');

      const after = await scanWorkspaceFilesSnapshot(visibleRoot, { runtimeRoot });
      const changes = diffWorkspaceFileSnapshots(new Map(), after);

      expect(changes.added).toEqual(['user.txt']);
      expect(JSON.stringify(changes)).not.toContain('.trash');
      expect(JSON.stringify(changes)).not.toContain('.minio.sys');
      expect(JSON.stringify(changes)).not.toContain('.cache');
      expect(JSON.stringify(changes)).not.toContain('.config');
      expect(JSON.stringify(changes)).not.toContain('.runner-runtime');
    } finally {
      rmSync(visibleRoot, { recursive: true, force: true });
    }
  });
});
