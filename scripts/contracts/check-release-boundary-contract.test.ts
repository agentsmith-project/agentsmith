import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';

import { checkReleaseBoundaryContract } from './check-release-boundary-contract';
import {
  canonicalReleaseBoundaryJson,
  CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
  CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES,
  sha256Digest,
  type CurrentDeploymentTargetProfile,
} from '../governance/current-release-boundary-schema';

const fixtureRoots: string[] = [];
const RELEASE_BOUNDARY_FIXTURE_ROOT = path.join(
  process.cwd(),
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
);
const RUNNER_IMAGE_LOCK_RELATIVE_PATH = path.join('release', 'agentsmith-runner-image.lock');
const RUNNER_IMAGE_LOCK_SOURCE_PATH = path.join(process.cwd(), RUNNER_IMAGE_LOCK_RELATIVE_PATH);
const CONTRACT_BUILD_COMMAND = 'npm run build -w @mbos/agent-runner-contract';
const CHECK_SCRIPT = `${CONTRACT_BUILD_COMMAND} && tsx scripts/contracts/check-release-boundary-contract.ts`;
const CHECK_NPM_SCRIPT = 'contracts:check-release-boundary';
const RUNNER_IMAGE_LOCK_SCRIPT = 'contracts:check-runner-image-lock';
const RUNNER_IMAGE_LOCK_COMMAND = `${CONTRACT_BUILD_COMMAND} && tsx scripts/contracts/check-runner-image-lock.ts`;
const RUNNER_ADAPTER_INVENTORY_FIXTURE = 'runner-adapter-inventory.valid.json';

function targetProfileKey(
  profile: Pick<CurrentDeploymentTargetProfile, 'target_cluster' | 'substrate_source' | 'distribution'>,
): string {
  return `${profile.target_cluster}|${profile.substrate_source}|${profile.distribution}`;
}

function writePackageJson(root: string): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
      [RUNNER_IMAGE_LOCK_SCRIPT]: RUNNER_IMAGE_LOCK_COMMAND,
      'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
    },
  }, null, 2), 'utf8');
}

function ensureRunnerAdapterInventoryCurrentPaths(root: string): void {
  const fixturePath = path.join(
    root,
    'scripts',
    'governance',
    '__fixtures__',
    'release-boundary',
    RUNNER_ADAPTER_INVENTORY_FIXTURE,
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    items?: Array<{ current_paths?: unknown }>;
  };
  for (const item of fixture.items ?? []) {
    if (!Array.isArray(item.current_paths)) {
      continue;
    }
    for (const relativePath of item.current_paths) {
      if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
        continue;
      }
      const targetPath = path.join(root, relativePath);
      if (existsSync(targetPath)) {
        continue;
      }
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, '', 'utf8');
    }
  }
}

