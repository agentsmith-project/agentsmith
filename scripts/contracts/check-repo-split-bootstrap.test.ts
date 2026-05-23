import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FORBIDDEN_RUNNER_REPO,
  RELEASE_KIT_CANONICAL_REPO,
  RUNNER_CANONICAL_REPO,
  validateRepoSplitBootstrap,
  type RepoSplitBootstrapResult,
} from './check-repo-split-bootstrap';

const CANONICAL_PARENT = '/home/percy/works/mbos-v1';
const CHECK_SCRIPT = path.join(process.cwd(), 'scripts/contracts/check-repo-split-bootstrap.ts');
const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
const tmpRoots: string[] = [];

function expectFailure(result: RepoSplitBootstrapResult, expectedReason: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('\n'))
      .toContain(expectedReason);
  }
}

function mkTempWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-split-bootstrap-'));
  tmpRoots.push(root);
  mkdirSync(path.join(root, 'agentsmith'), { recursive: true });
  return root;
}

function initGitRepo(repoPath: string, origin?: string): void {
  mkdirSync(repoPath, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
  if (origin !== undefined) {
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: repoPath, stdio: 'ignore' });
  }
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('repo split bootstrap contract', () => {
  it('accepts the release-kit sibling path with HTTPS or SSH origins normalized to the canonical repo', () => {
    for (const remoteUrl of [
      'https://github.com/agentsmith-project/agentsmith-release-kit.git',
      'git@github.com:agentsmith-project/agentsmith-release-kit.git',
    ]) {
      expect(validateRepoSplitBootstrap({
        mode: 'local',
        repo: 'release-kit',
        repoPath: `${CANONICAL_PARENT}/agentsmith-release-kit`,
        remoteUrl,
      })).toMatchObject({
        ok: true,
        status: 'canonical',
        repo_name: 'agentsmith-release-kit',
        normalized_remote: RELEASE_KIT_CANONICAL_REPO,
      });
    }
  });

  it('accepts the runner sibling path with a canonical normalized origin', () => {
    expect(validateRepoSplitBootstrap({
      mode: 'local',
      repo: 'runner',
      repoPath: `${CANONICAL_PARENT}/agentsmith-runner`,
      remoteUrl: 'ssh://git@github.com/agentsmith-project/agentsmith-runner.git',
    })).toMatchObject({
      ok: true,
      status: 'canonical',
      repo_name: 'agentsmith-runner',
      normalized_remote: RUNNER_CANONICAL_REPO,
    });
  });

  it('fails fast when the candidate repo is under the wrong parent or nested below agentsmith', () => {
    expectFailure(
      validateRepoSplitBootstrap({
        mode: 'local',
        repo: 'runner',
        repoPath: `${CANONICAL_PARENT}/agentsmith/agentsmith-runner`,
        remoteUrl: 'git@github.com:agentsmith-project/agentsmith-runner.git',
      }),
      'repoPath must be a sibling of agentsmith, not nested under agentsmith',
    );

    expectFailure(
      validateRepoSplitBootstrap({
        mode: 'local',
        repo: 'release-kit',
        repoPath: '/home/percy/works/agentsmith-release-kit',
        remoteUrl: 'git@github.com:agentsmith-project/agentsmith-release-kit.git',
      }),
      `repoPath parent must be ${CANONICAL_PARENT}`,
    );
  });

  it('fails fast when the origin belongs to the wrong org or repo', () => {
    expectFailure(
      validateRepoSplitBootstrap({
        mode: 'local',
        repo: 'runner',
        repoPath: `${CANONICAL_PARENT}/agentsmith-runner`,
        remoteUrl: 'git@github.com:someone-else/agentsmith-runner.git',
      }),
      `normalized repo identity must be ${RUNNER_CANONICAL_REPO}`,
    );

    expectFailure(
      validateRepoSplitBootstrap({
        mode: 'local',
        repo: 'release-kit',
        repoPath: `${CANONICAL_PARENT}/agentsmith-release-kit`,
        remoteUrl: 'git@github.com:agentsmith-project/not-release-kit.git',
      }),
      `normalized repo identity must be ${RELEASE_KIT_CANONICAL_REPO}`,
    );
  });

  it('rejects agentsmith-codex-runner for formal runner bootstrap but accepts it as explicit migration input', () => {
    expectFailure(
      validateRepoSplitBootstrap({
        mode: 'local',
        repo: 'runner',
        repoPath: `${CANONICAL_PARENT}/agentsmith-runner`,
        remoteUrl: 'git@github.com:agentsmith-project/agentsmith-codex-runner.git',
      }),
      'agentsmith-codex-runner is migration_input only and must not be used as canonical runner bootstrap',
    );

    expect(validateRepoSplitBootstrap({
      mode: 'local',
      repo: 'runner-migration',
      repoPath: `${CANONICAL_PARENT}/agentsmith-codex-runner`,
      remoteUrl: 'git@github.com:agentsmith-project/agentsmith-codex-runner.git',
    })).toMatchObject({
      ok: true,
      status: 'migration_input',
      repo_name: 'agentsmith-codex-runner',
      normalized_remote: FORBIDDEN_RUNNER_REPO,
      migration_to: RUNNER_CANONICAL_REPO,
    });
  });

  it('keeps CI mode independent from Percy local paths and validates only normalized identity', () => {
    expect(validateRepoSplitBootstrap({
      mode: 'ci',
      repo: 'runner',
      remoteUrl: 'https://github.com/agentsmith-project/agentsmith-runner.git',
    })).toMatchObject({
      ok: true,
      status: 'canonical',
      normalized_remote: RUNNER_CANONICAL_REPO,
    });

    expectFailure(
      validateRepoSplitBootstrap({
        mode: 'ci',
        repo: 'runner',
        remoteUrl: 'https://github.com/agentsmith-project/agentsmith-codex-runner.git',
      }),
      'agentsmith-codex-runner is migration_input only and must not be used as canonical runner bootstrap',
    );
  });

  it('does not let --remote-url spoof CI identity when GitHub Actions exposes the checked out repo', () => {
    expect(() =>
      execFileSync(tsxCli, [
        CHECK_SCRIPT,
        '--mode=ci',
        '--repo=runner',
        '--remote-url=https://github.com/agentsmith-project/agentsmith-runner.git',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GITHUB_REPOSITORY: 'someone-else/agentsmith-runner',
        },
        stdio: 'pipe',
      }),
    ).toThrow(/GITHUB_REPOSITORY must match github\.com\/agentsmith-project\/agentsmith-runner/u);
  });

  it('reports missing local repos and missing origin remotes clearly in the CLI without network access', () => {
    const workspaceRoot = mkTempWorkspace();
    const missingRepoPath = path.join(workspaceRoot, 'agentsmith-runner');

    expect(() =>
      execFileSync(tsxCli, [
        CHECK_SCRIPT,
        '--mode=local',
        '--repo=runner',
        `--repo-path=${missingRepoPath}`,
        `--workspace-parent=${workspaceRoot}`,
      ], { cwd: process.cwd(), stdio: 'pipe' }),
    ).toThrow(/repoPath must exist before bootstrap validation can read origin/u);

    mkdirSync(missingRepoPath);
    execFileSync('git', ['init'], { cwd: missingRepoPath, stdio: 'ignore' });

    expect(() =>
      execFileSync(tsxCli, [
        CHECK_SCRIPT,
        '--mode=local',
        '--repo=runner',
        `--repo-path=${missingRepoPath}`,
        `--workspace-parent=${workspaceRoot}`,
      ], { cwd: process.cwd(), stdio: 'pipe' }),
    ).toThrow(/origin remote is required/u);

    expect(() =>
      execFileSync(tsxCli, [
        CHECK_SCRIPT,
        '--mode=local',
        '--repo=runner',
        `--repo-path=${missingRepoPath}`,
        '--remote-url=git@github.com:agentsmith-project/agentsmith-runner.git',
        `--workspace-parent=${workspaceRoot}`,
      ], { cwd: process.cwd(), stdio: 'pipe' }),
    ).toThrow(/origin remote is required/u);
  });

  it('does not let --remote-url hide a wrong local origin in CLI local mode', () => {
    const workspaceRoot = mkTempWorkspace();
    const repoPath = path.join(workspaceRoot, 'agentsmith-runner');
    initGitRepo(repoPath, 'git@github.com:someone-else/agentsmith-runner.git');

    expect(() =>
      execFileSync(tsxCli, [
        CHECK_SCRIPT,
        '--mode=local',
        '--repo=runner',
        `--repo-path=${repoPath}`,
        '--remote-url=git@github.com:agentsmith-project/agentsmith-runner.git',
        `--workspace-parent=${workspaceRoot}`,
      ], { cwd: process.cwd(), stdio: 'pipe' }),
    ).toThrow(/remote-url must match the actual origin remote/u);
  });

  it('accepts --remote-url as a normalized consistency check when it matches the local origin', () => {
    const workspaceRoot = mkTempWorkspace();
    const repoPath = path.join(workspaceRoot, 'agentsmith-runner');
    initGitRepo(repoPath, 'git@github.com:agentsmith-project/agentsmith-runner.git');

    const output = execFileSync(tsxCli, [
      CHECK_SCRIPT,
      '--mode=local',
      '--repo=runner',
      `--repo-path=${repoPath}`,
      '--remote-url=https://github.com/agentsmith-project/agentsmith-runner.git',
      `--workspace-parent=${workspaceRoot}`,
    ], { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });

    expect(output).toContain(`${RUNNER_CANONICAL_REPO}`);
  });

  it('exposes the repo split bootstrap check but does not wire it into contracts:check yet', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['contracts:check-repo-split-bootstrap'])
      .toBe('tsx scripts/contracts/check-repo-split-bootstrap.ts');
    expect(packageJson.scripts?.['contracts:check'] ?? '')
      .not.toContain('contracts:check-repo-split-bootstrap');
  });
});
