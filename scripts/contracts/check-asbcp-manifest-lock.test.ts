import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkAsbcpManifestLock } from './check-asbcp-manifest-lock';

const CANONICAL_REPO = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const DIGEST_A = `sha256:${'0123456789abcdef'.repeat(4)}`;
const DIGEST_B = `sha256:${'fedcba9876543210'.repeat(4)}`;
const COMMIT_A = '1234567890abcdef1234567890abcdef12345678';
const COMMIT_B = 'abcdef1234567890abcdef1234567890abcdef12';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'asbcp-manifest-lock-'));
  roots.push(root);
  return root;
}

function writeFixture(root: string, path: string, content: string): string {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function writeJsonFixture(root: string, path: string, value: Record<string, unknown>): string {
  return writeFixture(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeLock(
  root: string,
  overrides: Partial<{
    version: string;
    sourceImage: string;
    releaseUrl: string;
    commitSha: string;
  }> = {},
): string {
  const version = overrides.version ?? 'v1.2.3';
  return writeFixture(root, 'asbcp-image.lock', [
    `asbcp_version=${version}`,
    `asbcp_source_image=${overrides.sourceImage ?? `${CANONICAL_REPO}:${version}@${DIGEST_A}`}`,
    `asbcp_release_url=${overrides.releaseUrl ?? `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/${version}`}`,
    `asbcp_commit_sha=${overrides.commitSha ?? COMMIT_A}`,
    '',
  ].join('\n'));
}

function manifest(
  overrides: Partial<{
    version: string;
    gitTag: string;
    commitSha: string;
    imageRef: string;
    imageDigest: string;
    sameDigestMatches: boolean;
    anonymousPullResult: string | boolean;
  }> = {},
): Record<string, unknown> {
  const version = overrides.version ?? 'v1.2.3';
  return {
    asbcp_version: version,
    git_tag: overrides.gitTag ?? version,
    commit_sha: overrides.commitSha ?? COMMIT_A,
    image_ref: overrides.imageRef ?? `${CANONICAL_REPO}:${version}@${DIGEST_A}`,
    image_digest: overrides.imageDigest ?? DIGEST_A,
    same_digest_proof: {
      matches: overrides.sameDigestMatches ?? true,
    },
    anonymous_pull: {
      result: overrides.anonymousPullResult ?? 'ok',
    },
  };
}

function failureText(result: ReturnType<typeof checkAsbcpManifestLock>): string {
  return result.failures
    .map((failure) => `${failure.field}: ${failure.message}`)
    .join('\n');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkAsbcpManifestLock', () => {
  it('accepts a release manifest that matches the AgentSmith ASBCP image lock', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest());

    expect(checkAsbcpManifestLock({ manifestPath, lockPath })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects a manifest version/tag that does not match the lock version', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      version: 'v1.2.4',
      gitTag: 'v1.2.4',
      imageRef: `${CANONICAL_REPO}:v1.2.4@${DIGEST_A}`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.version');
    expect(failureText(result)).toContain('v1.2.3');
    expect(failureText(result)).toContain('v1.2.4');
  });

  it('rejects a split-brain manifest when asbcp_version drifts but git_tag matches the lock', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      version: 'v9.9.9',
      gitTag: 'v1.2.3',
      imageRef: `${CANONICAL_REPO}:v1.2.3@${DIGEST_A}`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.version');
    expect(failureText(result)).toContain('asbcp_version');
    expect(failureText(result)).toContain('git_tag');
  });

  it('rejects a manifest image digest that does not match the lock digest', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      imageRef: `${CANONICAL_REPO}:v1.2.3@${DIGEST_B}`,
      imageDigest: DIGEST_B,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });
    const text = failureText(result);

    expect(result.ok).toBe(false);
    expect(text).toContain('manifest.image_ref');
    expect(text).toContain('manifest.image_digest');
    expect(text).toContain(DIGEST_A);
    expect(text).toContain(DIGEST_B);
  });

  it('rejects a manifest commit SHA that does not match the lock commit SHA', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      commitSha: COMMIT_B,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.commit_sha');
    expect(failureText(result)).toContain(COMMIT_A);
    expect(failureText(result)).toContain(COMMIT_B);
  });

  it('rejects a manifest whose same_digest_proof.matches is false', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      sameDigestMatches: false,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.same_digest_proof.matches');
  });

  it('rejects CLI usage without the required manifest argument', () => {
    const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsxCli, ['scripts/contracts/check-asbcp-manifest-lock.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('manifest');
    expect(result.stderr).toContain('--manifest');
  });

  it('rejects a manifest image outside the canonical ASBCP GHCR repository', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      imageRef: `ghcr.io/example/agentsmith-sandbox-control-plane:v1.2.3@${DIGEST_A}`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.image_ref');
    expect(failureText(result)).toContain(CANONICAL_REPO);
  });
});