function getRecordProperty(
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> {
  const propertyValue = value[property];
  if (!propertyValue || typeof propertyValue !== 'object' || Array.isArray(propertyValue)) {
    throw new Error(`${property} must be an object in copied release boundary fixture`);
  }
  return propertyValue as Record<string, unknown>;
}

function refreshArtifactProvenanceDigests(fixture: Record<string, unknown>): void {
  const subject = structuredClone(fixture);
  delete subject.artifact_provenance;

  const digest = sha256Digest(canonicalReleaseBoundaryJson(subject));
  const artifactProvenance = getRecordProperty(fixture, 'artifact_provenance');
  artifactProvenance.subject_sha256 = digest;
  artifactProvenance.artifact_sha256 = digest;
}

function refreshReleaseContractProvenanceDigests(fixture: Record<string, unknown>): void {
  const subject = structuredClone(fixture);
  delete subject.artifact_provenance;

  const subjectDigest = sha256Digest(canonicalReleaseBoundaryJson(subject));
  const artifactProvenance = getRecordProperty(fixture, 'artifact_provenance');
  artifactProvenance.subject_sha256 = subjectDigest;

  const projection = structuredClone(fixture);
  const projectionProvenance = getRecordProperty(projection, 'artifact_provenance');
  delete projectionProvenance.artifact_sha256;
  artifactProvenance.artifact_sha256 = sha256Digest(canonicalReleaseBoundaryJson(projection));
}

function writeFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'release-boundary-contract-'));
  fixtureRoots.push(root);

  const targetFixtureRoot = path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary');
  mkdirSync(path.dirname(targetFixtureRoot), { recursive: true });
  cpSync(RELEASE_BOUNDARY_FIXTURE_ROOT, targetFixtureRoot, { recursive: true });
  cpSync(
    path.join(process.cwd(), 'scripts', 'governance', 'release-contract-target-profiles.json'),
    path.join(root, 'scripts', 'governance', 'release-contract-target-profiles.json'),
  );
  const targetRunnerImageLockPath = path.join(root, RUNNER_IMAGE_LOCK_RELATIVE_PATH);
  mkdirSync(path.dirname(targetRunnerImageLockPath), { recursive: true });
  cpSync(RUNNER_IMAGE_LOCK_SOURCE_PATH, targetRunnerImageLockPath);
  writePackageJson(root);
  ensureRunnerAdapterInventoryCurrentPaths(root);

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

  it('accepts handoff target profile JSON as the formal online/airgap substrate matrix', () => {
    const root = writeFixtureRoot();
    const handoffFixture = JSON.parse(
      readFileSync(path.join(root, 'scripts', 'governance', 'release-contract-target-profiles.json'), 'utf8'),
    ) as readonly CurrentDeploymentTargetProfile[];
    const handoffKeys = handoffFixture.map(targetProfileKey);
    const canonicalCandidateKeys = CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES.map(targetProfileKey);

    expect(checkReleaseBoundaryContract({ rootDir: root }).ok).toBe(true);
    expect(handoffFixture).toEqual(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES);
    expect(handoffKeys).toEqual([
      'existing_kubernetes|external_declared|online',
      'existing_kubernetes|kit_installed|online',
      'existing_kubernetes|external_declared|airgap',
      'existing_kubernetes|kit_installed|airgap',
    ]);
    expect(handoffKeys.every((key) => canonicalCandidateKeys.includes(key))).toBe(true);
    expect(handoffKeys).not.toContain('kind_rehearsal|kit_installed|online');
    expect(handoffKeys).not.toEqual(canonicalCandidateKeys);
  });

  it('reports release contracts missing the kit_installed handoff path', () => {
    const root = writeFixtureRoot();
    const fixturePath = path.join(
      root,
      'scripts',
      'governance',
      '__fixtures__',
      'release-boundary',
      'release-contract.valid.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
    fixture.target_profiles = (fixture.target_profiles as Record<string, unknown>[])
      .filter((profile) => profile.substrate_source !== 'kit_installed');
    refreshReleaseContractProvenanceDigests(fixture);
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json',
          message: expect.stringContaining('existing_kubernetes|kit_installed|online'),
        }),
      ]),
    );
  });

  it('reports handoff target profile JSON missing the online/airgap substrate matrix', () => {
    const root = writeFixtureRoot();
    const fixturePath = path.join(root, 'scripts', 'governance', 'release-contract-target-profiles.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>[];
    writeFileSync(
      fixturePath,
      JSON.stringify(fixture.filter((profile) => profile.substrate_source !== 'kit_installed'), null, 2),
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/release-contract-target-profiles.json',
          message: expect.stringContaining('existing_kubernetes|kit_installed|online'),
        }),
      ]),
    );
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
          id: 'agentsmith-runner',
          image: `ghcr.io/agentsmith-project/agentsmith-runner:runner-2026.05.23-p0@sha256:${'f'.repeat(64)}`,
          digest: `sha256:${'f'.repeat(64)}`,
        },
        contract_artifact: {
          package_uri:
            'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/20001/mbos-agent-runner-contract-0.1.0.tgz',
          package_sha256: `sha256:${'c'.repeat(64)}`,
          package_integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
          descriptor_subject_sha256: `sha256:${'d'.repeat(64)}`,
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
          artifact_uri:
            'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/20001/runner-release-manifest.json',
          artifact_sha256: `sha256:${'d'.repeat(64)}`,
          generated_at: '2026-05-23T12:10:00.000Z',
          generator_command: 'npm run release:manifest',
          generator_version: 'p0',
          attestation: 'none',
        },
        adoption_policy: {
          fail_fast: true,
          lock_update_required: true,
          release_contract_adoption_required: true,
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

  it('reports missing runner image lock artifact from copied files', () => {
    const root = writeFixtureRoot();
    rmSync(
      path.join(root, RUNNER_IMAGE_LOCK_RELATIVE_PATH),
      { force: true },
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: RUNNER_IMAGE_LOCK_RELATIVE_PATH,
          message: expect.stringContaining('must exist'),
        }),
      ]),
    );
  });

  it('reports malformed runner image lock artifact from copied files', () => {
    const root = writeFixtureRoot();
    writeFileSync(
      path.join(root, RUNNER_IMAGE_LOCK_RELATIVE_PATH),
      [
        'schema_version=agentsmith.runner-image-lock/v1',
        'runner=agentsmith-runner',
        'release_id=runner-release-p5-3a.1',
        'git_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'runner_contract_version=whatever',
        'runner_protocol_version=1.0',
        'image_id=agentsmith-runner',
        `image=ghcr.io/agentsmith-project/agentsmith-runner:p5-3a@sha256:${'b'.repeat(64)}`,
        `image_digest=sha256:${'b'.repeat(64)}`,
        'manifest_producer_repo=github.com/agentsmith-project/agentsmith-runner',
        'manifest_subject_sha256=sha256:ad1e72a1515a6b296dd0ed3c8029ccc7f5b9df19b7e08c8d609b8e60b1613836',
        'manifest_artifact_sha256=sha256:ad1e72a1515a6b296dd0ed3c8029ccc7f5b9df19b7e08c8d609b8e60b1613836',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: RUNNER_IMAGE_LOCK_RELATIVE_PATH,
          message: expect.stringContaining('runner_contract_version must be a semver string'),
        }),
      ]),
    );
  });

  it('reports release contract managed runner digest drift from the canonical lock artifact', () => {
    const root = writeFixtureRoot();
    const lockPath = path.join(root, RUNNER_IMAGE_LOCK_RELATIVE_PATH);
    const driftDigest = `sha256:${'b'.repeat(64)}`;
    writeFileSync(
      lockPath,
      readFileSync(lockPath, 'utf8')
        .replace(/@sha256:[0-9a-f]{64}/u, `@${driftDigest}`)
        .replace(/image_digest=sha256:[0-9a-f]{64}/u, `image_digest=${driftDigest}`),
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json',
          message: expect.stringContaining('managed_runner_image must match agentsmith-runner-image.lock image'),
        }),
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json',
          message: expect.stringContaining('managed_runner inventory image must match agentsmith-runner-image.lock image'),
        }),
      ]),
    );
  });

  it('reports runner release manifest digest drift from the canonical lock artifact', () => {
    const root = writeFixtureRoot();
    const manifestPath = path.join(
      root,
      'scripts',
      'governance',
      '__fixtures__',
      'release-boundary',
      'runner-release-manifest.valid.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const image = getRecordProperty(manifest, 'image');
    const driftDigest = `sha256:${'c'.repeat(64)}`;
    image.image = `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-8b2541d@${driftDigest}`;
    image.digest = driftDigest;
    refreshArtifactProvenanceDigests(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: RUNNER_IMAGE_LOCK_RELATIVE_PATH,
          message: expect.stringContaining('lock image ref must match runner release manifest image ref'),
        }),
        expect.objectContaining({
          path: RUNNER_IMAGE_LOCK_RELATIVE_PATH,
          message: expect.stringContaining('lock image digest must match runner release manifest image digest'),
        }),
        expect.objectContaining({
          path: RUNNER_IMAGE_LOCK_RELATIVE_PATH,
          message: expect.stringContaining('lock manifest subject_sha256 must match runner release manifest subject_sha256'),
        }),
      ]),
    );
  });

  it('reports missing runner adapter inventory fixture from copied fixtures', () => {
    const root = writeFixtureRoot();
    rmSync(
      path.join(
        root,
        'scripts',
        'governance',
        '__fixtures__',
        'release-boundary',
        RUNNER_ADAPTER_INVENTORY_FIXTURE,
      ),
      { force: true },
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `scripts/governance/__fixtures__/release-boundary/${RUNNER_ADAPTER_INVENTORY_FIXTURE}`,
          message: expect.stringContaining('must exist'),
        }),
      ]),
    );
  });

  it('reports runner adapter inventory fail-fast violations from copied fixtures', () => {
    const root = writeFixtureRoot();
    const fixturePath = path.join(
      root,
      'scripts',
      'governance',
      '__fixtures__',
      'release-boundary',
      RUNNER_ADAPTER_INVENTORY_FIXTURE,
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      items: Array<Record<string, unknown>>;
    };
    fixture.items[0] = {
      ...fixture.items[0],
      release_proof_allowed: true,
      target_repo: 'agentsmith-codex-runner',
    };
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `scripts/governance/__fixtures__/release-boundary/${RUNNER_ADAPTER_INVENTORY_FIXTURE}`,
          message: expect.stringContaining('release_proof_allowed must be false'),
        }),
        expect.objectContaining({
          path: `scripts/governance/__fixtures__/release-boundary/${RUNNER_ADAPTER_INVENTORY_FIXTURE}`,
          message: expect.stringContaining('agentsmith-codex-runner is not a canonical runner repo'),
        }),
      ]),
    );
  });
});
