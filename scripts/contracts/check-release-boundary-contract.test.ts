import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';

import { checkReleaseBoundaryContract } from './check-release-boundary-contract';

const fixtureRoots: string[] = [];
const RELEASE_BOUNDARY_FIXTURE_ROOT = path.join(
  process.cwd(),
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
);
const CHECK_SCRIPT = 'tsx scripts/contracts/check-release-boundary-contract.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-release-boundary';
const RUNNER_IMAGE_LOCK_SCRIPT = 'contracts:check-runner-image-lock';
const RUNNER_IMAGE_LOCK_COMMAND = 'tsx scripts/contracts/check-runner-image-lock.ts';

function writePackageJson(root: string): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
      [RUNNER_IMAGE_LOCK_SCRIPT]: RUNNER_IMAGE_LOCK_COMMAND,
      'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
    },
  }, null, 2), 'utf8');
}

function writeFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'release-boundary-contract-'));
  fixtureRoots.push(root);

  const targetFixtureRoot = path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary');
  mkdirSync(path.dirname(targetFixtureRoot), { recursive: true });
  cpSync(RELEASE_BOUNDARY_FIXTURE_ROOT, targetFixtureRoot, { recursive: true });
  writePackageJson(root);

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('check-release-boundary-contract', () => {
  it('validates the current P0 release boundary machine truth', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-release-boundary-contract.ts'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('reports malformed JSON fixtures as structured contract failures', () => {
    const root = writeFixtureRoot();
    writeFileSync(
      path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary', 'release-kit-evidence.valid.json'),
      '{ "schema_version": "agentsmith.release-kit-evidence/v1",',
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/release-kit-evidence.valid.json',
          message: expect.stringContaining('Invalid JSON fixture'),
        }),
      ]),
    );
  });

  it('reports contradictory release-kit status and failure_class from copied fixtures', () => {
    const root = writeFixtureRoot();
    const fixturePath = path.join(
      root,
      'scripts',
      'governance',
      '__fixtures__',
      'release-boundary',
      'release-kit-evidence.valid.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
    fixture.status = 'passed';
    fixture.failure_class = 'contract_drift';
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/release-kit-evidence.valid.json',
          message: expect.stringContaining('passed release kit evidence must use failure_class none'),
        }),
      ]),
    );
  });

  it('reports deploy template package fixture validation failures from copied fixtures', () => {
    const root = writeFixtureRoot();
    const fixturePath = path.join(
      root,
      'scripts',
      'governance',
      '__fixtures__',
      'release-boundary',
      'deploy-template-package.valid.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
    delete fixture.artifact_provenance;
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/deploy-template-package.valid.json',
          message: expect.stringContaining('artifact_provenance is required'),
        }),
      ]),
    );
  });

  it('reports runner release manifest protocol drift from copied fixtures', () => {
    const root = writeFixtureRoot();
    writeFileSync(
      path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary', 'runner-release-manifest.valid.json'),
      JSON.stringify({
        schema_version: 'agentsmith.runner-release-manifest/v1',
        runner: 'agentsmith-runner',
        release_id: 'runner-2026.05.23-p0',
        git_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        runner_contract_version: 'whatever',
        supported_protocol_versions: ['1'],
        image: {
          id: 'agent-task-runner',
          image: `ghcr.io/agentsmith-project/agentsmith-runner:runner-2026.05.23-p0@sha256:${'f'.repeat(64)}`,
          digest: `sha256:${'f'.repeat(64)}`,
        },
        artifact_provenance: {
          schema_version: 'agentsmith.artifact-provenance/v1',
          provenance_kind: 'ci_artifact',
          producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
          normalized_remote: 'github.com/agentsmith-project/agentsmith-runner',
          commit_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
          subject_name: 'runner-release-manifest',
          subject_sha256: `sha256:${'0'.repeat(64)}`,
          subject_uri: 'runner-release-manifest.json',
          workflow_name: 'runner-release',
          run_id: '20001',
          run_attempt: '1',
          job: 'generate-runner-manifest',
          artifact_uri: 'gh-artifact://agentsmith-runner/release/20001/runner-release-manifest.json',
          artifact_sha256: `sha256:${'d'.repeat(64)}`,
          generated_at: '2026-05-23T12:10:00.000Z',
          generator_command: 'npm run release:manifest',
          generator_version: 'p0',
          attestation: 'none',
        },
      }, null, 2),
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json',
          message: expect.stringContaining('supported_protocol_versions must exactly equal ["1.0"]'),
        }),
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json',
          message: expect.stringContaining('runner_contract_version must be a semver string'),
        }),
      ]),
    );
  });

  it('reports missing runner image lock fixture from copied fixtures', () => {
    const root = writeFixtureRoot();
    rmSync(
      path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary', 'agent-task-runner-image.lock'),
      { force: true },
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/agent-task-runner-image.lock',
          message: expect.stringContaining('must exist'),
        }),
      ]),
    );
  });

  it('reports malformed runner image lock fixture from copied fixtures', () => {
    const root = writeFixtureRoot();
    writeFileSync(
      path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary', 'agent-task-runner-image.lock'),
      [
        'schema_version=agentsmith.runner-image-lock/v1',
        'runner=agentsmith-runner',
        'release_id=runner-2026.05.23-p0',
        'git_sha=abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        'runner_contract_version=whatever',
        'runner_protocol_version=1.0',
        'image_id=agent-task-runner',
        `image=ghcr.io/agentsmith-project/agentsmith-runner:runner-2026.05.23-p0@sha256:${'f'.repeat(64)}`,
        `image_digest=sha256:${'f'.repeat(64)}`,
        'manifest_producer_repo=github.com/agentsmith-project/agentsmith-runner',
        `manifest_subject_sha256=sha256:${'b'.repeat(64)}`,
        `manifest_artifact_sha256=sha256:${'d'.repeat(64)}`,
        '',
      ].join('\n'),
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/agent-task-runner-image.lock',
          message: expect.stringContaining('runner_contract_version must be a semver string'),
        }),
      ]),
    );
  });
});
