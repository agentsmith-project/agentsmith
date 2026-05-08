import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function stageToolPath(tempRoot: string): string {
  const binDir = path.join(tempRoot, 'bin');
  writeExecutable(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  writeExecutable(path.join(binDir, 'kind'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  return binDir;
}

function stageReleaseRoot(tempRoot: string, versionContent?: string): string {
  const releaseRoot = path.join(tempRoot, 'release');
  mkdirSync(path.join(releaseRoot, 'tools'), { recursive: true });
  writeExecutable(path.join(releaseRoot, 'tools', 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  writeExecutable(path.join(releaseRoot, 'tools', 'kind'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  if (versionContent !== undefined) {
    writeFileSync(path.join(releaseRoot, 'VERSION'), versionContent, 'utf8');
  }
  return releaseRoot;
}

function writeReleaseEnv(releaseRoot: string, name: string, content: string): void {
  const envDir = path.join(releaseRoot, 'env');
  mkdirSync(envDir, { recursive: true });
  writeFileSync(path.join(envDir, name), content, 'utf8');
}

function runBash(script: string, env: NodeJS.ProcessEnv = {}) {
  const baseEnv = { ...process.env };
  for (const key of [
    'DEPLOY_ROOT',
    'DEPLOY_ROOT_DEFAULT',
    'RELEASE_ID',
    'RELEASE_ROOT',
  ]) {
    delete baseEnv[key];
  }
  return spawnSync('bash', ['-lc', script], {
    cwd: repoRoot,
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
  });
}

describe('deploy-common release id truth', () => {
  it('uses RELEASE_ROOT/VERSION release_id when RELEASE_ID is not explicit', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-version-truth-'));
    try {
      const releaseRoot = stageReleaseRoot(tempRoot, 'release_id=version-release\n');
      const result = runBash(
        'source scripts/lib/deploy-common.sh\nprintf "%s\\n" "${RELEASE_ID}"',
        {
          DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
          HOME: tempRoot,
          PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
          RELEASE_ROOT: releaseRoot,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('version-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when load_release_env sees a stale RELEASE_ID without leaking values', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-load-env-stale-release-id-'));
    try {
      const releaseRoot = stageReleaseRoot(tempRoot, 'release_id=version-release\n');
      writeReleaseEnv(releaseRoot, 'site.env', 'RELEASE_ID=stale-release\n');
      const result = runBash('source scripts/lib/deploy-common.sh\nload_release_env', {
        DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
        HOME: tempRoot,
        PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
        RELEASE_ROOT: releaseRoot,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('RELEASE_ID does not match VERSION release_id');
      expect(result.stderr).not.toContain('stale-release');
      expect(result.stderr).not.toContain('version-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps VERSION release_id when load_release_env sees the matching RELEASE_ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-load-env-matching-release-id-'));
    try {
      const releaseRoot = stageReleaseRoot(tempRoot, 'release_id=version-release\n');
      writeReleaseEnv(releaseRoot, 'site.env', 'RELEASE_ID=version-release\n');
      const result = runBash(
        'source scripts/lib/deploy-common.sh\nload_release_env\nprintf "%s\\n" "${RELEASE_ID}"',
        {
          DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
          HOME: tempRoot,
          PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
          RELEASE_ROOT: releaseRoot,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('version-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('continues importing non-RELEASE_ID values from load_release_env', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-load-env-other-values-'));
    try {
      const releaseRoot = stageReleaseRoot(tempRoot, 'release_id=version-release\n');
      writeReleaseEnv(releaseRoot, 'site.env', 'DEPLOY_COMMON_TEST_VALUE="kept value"\n');
      const result = runBash(
        'source scripts/lib/deploy-common.sh\nload_release_env\nprintf "%s\\n%s\\n" "${RELEASE_ID}" "${DEPLOY_COMMON_TEST_VALUE}"',
        {
          DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
          HOME: tempRoot,
          PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
          RELEASE_ROOT: releaseRoot,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual(['version-release', 'kept value']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when explicit RELEASE_ID disagrees with VERSION release_id without leaking values', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-version-mismatch-'));
    try {
      const explicitReleaseId = 'explicit-secret-release';
      const versionReleaseId = 'version-secret-release';
      const releaseRoot = stageReleaseRoot(tempRoot, `release_id=${versionReleaseId}\n`);
      const result = runBash('source scripts/lib/deploy-common.sh', {
        DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
        HOME: tempRoot,
        PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
        RELEASE_ID: explicitReleaseId,
        RELEASE_ROOT: releaseRoot,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('RELEASE_ID does not match VERSION release_id');
      expect(result.stderr).not.toContain(explicitReleaseId);
      expect(result.stderr).not.toContain(versionReleaseId);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing release_id', 'registry_host=localhost:5001\n'],
    ['empty release_id', 'release_id=\nregistry_host=localhost:5001\n'],
  ])('fails closed when RELEASE_ROOT/VERSION exists with %s', (_caseName, versionContent) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-version-missing-release-id-'));
    try {
      const explicitReleaseId = 'explicit-secret-release';
      const releaseRoot = stageReleaseRoot(tempRoot, versionContent);
      const result = runBash('source scripts/lib/deploy-common.sh', {
        DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
        HOME: tempRoot,
        PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
        RELEASE_ID: explicitReleaseId,
        RELEASE_ROOT: releaseRoot,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('VERSION is missing release_id');
      expect(result.stderr).not.toContain(explicitReleaseId);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps explicit RELEASE_ID and generates one when VERSION is absent', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-no-version-'));
    try {
      const toolPath = stageToolPath(tempRoot);
      const explicitReleaseRoot = stageReleaseRoot(tempRoot);
      const explicitResult = runBash(
        'source scripts/lib/deploy-common.sh\nprintf "%s\\n" "${RELEASE_ID}"',
        {
          DEPLOY_ROOT: path.join(tempRoot, 'deploy-root-explicit'),
          HOME: tempRoot,
          PATH: `${toolPath}:${process.env.PATH ?? ''}`,
          RELEASE_ID: 'explicit-release',
          RELEASE_ROOT: explicitReleaseRoot,
        },
      );

      expect(explicitResult.status).toBe(0);
      expect(explicitResult.stdout.trim()).toBe('explicit-release');

      const generatedDeployRoot = path.join(tempRoot, 'deploy-root-generated');
      const generatedResult = runBash(
        'source scripts/lib/deploy-common.sh\nprintf "%s\\n%s\\n" "${RELEASE_ID}" "${RELEASE_ROOT}"',
        {
          DEPLOY_ROOT: generatedDeployRoot,
          HOME: tempRoot,
          PATH: `${toolPath}:${process.env.PATH ?? ''}`,
        },
      );

      expect(generatedResult.status).toBe(0);
      const [generatedReleaseId, generatedReleaseRoot] = generatedResult.stdout.trim().split('\n');
      expect(generatedReleaseId).toMatch(/^\d{8}T\d{6}Z$/);
      expect(generatedReleaseRoot).toBe(path.join(generatedDeployRoot, 'releases', generatedReleaseId));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('records release.id from VERSION truth when deploy state writes RELEASE_ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-common-state-'));
    try {
      const releaseRoot = stageReleaseRoot(tempRoot, 'release_id=version-state-release\n');
      const result = runBash(
        [
          'source scripts/lib/deploy-common.sh',
          'state_set release.id "${RELEASE_ID}"',
          'state_get release.id',
        ].join('\n'),
        {
          DEPLOY_ROOT: path.join(tempRoot, 'deploy-root'),
          HOME: tempRoot,
          PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
          RELEASE_ROOT: releaseRoot,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('version-state-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
