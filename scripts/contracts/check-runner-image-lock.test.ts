import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkRunnerImageLock,
  formatRunnerImageLockFailures,
} from './check-runner-image-lock';
import {
  canonicalReleaseBoundaryJson,
  sha256Digest,
} from '../governance/current-release-boundary-schema';

const FIXTURE_ROOT = join(process.cwd(), 'scripts', 'governance', '__fixtures__', 'release-boundary');
const CANONICAL_LOCK = join(process.cwd(), 'release', 'agentsmith-runner-image.lock');
const MANIFEST_FIXTURE = join(FIXTURE_ROOT, 'runner-release-manifest.valid.json');

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'runner-image-lock-'));
  roots.push(root);
  return root;
}

function writeFixture(root: string, path: string, content: string): string {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function writeLock(root: string, mutate: (source: string) => string = (source) => source): string {
  return writeFixture(root, 'agentsmith-runner-image.lock', mutate(readFileSync(CANONICAL_LOCK, 'utf8')));
}

function manifestFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(MANIFEST_FIXTURE, 'utf8')) as Record<string, unknown>;
}

function writeManifest(
  root: string,
  mutate: (manifest: Record<string, unknown>) => void = () => undefined,
): string {
  const manifest = manifestFixture();
  mutate(manifest);
  return writeFixture(root, 'runner-release-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

function rehashManifestSubject(manifest: Record<string, unknown>): void {
  const subject = structuredClone(manifest);
  delete subject.artifact_provenance;
  const provenance = manifest.artifact_provenance as Record<string, unknown>;
  const subjectSha256 = sha256Digest(canonicalReleaseBoundaryJson(subject));
  provenance.subject_sha256 = subjectSha256;
  provenance.artifact_sha256 = subjectSha256;
}

function failureText(result: ReturnType<typeof checkRunnerImageLock>): string {
  return formatRunnerImageLockFailures(result.failures);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkRunnerImageLock', () => {
  it('accepts the canonical lock when it matches a valid runner release manifest', () => {
    const result = checkRunnerImageLock({
      lockPath: CANONICAL_LOCK,
      manifestPath: MANIFEST_FIXTURE,
      requireManifest: true,
    });

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('rejects adoption when the lock image digest differs from the manifest image digest', () => {
    const root = tempRoot();
    const digest = `sha256:${'0'.repeat(64)}`;
    const lockPath = writeLock(root, (source) =>
      source.replace(
        /@sha256:[0-9a-f]{64}/u,
        `@${digest}`,
      ).replace(/image_digest=sha256:[0-9a-f]{64}/u, `image_digest=${digest}`),
    );
    const manifestPath = writeManifest(root);

    const result = checkRunnerImageLock({ lockPath, manifestPath, requireManifest: true });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('adoption.image.digest');
    expect(failureText(result)).toContain('lock image digest must match runner release manifest image digest');
  });

  it('rejects adoption when the lock protocol differs from the current runner protocol', () => {
    const root = tempRoot();
    const lockPath = writeLock(root, (source) => source.replace('runner_protocol_version=1.0', 'runner_protocol_version=0.9'));
    const manifestPath = writeManifest(root);

    const result = checkRunnerImageLock({ lockPath, manifestPath, requireManifest: true });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('runner_protocol_version');
    expect(failureText(result)).toContain('runner_protocol_version must exactly equal "1.0"');
  });

  it('rejects malformed runner contract versions before adoption comparison', () => {
    const root = tempRoot();
    const lockPath = writeLock(root, (source) => source.replace('runner_contract_version=0.1.0', 'runner_contract_version=whatever'));
    const manifestPath = writeManifest(root);

    const result = checkRunnerImageLock({ lockPath, manifestPath, requireManifest: true });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('runner_contract_version must be a semver string');
  });

  it('rejects legacy agent-task-runner image ids in lock text', () => {
    const root = tempRoot();
    const lockPath = writeLock(root, (source) =>
      source.replace('image_id=agentsmith-runner', 'image_id=agent-task-runner'),
    );
    const manifestPath = writeManifest(root);

    const result = checkRunnerImageLock({ lockPath, manifestPath, requireManifest: true });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('image.id must be "agentsmith-runner"');
  });

  it.each([
    'github.com/agentsmith-project/agentsmith',
    'github.com/agentsmith-project/agentsmith-codex-runner',
  ])('rejects non-canonical runner release producer repo %s', (producerRepo) => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeManifest(root, (manifest) => {
      const provenance = manifest.artifact_provenance as Record<string, unknown>;
      provenance.producer_repo = producerRepo;
      provenance.normalized_remote = producerRepo;
    });

    const result = checkRunnerImageLock({ lockPath, manifestPath, requireManifest: true });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('canonical repo identity must be github.com/agentsmith-project/agentsmith-runner');
  });

  it('rejects codex-runner as the lock manifest producer repo', () => {
    const root = tempRoot();
    const lockPath = writeLock(root, (source) =>
      source.replace(
        'manifest_producer_repo=github.com/agentsmith-project/agentsmith-runner',
        'manifest_producer_repo=github.com/agentsmith-project/agentsmith-codex-runner',
      ),
    );
    const manifestPath = writeManifest(root);

    const result = checkRunnerImageLock({ lockPath, manifestPath, requireManifest: true });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('lock.manifest.producer_repo');
    expect(failureText(result)).toContain('canonical repo identity must be github.com/agentsmith-project/agentsmith-runner');
  });

  it('fails fast for adoption CLI usage without an explicit runner release manifest', () => {
    const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsxCli, [
      'scripts/contracts/check-runner-image-lock.ts',
      '--adoption',
      '--lock',
      CANONICAL_LOCK,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_RELEASE_MANIFEST: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required --manifest <path> or RUNNER_RELEASE_MANIFEST=<path>');
  });

  it.each([
    ['--manifest=', 'cli.manifest'],
    ['--lock=', 'cli.lock'],
  ])('fails fast for empty %s CLI values', (argument, failureField) => {
    const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsxCli, [
      'scripts/contracts/check-runner-image-lock.ts',
      argument,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${failureField}: missing value`);
  });

  it('ignores RUNNER_RELEASE_MANIFEST during default CLI checks but consumes it for explicit adoption', () => {
    const root = tempRoot();
    const digest = `sha256:${'0'.repeat(64)}`;
    const manifestPath = writeManifest(root, (manifest) => {
      const image = manifest.image as Record<string, unknown>;
      image.image = `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-8b2541d@${digest}`;
      image.digest = digest;
      rehashManifestSubject(manifest);
    });
    const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const env = {
      ...process.env,
      RUNNER_RELEASE_MANIFEST: manifestPath,
    };

    const defaultResult = spawnSync(tsxCli, ['scripts/contracts/check-runner-image-lock.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    });
    const adoptionResult = spawnSync(tsxCli, ['scripts/contracts/check-runner-image-lock.ts', '--adoption'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    });

    expect(defaultResult.status).toBe(0);
    expect(defaultResult.stdout).toContain('[contracts] runner image lock check passed');
    expect(adoptionResult.status).toBe(1);
    expect(adoptionResult.stderr).toContain('adoption.image.digest');
    expect(adoptionResult.stderr).toContain('lock image digest must match runner release manifest image digest');
  });
});
