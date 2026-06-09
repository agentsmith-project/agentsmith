import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_DEPLOYMENT_MODE_MATRIX,
  CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
  CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES,
  CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
  CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
  CURRENT_RELEASE_KIT_EVIDENCE_SUBJECT_SCHEMA_VERSION,
  CURRENT_RUNNER_ADAPTER_INVENTORY_SCHEMA_VERSION,
  CURRENT_RUNNER_CONTRACT_ARTIFACT_SCHEMA_VERSION,
  CURRENT_REQUIRED_PRODUCT_FLOWS,
  AGENTSMITH_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  diagnoseReleaseKitEvidenceForAggregate,
  normalizeReleaseBoundaryRemote,
  sha256Digest,
  validateAgentSmithReleaseContract,
  validateDeployTemplatePackage,
  validateReleaseKitEvidence,
  validateReleaseKitEvidenceForAggregate,
  validateReleaseKitEvidenceMapping,
  parseRunnerImageLockText,
  validateRunnerAdapterInventory,
  validateRunnerContractArtifactDescriptor,
  validateRunnerImageLock,
  validateRunnerReleaseManifest,
  validateSubstrateConnectionTruth,
  validateTruthMatrix,
  type CurrentDeploymentTargetProfile,
} from '../current-release-boundary-schema';
import {
  POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME,
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
} from '../../post-deploy-product-smoke/report';

const FIXTURE_ROOT = resolve(process.cwd(), 'scripts/governance/__fixtures__/release-boundary');
const RUNNER_IMAGE_LOCK_PATH = resolve(process.cwd(), 'release/agentsmith-runner-image.lock');

type ValidationResult = {
  ok: boolean;
  failures?: readonly {
    path: string;
    reason: string;
  }[];
};

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as Record<string, unknown>;
}

function readRunnerImageLockText(): string {
  return readFileSync(RUNNER_IMAGE_LOCK_PATH, 'utf8');
}

function expectInvalid(result: ValidationResult, expectedReason: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures?.map((failure) => `${failure.path}: ${failure.reason}`).join('\n'))
      .toContain(expectedReason);
  }
}

function cloneFixture(name: string): Record<string, unknown> {
  return structuredClone(readFixture(name));
}

function targetProfileKey(
  profile: Pick<CurrentDeploymentTargetProfile, 'target_cluster' | 'substrate_source' | 'distribution'>,
): string {
  return `${profile.target_cluster}|${profile.substrate_source}|${profile.distribution}`;
}

function artifactProvenanceOf(record: Record<string, unknown>): Record<string, unknown> {
  const provenance = record.artifact_provenance;
  if (provenance === null || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('Fixture artifact_provenance must be a record.');
  }

  return provenance as Record<string, unknown>;
}

function rehashArtifactProvenanceSubject(record: Record<string, unknown>, subjectKey: string): void {
  artifactProvenanceOf(record).subject_sha256 = sha256Digest(canonicalReleaseBoundaryJson(record[subjectKey]));
}

function rehashArtifactProvenanceContainer(record: Record<string, unknown>): void {
  const subject = structuredClone(record);
  delete subject.artifact_provenance;
  artifactProvenanceOf(record).subject_sha256 = sha256Digest(canonicalReleaseBoundaryJson(subject));
}

function setRunnerContractArtifactUri(record: Record<string, unknown>, uri: string): void {
  const artifact = record.artifact;
  if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('Fixture artifact must be a record.');
  }

  (artifact as Record<string, unknown>).uri = uri;
  artifactProvenanceOf(record).artifact_uri = uri;
  rehashArtifactProvenanceContainer(record);
}

function rehashReleaseContractProjection(record: Record<string, unknown>): void {
  const projection = structuredClone(record);
  const projectionProvenance = artifactProvenanceOf(projection);
  delete projectionProvenance.artifact_sha256;
  artifactProvenanceOf(record).artifact_sha256 = sha256Digest(canonicalReleaseBoundaryJson(projection));
}

function rehashReleaseContract(record: Record<string, unknown>): void {
  rehashArtifactProvenanceContainer(record);
  rehashReleaseContractProjection(record);
}

const GITHUB_API_SOURCE_ROOT_ENDPOINTS = [
  'https://api.github.com/repos/agentsmith-project/agentsmith/cont%65nts?ref=main',
  'https://api.github.com/repos/agentsmith-project/agentsmith/contents?ref=main',
  'https://api.github.com/repos/agentsmith-project/agentsmith/tarball',
  'https://api.github.com/repos/agentsmith-project/agentsmith/zipball',
  'https://api.github.com/repos/agentsmith-project/agentsmith/commits',
  'https://api.github.com/repos/agentsmith-project/agentsmith/branches',
  'https://api.github.com/repos/agentsmith-project/agentsmith/tags',
];
const GITHUB_SOURCE_IDENTITY_ENDPOINTS = [
  'https://github.com/agentsmith-project/agentsmith/commit/0123456789abcdef0123456789abcdef01234567',
  'https://github.com/agentsmith-project/agentsmith-release-kit/commit/0123456789abcdef0123456789abcdef01234567',
  'https://github.com/agentsmith-project/agentsmith-runner/commit/0123456789abcdef0123456789abcdef01234567',
  'https://api.github.com/repos/agentsmith-project/agentsmith/commits/0123456789abcdef0123456789abcdef01234567',
  'https://api.github.com/repos/agentsmith-project/agentsmith/branches/main',
  'https://api.github.com/repos/agentsmith-project/agentsmith/tags/v2026.05.23',
];
const VALID_REMOTE_ATTESTATION = {
  attestation_uri: 'gh-artifact://agentsmith/deploy-template-package/10001/attestation.intoto.jsonl',
  attestation_sha256: `sha256:${'9'.repeat(64)}`,
} as const;
const NON_PLAIN_RELEASE_KIT_VERSIONS = [
  'v0.1.0',
  '0.1',
  '01.2.3',
  '0.1.0-alpha.1',
] as const;

function validRunnerContractArtifactDescriptor(): Record<string, unknown> {
  const descriptor: Record<string, unknown> = {
    schema_version: CURRENT_RUNNER_CONTRACT_ARTIFACT_SCHEMA_VERSION,
    package: {
      name: '@mbos/agent-runner-contract',
      version: '0.1.0',
    },
    artifact: {
      filename: 'mbos-agent-runner-contract-0.1.0.tgz',
      uri: 'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
      sha256: `sha256:${'a'.repeat(64)}`,
      integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
    },
    entrypoints: {
      version: './dist/artifact.js',
      schema: './dist/contract-schema.js',
      types: './dist/index.d.ts',
      fixtures: './dist/contract-schema.js',
    },
    artifact_provenance: {
      schema_version: 'agentsmith.artifact-provenance/v1',
      provenance_kind: 'ci_artifact',
      producer_repo: AGENTSMITH_CANONICAL_REPO,
      normalized_remote: AGENTSMITH_CANONICAL_REPO,
      commit_sha: '1'.repeat(40),
      subject_name: 'runner-contract-artifact',
      subject_sha256: `sha256:${'0'.repeat(64)}`,
      subject_uri: 'runner-contract-artifact.json',
      workflow_name: 'Runner Contract Artifact',
      run_id: '123',
      run_attempt: '1',
      job: 'produce-runner-contract-artifact',
      artifact_uri:
        'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
      artifact_sha256: `sha256:${'a'.repeat(64)}`,
      generated_at: '2026-05-25T00:00:00.000Z',
      generator_command: 'npx tsx scripts/governance/runner-contract-artifact.ts',
      generator_version: 'p4-runner-contract-artifact',
      attestation: 'none',
    },
  };
  rehashArtifactProvenanceContainer(descriptor);
  return descriptor;
}

describe('current release boundary schema', () => {
  it('validates P0 handoff fixtures for release contract, substrate truth, release kit evidence, runner manifest, and runner image lock', () => {
    expect(validateDeployTemplatePackage(readFixture('deploy-template-package.valid.json')).ok).toBe(true);
    expect(validateAgentSmithReleaseContract(readFixture('release-contract.valid.json')).ok).toBe(true);
    expect(validateSubstrateConnectionTruth(readFixture('substrate-connection.external-declared.valid.json')).ok)
      .toBe(true);
    expect(readFixture('substrate-connection.kit-installed.valid.json').target_cluster).toBe('existing_kubernetes');
    expect(validateSubstrateConnectionTruth(readFixture('substrate-connection.kit-installed.valid.json')).ok)
      .toBe(true);

    const releaseKitEvidence = readFixture('release-kit-evidence.valid.json');
    expect(releaseKitEvidence.target).toBe('rollout');
    const releaseKitEvidenceSubject = releaseKitEvidence.evidence_subject as Record<string, unknown>;
    const releaseKitEvidenceSubjectFiles = releaseKitEvidenceSubject.files as Record<string, unknown>[];
    expect(releaseKitEvidenceSubjectFiles.map((file) => file.path)).toEqual([
      'evidence.json',
      'online-deployment-gate-report.json',
    ]);
    expect(validateReleaseKitEvidence(releaseKitEvidence).ok).toBe(true);
    expect(validateReleaseKitEvidenceForAggregate(releaseKitEvidence)).toMatchObject({
      ok: true,
      value: {
        schema_version: 'agentsmith.release-kit-evidence.aggregate-canonical/v1',
        target: 'rollout',
        canonical_writer: {
          gate_id: 'release-kit-online-deployment-gate',
          line_kind: 'release_kit_online_deployment_gate',
          npm_script: 'bash scripts/verify-release.sh --online-deployment-gate',
          native_result_path: '<release-kit-evidence-root>/online-deployment-gate-report.json',
          evidence_root: '<release-kit-evidence-root>',
        },
      },
    });
    expect(diagnoseReleaseKitEvidenceForAggregate(releaseKitEvidence)).toMatchObject({
      ok: true,
      canonical_shape: {
        target: 'rollout',
      },
      failures: [],
    });
    expect(validateRunnerReleaseManifest(readFixture('runner-release-manifest.valid.json')).ok).toBe(true);

    const runnerImageLock = parseRunnerImageLockText(readRunnerImageLockText());
    expect(runnerImageLock.ok).toBe(true);
    if (runnerImageLock.ok) {
      expect(validateRunnerImageLock(runnerImageLock.value).ok).toBe(true);
      expect(runnerImageLock.value.handoff).toEqual({
        report_artifact_uri:
          'gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/27233217906/runner-ga-handoff-report.json',
        manifest_input_sha256: 'sha256:460ea641f407ad7e88abcab887f4dbf0f6e3dc26e90a86eff5ce18c2117254b0',
        report_sha256: 'sha256:2fb3f79e4fdf8666326a3a74fc9f92cb608ae3426887449953ddb0f19c692b1b',
      });
    }

    const runnerAdapterInventory = readFixture('runner-adapter-inventory.valid.json');
    expect(runnerAdapterInventory.schema_version).toBe(CURRENT_RUNNER_ADAPTER_INVENTORY_SCHEMA_VERSION);
    expect(validateRunnerAdapterInventory(runnerAdapterInventory, {
      rootDir: process.cwd(),
    }).ok).toBe(true);
  });

  it('rejects runner adapter inventory missing a required item', () => {
    const inventory = cloneFixture('runner-adapter-inventory.valid.json');
    inventory.items = (inventory.items as Record<string, unknown>[])
      .filter((entry) => entry.id !== 'skills_diagnostics');

    expectInvalid(
      validateRunnerAdapterInventory(inventory, { rootDir: process.cwd() }),
      'runner adapter inventory is missing "skills_diagnostics"',
    );
  });

  it('rejects runner adapter inventory current paths that do not exist', () => {
    const inventory = cloneFixture('runner-adapter-inventory.valid.json');
    const items = inventory.items as Record<string, unknown>[];
    items[0] = {
      ...items[0],
      current_paths: ['scripts/does-not-exist/runner-adapter.ts'],
    };

    expectInvalid(
      validateRunnerAdapterInventory(inventory, { rootDir: process.cwd() }),
      'current_paths[0] must exist: scripts/does-not-exist/runner-adapter.ts',
    );
  });

  it('rejects runner adapter inventory entries marked as release proof', () => {
    const inventory = cloneFixture('runner-adapter-inventory.valid.json');
    const items = inventory.items as Record<string, unknown>[];
    items[0] = {
      ...items[0],
      release_proof_allowed: true,
    };

    expectInvalid(
      validateRunnerAdapterInventory(inventory, { rootDir: process.cwd() }),
      'release_proof_allowed must be false.',
    );
  });

  it('rejects non-canonical runner adapter target repos', () => {
    const inventory = cloneFixture('runner-adapter-inventory.valid.json');
    const items = inventory.items as Record<string, unknown>[];
    items[0] = {
      ...items[0],
      target_repo: 'agentsmith-codex-runner',
    };

    expectInvalid(
      validateRunnerAdapterInventory(inventory, { rootDir: process.cwd() }),
      'agentsmith-codex-runner is not a canonical runner repo.',
    );
  });

  it('rejects runner adapter inventory source-read or source-build requirements', () => {
    const inventory = cloneFixture('runner-adapter-inventory.valid.json');
    const items = inventory.items as Record<string, unknown>[];
    items[0] = {
      ...items[0],
      source_boundary: {
        runner_repo_reads_agentsmith_source: true,
        release_kit_builds_runner_from_agentsmith_source: false,
        release_kit_builds_runner_from_runner_source: false,
      },
    };
    items[1] = {
      ...items[1],
      source_boundary: {
        runner_repo_reads_agentsmith_source: false,
        release_kit_builds_runner_from_agentsmith_source: true,
        release_kit_builds_runner_from_runner_source: true,
      },
    };

    const result = validateRunnerAdapterInventory(inventory, { rootDir: process.cwd() });

    expectInvalid(result, 'runner repo must not read AgentSmith source for this adapter.');
    expectInvalid(result, 'release kit must not build runner from AgentSmith source.');
    expectInvalid(result, 'release kit must not build runner from runner source.');
  });

  it('rejects runner adapter inventory checks that imply digest adoption proof', () => {
    const inventory = cloneFixture('runner-adapter-inventory.valid.json');
    const items = inventory.items as Record<string, unknown>[];
    const releaseContractRunnerDigest = items.find((entry) => entry.id === 'release_contract_runner_digest');
    if (!releaseContractRunnerDigest) {
      throw new Error('release_contract_runner_digest fixture item is required');
    }
    releaseContractRunnerDigest.fail_fast_checks = [
      'current_paths_exist',
      'runner_manifest_lock_contract_digest_match',
    ];

    expectInvalid(
      validateRunnerAdapterInventory(inventory, { rootDir: process.cwd() }),
      'runner adapter inventory must not claim runner manifest/lock/release contract digest match proof; use the runner image lock adoption gate.',
    );
  });

  it('freezes the deployment mode matrix without making any target required', () => {
    expect(CURRENT_DEPLOYMENT_MODE_MATRIX.map((entry) => [
      entry.target_cluster,
      entry.substrate_source,
      entry.distribution,
      entry.support_level,
    ])).toEqual([
      ['existing_kubernetes', 'external_declared', 'online', 'primary'],
      ['existing_kubernetes', 'external_declared', 'airgap', 'primary'],
      ['existing_kubernetes', 'kit_installed', 'online', 'advanced'],
      ['existing_kubernetes', 'kit_installed', 'airgap', 'advanced'],
      ['kind_rehearsal', 'kit_installed', 'online', 'rehearsal'],
    ]);
    expect(CURRENT_DEPLOYMENT_MODE_MATRIX.filter((entry) => entry.required_target)).toEqual([]);
    expect(CURRENT_DEPLOYMENT_MODE_MATRIX.map(targetProfileKey)).toEqual(
      CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES.map(targetProfileKey),
    );
  });

  it('declares deployment target profiles as the formal online/airgap substrate handoff matrix', () => {
    const contract = readFixture('release-contract.valid.json');
    const profiles = contract.target_profiles as CurrentDeploymentTargetProfile[];
    const profileKeys = profiles.map(targetProfileKey);
    const canonicalCandidateKeys = CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES.map(targetProfileKey);

    expect(profiles.every((profile) => profile.required === true)).toBe(true);
    expect(profileKeys).toEqual([
      'existing_kubernetes|external_declared|online',
      'existing_kubernetes|kit_installed|online',
      'existing_kubernetes|external_declared|airgap',
      'existing_kubernetes|kit_installed|airgap',
    ]);
    expect(profileKeys.every((key) => canonicalCandidateKeys.includes(key))).toBe(true);
    expect(profileKeys).not.toContain('kind_rehearsal|kit_installed|online');
    expect(profileKeys).not.toEqual(canonicalCandidateKeys);
    expect(profiles).toEqual(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES);
  });

  it('rejects release contracts that omit the kit_installed handoff path', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const profiles = contract.target_profiles as Record<string, unknown>[];
    contract.target_profiles = profiles.filter((profile) => profile.substrate_source !== 'kit_installed');
    rehashReleaseContract(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'target_profiles must include existing_kubernetes|kit_installed|online for the online/airgap x external_declared/kit_installed handoff matrix',
    );
  });

  it('declares the release boundary truth matrix and release kit evidence mapping against current writers', () => {
    expect(validateTruthMatrix(CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX)).toEqual({
      ok: true,
      value: CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
    });
    expect(validateReleaseKitEvidenceMapping(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING)).toEqual({
      ok: true,
      value: CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
    });
    expect(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.map((entry) => entry.release_kit_output))
      .not.toContain('airgap-bundle-check-report.json+airgap-bundle-manifest.json+image-map.json');

    const productFlowMapping = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.find((entry) => entry.target === 'product_flows');
    expect(productFlowMapping).toMatchObject({
      release_kit_output: POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME,
      canonical_writer: {
        gate_id: 'lane-unified-deploy-product-flows',
        line_kind: 'unified_deploy_product_flows',
        native_result_path: '<campaign-root>/lane-unified-deploy-product-flows/native/result.json',
        evidence_root: '<campaign-root>/post-deploy-product-smoke',
      },
      canonical_evidence_owner: 'agentsmith',
      expected_product_smoke_report_schema: POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
      expected_product_smoke_report_producer: POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
    });

    expect(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING).toEqual(expect.arrayContaining([
      expect.objectContaining({
        release_kit_output: 'online-deployment-gate-report.json',
        target: 'rollout',
        current_campaign_target_profiles: [
          {
            target_cluster: 'existing_kubernetes',
            substrate_source: 'external_declared',
            distribution: 'online',
          },
        ],
      }),
      expect.objectContaining({
        release_kit_output: 'airgap_bundle_check',
        target: 'images',
        current_campaign_target_profiles: [
          {
            target_cluster: 'existing_kubernetes',
            substrate_source: 'external_declared',
            distribution: 'airgap',
          },
          {
            target_cluster: 'existing_kubernetes',
            substrate_source: 'kit_installed',
            distribution: 'airgap',
          },
        ],
      }),
    ]));

    const staleAirgapMapping = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.map((entry) => (
      entry.canonical_writer.gate_id === 'release-kit-airgap-bundle-check'
        ? {
            ...entry,
            release_kit_output: 'airgap-bundle-check-report.json+airgap-bundle-manifest.json+image-map.json',
          }
        : entry
    ));
    expectInvalid(
      validateReleaseKitEvidenceMapping(staleAirgapMapping),
      'stale pre-GA release kit output',
    );
  });

  it('rejects tag-only images, missing image digests, and missing required product flows', () => {
    const tagOnly = cloneFixture('release-contract.valid.json');
    const productImages = tagOnly.product_images as Record<string, unknown>[];
    productImages[0].image = 'ghcr.io/agentsmith-project/agentsmith-app:v1.0.0';
    expectInvalid(validateAgentSmithReleaseContract(tagOnly), 'image must be pinned by digest');

    const missingDigest = cloneFixture('release-contract.valid.json');
    const adoptedProviderImages = missingDigest.adopted_provider_images as Record<string, unknown>[];
    delete adoptedProviderImages[0].digest;
    expectInvalid(validateAgentSmithReleaseContract(missingDigest), 'image digest is required');

    const missingFlow = cloneFixture('release-contract.valid.json');
    missingFlow.required_product_flows = CURRENT_REQUIRED_PRODUCT_FLOWS.filter((flow) => flow !== 'files');
    expectInvalid(validateAgentSmithReleaseContract(missingFlow), 'required product flow "files" is missing');
  });

  it.each(NON_PLAIN_RELEASE_KIT_VERSIONS)(
    'rejects release contracts whose min_release_kit_version is not plain semver: %s',
    (version) => {
      const contract = cloneFixture('release-contract.valid.json');
      contract.min_release_kit_version = version;

      expectInvalid(
        validateAgentSmithReleaseContract(contract),
        'min_release_kit_version must be a plain semver x.y.z string',
      );
    },
  );

  it('validates runner contract release artifact descriptors and fails fast on missing artifact metadata', () => {
    const descriptor = validRunnerContractArtifactDescriptor();
    expect(validateRunnerContractArtifactDescriptor(descriptor).ok).toBe(true);

    const missingUri = validRunnerContractArtifactDescriptor();
    delete (missingUri.artifact as Record<string, unknown>).uri;
    rehashArtifactProvenanceContainer(missingUri);
    expectInvalid(validateRunnerContractArtifactDescriptor(missingUri), 'artifact.uri is required');

    const missingDigest = validRunnerContractArtifactDescriptor();
    delete (missingDigest.artifact as Record<string, unknown>).sha256;
    rehashArtifactProvenanceContainer(missingDigest);
    expectInvalid(validateRunnerContractArtifactDescriptor(missingDigest), 'artifact.sha256 is required');

    const missingIntegrity = validRunnerContractArtifactDescriptor();
    delete (missingIntegrity.artifact as Record<string, unknown>).integrity;
    rehashArtifactProvenanceContainer(missingIntegrity);
    expectInvalid(validateRunnerContractArtifactDescriptor(missingIntegrity), 'artifact.integrity is required');

    const missingProvenance = validRunnerContractArtifactDescriptor();
    delete missingProvenance.artifact_provenance;
    expectInvalid(validateRunnerContractArtifactDescriptor(missingProvenance), 'artifact_provenance is required');
  });

  it('rejects runner contract artifact descriptors with local or zero CI run identity', () => {
    const localRunId = validRunnerContractArtifactDescriptor();
    artifactProvenanceOf(localRunId).run_id = 'local';
    expectInvalid(
      validateRunnerContractArtifactDescriptor(localRunId),
      'artifact_provenance.run_id must be a positive integer string.',
    );

    const zeroRunAttempt = validRunnerContractArtifactDescriptor();
    artifactProvenanceOf(zeroRunAttempt).run_attempt = '0';
    expectInvalid(
      validateRunnerContractArtifactDescriptor(zeroRunAttempt),
      'artifact_provenance.run_attempt must be a positive integer string.',
    );
  });

  it('only accepts the canonical runner contract gh-artifact URI bound to provenance and filename', () => {
    const httpsDescriptor = validRunnerContractArtifactDescriptor();
    setRunnerContractArtifactUri(httpsDescriptor, 'https://example.com/runner-contract-artifact.tgz');
    expectInvalid(
      validateRunnerContractArtifactDescriptor(httpsDescriptor),
      'artifact.uri must be gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/<run_id>/<filename>.',
    );

    const wrongRepo = validRunnerContractArtifactDescriptor();
    setRunnerContractArtifactUri(
      wrongRepo,
      'gh-artifact://agentsmith-project/other/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
    );
    expectInvalid(
      validateRunnerContractArtifactDescriptor(wrongRepo),
      'artifact.uri repo must be agentsmith-project/agentsmith.',
    );

    const wrongArtifactName = validRunnerContractArtifactDescriptor();
    setRunnerContractArtifactUri(
      wrongArtifactName,
      'gh-artifact://agentsmith-project/agentsmith/other-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
    );
    expectInvalid(
      validateRunnerContractArtifactDescriptor(wrongArtifactName),
      'artifact.uri artifact name must be runner-contract-artifact.',
    );

    const wrongRunId = validRunnerContractArtifactDescriptor();
    setRunnerContractArtifactUri(
      wrongRunId,
      'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/999/mbos-agent-runner-contract-0.1.0.tgz',
    );
    expectInvalid(
      validateRunnerContractArtifactDescriptor(wrongRunId),
      'artifact.uri run_id must match artifact_provenance.run_id.',
    );

    const wrongFilename = validRunnerContractArtifactDescriptor();
    setRunnerContractArtifactUri(
      wrongFilename,
      'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/other.tgz',
    );
    expectInvalid(
      validateRunnerContractArtifactDescriptor(wrongFilename),
      'artifact.uri filename must match artifact.filename.',
    );
  });

  it('keeps runner contract artifact provenance owned by canonical AgentSmith repo only', () => {
    const runnerRepoDescriptor = validRunnerContractArtifactDescriptor();
    artifactProvenanceOf(runnerRepoDescriptor).producer_repo = 'github.com/agentsmith-project/agentsmith-runner';
    artifactProvenanceOf(runnerRepoDescriptor).normalized_remote = 'github.com/agentsmith-project/agentsmith-runner';

    expectInvalid(
      validateRunnerContractArtifactDescriptor(runnerRepoDescriptor),
      'canonical repo identity must be github.com/agentsmith-project/agentsmith',
    );

    const forbiddenRunnerDescriptor = validRunnerContractArtifactDescriptor();
    artifactProvenanceOf(forbiddenRunnerDescriptor).producer_repo =
      'github.com/agentsmith-project/agentsmith-codex-runner';
    artifactProvenanceOf(forbiddenRunnerDescriptor).normalized_remote =
      'github.com/agentsmith-project/agentsmith-codex-runner';

    expectInvalid(
      validateRunnerContractArtifactDescriptor(forbiddenRunnerDescriptor),
      'canonical repo identity must be github.com/agentsmith-project/agentsmith',
    );
  });

  it('rejects deploy template package provenance gaps, local provenance, and self-referential subjects', () => {
    const missingProvenance = cloneFixture('deploy-template-package.valid.json');
    delete missingProvenance.artifact_provenance;
    expectInvalid(validateDeployTemplatePackage(missingProvenance), 'artifact_provenance is required');

    const relativePackageUri = cloneFixture('deploy-template-package.valid.json');
    relativePackageUri.package_uri = '../agentsmith/packages/application/deploy-template-package.tgz';
    artifactProvenanceOf(relativePackageUri).artifact_uri = relativePackageUri.package_uri;
    rehashArtifactProvenanceContainer(relativePackageUri);
    expectInvalid(validateDeployTemplatePackage(relativePackageUri), 'package_uri must be a remote/CI artifact URI');

    const sourceSubjectUri = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(sourceSubjectUri).subject_uri = 'file:///home/percy/works/mbos-v1/agentsmith/src/deploy-template-package.json';
    expectInvalid(
      validateDeployTemplatePackage(sourceSubjectUri),
      'artifact_provenance.subject_uri must not point at local AgentSmith product source',
    );

    const localRepo = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(localRepo).normalized_remote = '/home/percy/works/mbos-v1/agentsmith';
    expectInvalid(validateDeployTemplatePackage(localRepo), 'canonical repo identity must be github.com/agentsmith-project/agentsmith');

    const selfReferential = cloneFixture('deploy-template-package.valid.json');
    const selfReferentialProvenance = artifactProvenanceOf(selfReferential);
    selfReferentialProvenance.subject_uri = selfReferentialProvenance.artifact_uri;
    selfReferentialProvenance.subject_sha256 = sha256Digest(canonicalReleaseBoundaryJson(selfReferential));
    expectInvalid(
      validateDeployTemplatePackage(selfReferential),
      'subject_sha256 must hash the subject without artifact_provenance',
    );
  });

  it.each([
    'git+https://github.com/agentsmith-project/agentsmith.git',
    'https://github.com/agentsmith-project/agentsmith/archive/0123456789abcdef0123456789abcdef01234567.tar.gz',
    'https://github.com/agentsmith-project/agentsmith/tree/main/packages/application',
    'https://github.com/agentsmith-project/agentsmith/blob/main/packages/application/deploy-template-package.json',
    'https://github.com/agentsmith-project/agentsmith/raw/main/packages/application/deploy-template-package.json',
    'https://raw.githubusercontent.com/agentsmith-project/agentsmith/main/packages/application/deploy-template-package.json',
  ])('rejects deploy template package source package_uri %s', (packageUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    packageRecord.package_uri = packageUri;
    artifactProvenanceOf(packageRecord).artifact_uri = packageUri;
    rehashArtifactProvenanceContainer(packageRecord);

    expectInvalid(validateDeployTemplatePackage(packageRecord), 'package_uri must be a remote/CI artifact URI');
  });

  it.each([
    'https://api.github.com/repos/agentsmith-project/agentsmith/git/blobs/0123456789abcdef0123456789abcdef01234567',
    'https://api.github.com/repos/agentsmith-project/agentsmith/git/trees/0123456789abcdef0123456789abcdef01234567',
    'https://api.github.com/repos/agentsmith-project/agentsmith/git/refs/heads/main',
  ])('rejects deploy template package GitHub API source package_uri and artifact_uri %s', (packageUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    packageRecord.package_uri = packageUri;
    artifactProvenanceOf(packageRecord).artifact_uri = packageUri;
    rehashArtifactProvenanceContainer(packageRecord);

    const result = validateDeployTemplatePackage(packageRecord);

    expectInvalid(result, 'package_uri must be a remote/CI artifact URI');
    expectInvalid(result, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');
  });

  it.each(GITHUB_SOURCE_IDENTITY_ENDPOINTS)(
    'rejects deploy template package GitHub source identity package_uri and artifact_uri %s',
    (packageUri) => {
      const packageRecord = cloneFixture('deploy-template-package.valid.json');
      packageRecord.package_uri = packageUri;
      artifactProvenanceOf(packageRecord).artifact_uri = packageUri;
      rehashArtifactProvenanceContainer(packageRecord);

      const result = validateDeployTemplatePackage(packageRecord);

      expectInvalid(result, 'package_uri must be a remote/CI artifact URI');
      expectInvalid(result, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');
    },
  );

  it.each([
    'https://api.github.com/repos/agentsmith-project/agentsmith/%67it/blobs/0123456789abcdef0123456789abcdef01234567',
    'https://api.github.com/repos/agentsmith-project/agentsmith/cont%65nts/packages/application/deploy-template-package.json?ref=main',
  ])('rejects deploy template package percent-encoded GitHub API source package_uri and artifact_uri %s', (packageUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    packageRecord.package_uri = packageUri;
    artifactProvenanceOf(packageRecord).artifact_uri = packageUri;
    rehashArtifactProvenanceContainer(packageRecord);

    const result = validateDeployTemplatePackage(packageRecord);

    expectInvalid(result, 'package_uri must be a remote/CI artifact URI');
    expectInvalid(result, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');
  });

  it.each(GITHUB_API_SOURCE_ROOT_ENDPOINTS)(
    'rejects deploy template package exact GitHub API source package_uri and artifact_uri %s',
    (packageUri) => {
      const packageRecord = cloneFixture('deploy-template-package.valid.json');
      packageRecord.package_uri = packageUri;
      artifactProvenanceOf(packageRecord).artifact_uri = packageUri;
      rehashArtifactProvenanceContainer(packageRecord);

      const result = validateDeployTemplatePackage(packageRecord);

      expectInvalid(result, 'package_uri must be a remote/CI artifact URI');
      expectInvalid(result, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');
    },
  );

  it.each([
    'http://localhost/artifacts/agentsmith-deploy-template-package.tgz',
    'http://127.0.0.1/artifacts/agentsmith-deploy-template-package.tgz',
    'http://[::1]/artifacts/agentsmith-deploy-template-package.tgz',
    'http://0.0.0.0/artifacts/agentsmith-deploy-template-package.tgz',
    'local://deploy-template-package/agentsmith-deploy-template-package.tgz',
  ])('rejects deploy template package local package_uri and artifact_uri %s', (packageUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    packageRecord.package_uri = packageUri;
    artifactProvenanceOf(packageRecord).artifact_uri = packageUri;
    rehashArtifactProvenanceContainer(packageRecord);

    const result = validateDeployTemplatePackage(packageRecord);

    expectInvalid(result, 'package_uri must be a remote/CI artifact URI');
    expectInvalid(result, 'artifact_provenance.artifact_uri must be a remote/CI artifact URI');
  });

  it.each([
    'https://api.github.com/repos/agentsmith-project/agentsmith/git/blobs/0123456789abcdef0123456789abcdef01234567',
    'https://api.github.com/repos/agentsmith-project/agentsmith/git/trees/0123456789abcdef0123456789abcdef01234567',
    'https://api.github.com/repos/agentsmith-project/agentsmith/git/refs/heads/main',
  ])('rejects deploy template package GitHub API source subject_uri %s', (subjectUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(packageRecord).subject_uri = subjectUri;

    expectInvalid(
      validateDeployTemplatePackage(packageRecord),
      'artifact_provenance.subject_uri must not point at local AgentSmith product source',
    );
  });

  it.each([
    'https://api.github.com/repos/agentsmith-project/agentsmith/%67it/blobs/0123456789abcdef0123456789abcdef01234567',
    'https://github.com/agentsmith-project/agentsmith/bl%6fb/main/packages/application/deploy-template-package.json',
  ])('rejects deploy template package percent-encoded GitHub source subject_uri %s', (subjectUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(packageRecord).subject_uri = subjectUri;

    expectInvalid(
      validateDeployTemplatePackage(packageRecord),
      'artifact_provenance.subject_uri must not point at local AgentSmith product source',
    );
  });

  it.each(GITHUB_API_SOURCE_ROOT_ENDPOINTS)(
    'rejects deploy template package exact GitHub API source subject_uri %s',
    (subjectUri) => {
      const packageRecord = cloneFixture('deploy-template-package.valid.json');
      artifactProvenanceOf(packageRecord).subject_uri = subjectUri;

      expectInvalid(
        validateDeployTemplatePackage(packageRecord),
        'artifact_provenance.subject_uri must not point at local AgentSmith product source',
      );
    },
  );

  it.each([
    'local://deploy-template-package/subject.json',
    'http://localhost/subject.json',
    'http://127.0.0.1/subject.json',
  ])('rejects deploy template package local subject_uri %s', (subjectUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(packageRecord).subject_uri = subjectUri;

    expectInvalid(
      validateDeployTemplatePackage(packageRecord),
      'artifact_provenance.subject_uri must not point at local AgentSmith product source',
    );
  });

  it('allows deploy template package remote attestation_uri', () => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(packageRecord).attestation = VALID_REMOTE_ATTESTATION;

    expect(validateDeployTemplatePackage(packageRecord).ok).toBe(true);
  });

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/attestation.intoto.jsonl',
    './attestation.intoto.jsonl',
    'local://deploy-template-package/attestation.intoto.jsonl',
    'https://github.com/agentsmith-project/agentsmith/blob/main/attestation.intoto.jsonl',
    'https://raw.githubusercontent.com/agentsmith-project/agentsmith/main/attestation.intoto.jsonl',
    'https://api.github.com/repos/agentsmith-project/agentsmith/contents/attestation.intoto.jsonl?ref=main',
  ])('rejects deploy template package local/source attestation_uri %s', (attestationUri) => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    artifactProvenanceOf(packageRecord).attestation = {
      ...VALID_REMOTE_ATTESTATION,
      attestation_uri: attestationUri,
    };

    expectInvalid(
      validateDeployTemplatePackage(packageRecord),
      'artifact_provenance.attestation.attestation_uri must be a remote/CI artifact URI',
    );
  });

  it.each([
    {
      name: 'release-kit evidence',
      fixture: 'release-kit-evidence.valid.json',
      validate: validateReleaseKitEvidence,
      attestationUri:
        'https://github.com/agentsmith-project/agentsmith-release-kit/blob/main/attestation.intoto.jsonl',
    },
    {
      name: 'runner release manifest',
      fixture: 'runner-release-manifest.valid.json',
      validate: validateRunnerReleaseManifest,
      attestationUri:
        'https://github.com/agentsmith-project/agentsmith-runner/blob/main/attestation.intoto.jsonl',
    },
  ])('rejects local/source attestation_uri on $name artifact provenance', ({ fixture, validate, attestationUri }) => {
    const record = cloneFixture(fixture);
    artifactProvenanceOf(record).attestation = {
      ...VALID_REMOTE_ATTESTATION,
      attestation_uri: attestationUri,
    };

    expectInvalid(
      validate(record),
      'artifact_provenance.attestation.attestation_uri must be a remote/CI artifact URI',
    );
  });

  it('allows deploy template package GitHub Actions artifact API package_uri', () => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    const artifactUri = 'https://api.github.com/repos/agentsmith-project/agentsmith/actions/artifacts/123456789/zip';
    packageRecord.package_uri = artifactUri;
    artifactProvenanceOf(packageRecord).artifact_uri = artifactUri;
    rehashArtifactProvenanceContainer(packageRecord);

    expect(validateDeployTemplatePackage(packageRecord).ok).toBe(true);
  });

  it('allows deploy template package GitHub Releases download package_uri', () => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    const artifactUri =
      'https://github.com/agentsmith-project/agentsmith/releases/download/v2026.05.23/agentsmith-deploy-template-package.tgz';
    packageRecord.package_uri = artifactUri;
    artifactProvenanceOf(packageRecord).artifact_uri = artifactUri;
    rehashArtifactProvenanceContainer(packageRecord);

    expect(validateDeployTemplatePackage(packageRecord).ok).toBe(true);
  });

  it('rejects release contracts whose deploy template digest drifts from the package manifest digest', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const deployTemplatePackage = contract.deploy_template_package as Record<string, unknown>;
    deployTemplatePackage.manifest_sha256 = `sha256:${'a'.repeat(64)}`;
    rehashArtifactProvenanceContainer(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'deploy_template_digest must match deploy_template_package.manifest_sha256',
    );
  });

  it('requires deploy_template_package as a release contract field', () => {
    const contract = cloneFixture('release-contract.valid.json');
    delete contract.deploy_template_package;

    expectInvalid(validateAgentSmithReleaseContract(contract), 'deploy_template_package is required');
  });

  it('requires managed runner image adoption through the runner lock identity and inventory alias', () => {
    const contract = cloneFixture('release-contract.valid.json');
    expect(contract.managed_runner_image).toMatchObject({
      id: 'agentsmith-runner',
      image:
        'ghcr.io/agentsmith-project/agentsmith-runner:release-main-06108c534526@sha256:1f2c9b46183d9c791ea1e9d887af4ade1e54df2f363f502a43fa08ba8654769b',
      digest: 'sha256:1f2c9b46183d9c791ea1e9d887af4ade1e54df2f363f502a43fa08ba8654769b',
    });
    expect(contract.deploy_image_inventory).toContainEqual({
      id: 'managed_runner',
      image:
        'ghcr.io/agentsmith-project/agentsmith-runner:release-main-06108c534526@sha256:1f2c9b46183d9c791ea1e9d887af4ade1e54df2f363f502a43fa08ba8654769b',
      digest: 'sha256:1f2c9b46183d9c791ea1e9d887af4ade1e54df2f363f502a43fa08ba8654769b',
      source: 'managed_runner_image',
      source_provenance: {
        producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
        normalized_remote: 'github.com/agentsmith-project/agentsmith-runner',
        commit_sha: '06108c5345263e89081400b5f30f3f67c7329369',
        tag: 'release-main-06108c534526',
        run_id: '27233217906',
        run_attempt: '1',
        run_url: 'https://github.com/agentsmith-project/agentsmith-runner/actions/runs/27233217906/attempts/1',
        subject_name: 'agentsmith-managed-runner-image',
        artifact_uri:
          'gh-artifact://agentsmith-project/agentsmith-runner/27233217906/agentsmith-managed-runner-image.oci',
        artifact_sha256: 'sha256:1f2c9b46183d9c791ea1e9d887af4ade1e54df2f363f502a43fa08ba8654769b',
        runner_release_manifest_uri:
          'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/27233217906/runner-release-manifest.json',
        runner_release_manifest_subject_sha256:
          'sha256:91f8e59c17445a2c7fcafa7da5ab1fcc3b617c8c83170010a09882f4420cb0df',
        runner_release_manifest_artifact_sha256:
          'sha256:91f8e59c17445a2c7fcafa7da5ab1fcc3b617c8c83170010a09882f4420cb0df',
        runner_ga_handoff_uri:
          'gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/27233217906/runner-ga-handoff-report.json',
        runner_ga_handoff_manifest_input_sha256:
          'sha256:460ea641f407ad7e88abcab887f4dbf0f6e3dc26e90a86eff5ce18c2117254b0',
        runner_ga_handoff_report_sha256:
          'sha256:2fb3f79e4fdf8666326a3a74fc9f92cb608ae3426887449953ddb0f19c692b1b',
      },
    });

    const missingManagedRunner = cloneFixture('release-contract.valid.json');
    delete missingManagedRunner.managed_runner_image;
    expectInvalid(validateAgentSmithReleaseContract(missingManagedRunner), 'managed_runner_image is required');

    const wrongTopLevelId = cloneFixture('release-contract.valid.json');
    (wrongTopLevelId.managed_runner_image as Record<string, unknown>).id = 'managed_runner';
    rehashReleaseContract(wrongTopLevelId);
    expectInvalid(validateAgentSmithReleaseContract(wrongTopLevelId), 'managed_runner_image.id must be "agentsmith-runner"');

    const missingRequiredId = cloneFixture('release-contract.valid.json');
    const deployTemplatePackage = missingRequiredId.deploy_template_package as Record<string, unknown>;
    deployTemplatePackage.required_image_ids = (deployTemplatePackage.required_image_ids as string[])
      .filter((imageId) => imageId !== 'managed_runner');
    rehashArtifactProvenanceContainer(deployTemplatePackage);
    rehashArtifactProvenanceContainer(missingRequiredId);
    rehashReleaseContractProjection(missingRequiredId);
    expectInvalid(
      validateAgentSmithReleaseContract(missingRequiredId),
      'deploy image inventory id "managed_runner" is not required by deploy_template_package.required_image_ids',
    );

    const valueException = cloneFixture('release-contract.valid.json');
    (valueException.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'managed_runner',
    )!.source = 'adopted_provider_images';
    rehashReleaseContract(valueException);
    expectInvalid(
      validateAgentSmithReleaseContract(valueException),
      'deploy image inventory entry must match the declared image source',
    );

    const missingRunnerReleaseManifestProvenance = cloneFixture('release-contract.valid.json');
    const managedRunnerProvenance = (
      (missingRunnerReleaseManifestProvenance.deploy_image_inventory as Array<Record<string, unknown>>).find(
        (image) => image.id === 'managed_runner',
      )!.source_provenance as Record<string, unknown>
    );
    delete managedRunnerProvenance.runner_release_manifest_uri;
    delete managedRunnerProvenance.runner_release_manifest_subject_sha256;
    delete managedRunnerProvenance.runner_release_manifest_artifact_sha256;
    rehashReleaseContract(missingRunnerReleaseManifestProvenance);
    expectInvalid(
      validateAgentSmithReleaseContract(missingRunnerReleaseManifestProvenance),
      'runner release manifest provenance is required for managed runner image adoption.',
    );

    const missingRunnerGaHandoffProvenance = cloneFixture('release-contract.valid.json');
    const managedRunnerHandoffProvenance = (
      (missingRunnerGaHandoffProvenance.deploy_image_inventory as Array<Record<string, unknown>>).find(
        (image) => image.id === 'managed_runner',
      )!.source_provenance as Record<string, unknown>
    );
    delete managedRunnerHandoffProvenance.runner_ga_handoff_uri;
    delete managedRunnerHandoffProvenance.runner_ga_handoff_manifest_input_sha256;
    delete managedRunnerHandoffProvenance.runner_ga_handoff_report_sha256;
    rehashReleaseContract(missingRunnerGaHandoffProvenance);
    expectInvalid(
      validateAgentSmithReleaseContract(missingRunnerGaHandoffProvenance),
      'runner GA handoff provenance is required for managed runner image adoption.',
    );

    const runnerReleaseManifestRunDrift = cloneFixture('release-contract.valid.json');
    const runnerReleaseManifestRunDriftProvenance = (
      (runnerReleaseManifestRunDrift.deploy_image_inventory as Array<Record<string, unknown>>).find(
        (image) => image.id === 'managed_runner',
      )!.source_provenance as Record<string, unknown>
    );
    runnerReleaseManifestRunDriftProvenance.runner_release_manifest_uri =
      'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/999/runner-release-manifest.json';
    rehashReleaseContract(runnerReleaseManifestRunDrift);
    expectInvalid(
      validateAgentSmithReleaseContract(runnerReleaseManifestRunDrift),
      'runner_release_manifest_uri must equal gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/27233217906/runner-release-manifest.json',
    );

    const runnerReleaseManifestDigestDrift = cloneFixture('release-contract.valid.json');
    const runnerReleaseManifestDigestDriftProvenance = (
      (runnerReleaseManifestDigestDrift.deploy_image_inventory as Array<Record<string, unknown>>).find(
        (image) => image.id === 'managed_runner',
      )!.source_provenance as Record<string, unknown>
    );
    runnerReleaseManifestDigestDriftProvenance.runner_release_manifest_artifact_sha256 =
      `sha256:${'f'.repeat(64)}`;
    rehashReleaseContract(runnerReleaseManifestDigestDrift);
    expectInvalid(
      validateAgentSmithReleaseContract(runnerReleaseManifestDigestDrift),
      'runner release manifest artifact sha256 must match runner release manifest subject sha256.',
    );
  });

  it('rejects deploy template required image ids that are missing, unsorted, duplicated, or outside inventory', () => {
    const missingRequiredIds = cloneFixture('deploy-template-package.valid.json');
    delete missingRequiredIds.required_image_ids;
    expectInvalid(validateDeployTemplatePackage(missingRequiredIds), 'required_image_ids must be an array');

    const emptyRequiredIds = cloneFixture('deploy-template-package.valid.json');
    emptyRequiredIds.required_image_ids = [];
    expectInvalid(validateDeployTemplatePackage(emptyRequiredIds), 'required_image_ids must not be empty');

    const unsortedRequiredIds = cloneFixture('deploy-template-package.valid.json');
    unsortedRequiredIds.required_image_ids = ['agentsmith_app', 'afscp'];
    expectInvalid(
      validateDeployTemplatePackage(unsortedRequiredIds),
      'required_image_ids must be sorted ascending and unique',
    );

    const duplicateRequiredIds = cloneFixture('deploy-template-package.valid.json');
    duplicateRequiredIds.required_image_ids = ['afscp', 'afscp'];
    expectInvalid(validateDeployTemplatePackage(duplicateRequiredIds), 'required image id "afscp" is declared more than once');

    const contract = cloneFixture('release-contract.valid.json');
    const deployTemplatePackage = contract.deploy_template_package as Record<string, unknown>;
    deployTemplatePackage.required_image_ids = [
      ...(deployTemplatePackage.required_image_ids as string[]),
      'undeclared_provider',
    ].sort();
    rehashArtifactProvenanceContainer(deployTemplatePackage);
    rehashArtifactProvenanceContainer(contract);
    rehashReleaseContractProjection(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'deploy template required image id "undeclared_provider" is missing from deploy_image_inventory',
    );
  });

  it('rejects deploy image inventory ids that are not required by the deploy template package', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const deployTemplatePackage = contract.deploy_template_package as Record<string, unknown>;
    deployTemplatePackage.required_image_ids = (deployTemplatePackage.required_image_ids as string[])
      .filter((imageId) => imageId !== 'llmup');
    rehashArtifactProvenanceContainer(deployTemplatePackage);
    rehashArtifactProvenanceContainer(contract);
    rehashReleaseContractProjection(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'deploy image inventory id "llmup" is not required by deploy_template_package.required_image_ids',
    );
  });

  it('rejects duplicate deploy image inventory ids', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const inventory = contract.deploy_image_inventory as Array<Record<string, unknown>>;
    inventory.push(structuredClone(inventory[0]!));
    rehashReleaseContract(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'deploy_image_inventory id "agentsmith_app" is declared more than once',
    );
  });

  it('requires GA deploy image inventory source provenance and validates digest and repo binding', () => {
    const missingSourceProvenance = cloneFixture('release-contract.valid.json');
    delete (missingSourceProvenance.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'llmup',
    )!.source_provenance;
    rehashReleaseContract(missingSourceProvenance);
    expectInvalid(
      validateAgentSmithReleaseContract(missingSourceProvenance),
      'source_provenance is required for GA image id "llmup"',
    );

    const digestDrift = cloneFixture('release-contract.valid.json');
    const asbcpProvenance = (digestDrift.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'asbcp',
    )!.source_provenance as Record<string, unknown>;
    asbcpProvenance.artifact_sha256 = `sha256:${'9'.repeat(64)}`;
    rehashReleaseContract(digestDrift);
    expectInvalid(
      validateAgentSmithReleaseContract(digestDrift),
      'source_provenance.artifact_sha256 must match image.digest',
    );

    const repoMismatch = cloneFixture('release-contract.valid.json');
    const afscpProvenance = (repoMismatch.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'afscp',
    )!.source_provenance as Record<string, unknown>;
    afscpProvenance.producer_repo = 'github.com/agentsmith-project/agentsmith';
    rehashReleaseContract(repoMismatch);
    expectInvalid(
      validateAgentSmithReleaseContract(repoMismatch),
      'canonical repo identity must be github.com/agentsmith-project/agentsmith-fs-control-plane',
    );

    const missingRunUrl = cloneFixture('release-contract.valid.json');
    const llmupMissingRunUrlProvenance = (missingRunUrl.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'llmup',
    )!.source_provenance as Record<string, unknown>;
    delete llmupMissingRunUrlProvenance.run_url;
    rehashReleaseContract(missingRunUrl);
    expectInvalid(
      validateAgentSmithReleaseContract(missingRunUrl),
      'source_provenance.run_url must be a non-empty string',
    );

    const runUrlRepoMismatch = cloneFixture('release-contract.valid.json');
    const llmupRunUrlProvenance = (runUrlRepoMismatch.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'llmup',
    )!.source_provenance as Record<string, unknown>;
    llmupRunUrlProvenance.run_url =
      'https://github.com/agentsmith-project/agentsmith/actions/runs/30001/attempts/1';
    rehashReleaseContract(runUrlRepoMismatch);
    expectInvalid(
      validateAgentSmithReleaseContract(runUrlRepoMismatch),
      'source_provenance.run_url must be for canonical repo github.com/agentsmith-project/llm-universal-proxy',
    );

    const localArtifactUri = cloneFixture('release-contract.valid.json');
    const asbcpArtifactProvenance = (localArtifactUri.deploy_image_inventory as Array<Record<string, unknown>>).find(
      (image) => image.id === 'asbcp',
    )!.source_provenance as Record<string, unknown>;
    asbcpArtifactProvenance.artifact_uri = '../dist/asbcp-image.oci';
    rehashReleaseContract(localArtifactUri);
    expectInvalid(
      validateAgentSmithReleaseContract(localArtifactUri),
      'source_provenance.artifact_uri must be a remote/CI artifact URI',
    );
  });

  it('rejects missing provenance, self-referential provenance subjects, and wrong or local repo identity', () => {
    expect(normalizeReleaseBoundaryRemote('https://github.com/agentsmith-project/agentsmith.git'))
      .toBe(AGENTSMITH_CANONICAL_REPO);
    expect(normalizeReleaseBoundaryRemote('git@github.com:agentsmith-project/agentsmith.git'))
      .toBe(AGENTSMITH_CANONICAL_REPO);

    const missingProvenance = cloneFixture('release-contract.valid.json');
    delete missingProvenance.artifact_provenance;
    expectInvalid(validateAgentSmithReleaseContract(missingProvenance), 'artifact_provenance is required');

    const selfReferential = cloneFixture('release-contract.valid.json');
    const selfReferentialProvenance = artifactProvenanceOf(selfReferential);
    selfReferentialProvenance.subject_uri = selfReferentialProvenance.artifact_uri;
    selfReferentialProvenance.subject_sha256 = sha256Digest(canonicalReleaseBoundaryJson(selfReferential));
    expectInvalid(
      validateAgentSmithReleaseContract(selfReferential),
      'subject_sha256 must hash the subject without artifact_provenance',
    );

    const localRepo = cloneFixture('release-contract.valid.json');
    artifactProvenanceOf(localRepo).normalized_remote = '/home/percy/works/mbos-v1/agentsmith';
    expectInvalid(validateAgentSmithReleaseContract(localRepo), 'canonical repo identity must be github.com/agentsmith-project/agentsmith');

    const mutuallyExclusiveRemote = cloneFixture('release-contract.valid.json');
    artifactProvenanceOf(mutuallyExclusiveRemote).normalized_remote = 'https://github.com/agentsmith-project/agentsmith.git';
    expectInvalid(
      validateAgentSmithReleaseContract(mutuallyExclusiveRemote),
      'normalized_remote must already be canonical github.com/agentsmith-project/agentsmith',
    );
  });

  it('rejects release contract artifact projection digest drift', () => {
    const contract = cloneFixture('release-contract.valid.json');
    artifactProvenanceOf(contract).artifact_sha256 = `sha256:${'9'.repeat(64)}`;

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'artifact projection mismatch',
    );
  });

  it('rejects release contracts whose provenance commit differs from git_sha after projection rehash', () => {
    const contract = cloneFixture('release-contract.valid.json');
    artifactProvenanceOf(contract).commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';
    rehashReleaseContractProjection(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'artifact_provenance.commit_sha must match git_sha',
    );
  });

  it('rejects release contracts whose deploy template package provenance commit differs from git_sha after rehash', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const deployTemplatePackage = contract.deploy_template_package as Record<string, unknown>;
    artifactProvenanceOf(deployTemplatePackage).commit_sha = 'ffffffffffffffffffffffffffffffffffffffff';
    rehashArtifactProvenanceContainer(deployTemplatePackage);
    rehashArtifactProvenanceContainer(contract);
    rehashReleaseContractProjection(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'deploy_template_package.artifact_provenance.commit_sha must match git_sha',
    );
  });

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/release-contract.json',
    'http://localhost/artifacts/agentsmith-release-contract.json',
    'http://127.0.0.1/artifacts/agentsmith-release-contract.json',
    'local://release-contract/agentsmith-release-contract.json',
    'https://github.com/agentsmith-project/agentsmith/archive/0123456789abcdef0123456789abcdef01234567.tar.gz',
  ])('rejects release contract source artifact_uri %s', (artifactUri) => {
    const contract = cloneFixture('release-contract.valid.json');
    artifactProvenanceOf(contract).artifact_uri = artifactUri;
    rehashReleaseContractProjection(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'artifact_provenance.artifact_uri must be a remote/CI artifact URI',
    );
  });

  it('rejects agentsmith-codex-runner as a runner release producer', () => {
    const manifest = cloneFixture('runner-release-manifest.valid.json');
    const provenance = artifactProvenanceOf(manifest);
    provenance.producer_repo = 'github.com/agentsmith-project/agentsmith-codex-runner';
    provenance.normalized_remote = 'github.com/agentsmith-project/agentsmith-codex-runner';

    expectInvalid(validateRunnerReleaseManifest(manifest), 'canonical repo identity must be github.com/agentsmith-project/agentsmith-runner');
  });

  it('rejects legacy top-level substrate service truth as non-canonical', () => {
    const legacyTruth = {
      schema_version: 'agentsmith.substrate-connection.truth/v1',
      target_cluster: 'existing_kubernetes',
      substrate_source: 'external_declared',
      distribution: 'online',
      postgres: {
        host: 'postgres.prod.internal',
        port: 5432,
        database: 'agentsmith',
        user_secret_ref: 'secretRef:agentsmith/postgres-user',
        sslmode: 'require',
        required_extensions: ['vector'],
        reachability: 'validated',
      },
      mongodb: {
        host: 'mongo.prod.internal',
        port: 27017,
        database: 'agentsmith',
        user_secret_ref: 'secretRef:agentsmith/mongodb-user',
        tls: 'required',
        reachability: 'validated',
      },
      redis: {
        host: 'redis.prod.internal',
        port: 6379,
        password_secret_ref: 'secretRef:agentsmith/redis-password',
        tls: 'required',
        reachability: 'validated',
      },
      object_storage: {
        endpoint: 'https://s3.prod.internal',
        bucket: 'agentsmith-files',
        access_key_secret_ref: 'secretRef:agentsmith/s3-access-key',
        scheme: 'https',
        tls: 'required',
        addressing_style: 'virtual_host',
        reachability: 'validated',
      },
      oidc: {
        public_issuer: 'https://id.prod.internal/realms/agentsmith',
        realm: 'agentsmith',
        client_id: 'agentsmith-web',
        client_secret_ref: 'secretRef:agentsmith/oidc-client',
        jwks_reachability: 'validated',
        metadata_reachability: 'validated',
        validation_mode: 'read_only',
      },
    };

    expectInvalid(
      validateSubstrateConnectionTruth(legacyTruth),
      'substrate_connection_truth.services must be an object',
    );
  });

  it.each([
    ['schema_version', 'agentsmith.docker-substrate.truth/v1'],
    ['source_truth_schema', 'agentsmith.docker-substrate.truth/v1'],
    ['kit_truth_source', 'agentsmith.docker-substrate.truth/v1'],
    ['source_truth_schema', 'docker-substrate.truth/v1'],
  ])('rejects external_declared substrate truth that reuses Docker truth via %s', (field, schemaVersion) => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    truth[field] = schemaVersion;

    expectInvalid(validateSubstrateConnectionTruth(truth), 'external_declared must not use docker-substrate truth');
  });

  it.each([
    'postgres',
    'postgresql',
    'mongodb',
    'redis',
    'object_storage',
    'oidc',
  ])('rejects legacy top-level substrate service key %s even when canonical services are present', (legacyKey) => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    truth[legacyKey] = {
      note: 'legacy top-level service binding',
    };

    expectInvalid(
      validateSubstrateConnectionTruth(truth),
      `legacy top-level substrate service key "${legacyKey}" is not allowed`,
    );
  });

  it('rejects external_declared substrate truth with Docker default host including a port', () => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    ((truth.services as Record<string, unknown>).postgresql as Record<string, unknown>).host = 'localhost:5432';

    expectInvalid(validateSubstrateConnectionTruth(truth), 'external_declared must not use Docker default endpoint');
  });

  it('rejects substrate truth missing target axes or canonical service requirements', () => {
    const missingTargetCluster = cloneFixture('substrate-connection.external-declared.valid.json');
    delete missingTargetCluster.target_cluster;
    expectInvalid(
      validateSubstrateConnectionTruth(missingTargetCluster),
      'target_cluster is not in the release boundary matrix',
    );

    const missingDistribution = cloneFixture('substrate-connection.external-declared.valid.json');
    delete missingDistribution.distribution;
    expectInvalid(
      validateSubstrateConnectionTruth(missingDistribution),
      'distribution is not in the release boundary matrix',
    );

    const missingService = cloneFixture('substrate-connection.external-declared.valid.json');
    delete ((missingService.services as Record<string, unknown>).redis);
    expectInvalid(
      validateSubstrateConnectionTruth(missingService),
      'substrate_connection_truth.services missing required service: redis',
    );

    const missingSecret = cloneFixture('substrate-connection.external-declared.valid.json');
    delete (((missingSecret.services as Record<string, unknown>).redis as Record<string, unknown>).credential_secret_ref);
    expectInvalid(
      validateSubstrateConnectionTruth(missingSecret),
      'services.redis.credential_secret_ref must be a non-empty string',
    );

    const missingTls = cloneFixture('substrate-connection.external-declared.valid.json');
    delete (((missingTls.services as Record<string, unknown>).object_storage as Record<string, unknown>).tls);
    expectInvalid(
      validateSubstrateConnectionTruth(missingTls),
      'services.object_storage must include tls or sslmode',
    );

    const missingReachability = cloneFixture('substrate-connection.external-declared.valid.json');
    delete (((missingReachability.services as Record<string, unknown>).oidc as Record<string, unknown>).reachability);
    expectInvalid(
      validateSubstrateConnectionTruth(missingReachability),
      'services.oidc.reachability must be an object',
    );

    const missingVectorExtension = cloneFixture('substrate-connection.external-declared.valid.json');
    delete (((missingVectorExtension.services as Record<string, unknown>).postgresql as Record<string, unknown>).extensions);
    expectInvalid(
      validateSubstrateConnectionTruth(missingVectorExtension),
      'postgresql truth must include pgvector extension check',
    );

    const missingRedactedFingerprint = cloneFixture('substrate-connection.external-declared.valid.json');
    delete missingRedactedFingerprint.redacted_fingerprint;
    expectInvalid(
      validateSubstrateConnectionTruth(missingRedactedFingerprint),
      'redacted_fingerprint must be a non-empty string',
    );
  });

  it.each(NON_PLAIN_RELEASE_KIT_VERSIONS)(
    'rejects kit_installed substrate truth whose release_kit_version is not plain semver: %s',
    (version) => {
      const truth = cloneFixture('substrate-connection.kit-installed.valid.json');
      truth.release_kit_version = version;

      expectInvalid(
        validateSubstrateConnectionTruth(truth),
        'release_kit_version must be a plain semver x.y.z string',
      );
    },
  );

  it('allows external_declared substrate truth without product-flow probe secret refs but validates them when present', () => {
    const withoutProbeRefs = cloneFixture('substrate-connection.external-declared.valid.json');
    delete withoutProbeRefs.product_flow_probe_secret_refs;
    expect(validateSubstrateConnectionTruth(withoutProbeRefs).ok).toBe(true);

    const invalidProbeRefs = cloneFixture('substrate-connection.external-declared.valid.json');
    invalidProbeRefs.product_flow_probe_secret_refs = Object.fromEntries(
      CURRENT_REQUIRED_PRODUCT_FLOWS.map((flow) => [
        flow,
        flow === 'files' ? 'plain-probe-secret' : `secretRef:agentsmith/probe-${flow.replaceAll('_', '-')}`,
      ]),
    );
    expectInvalid(
      validateSubstrateConnectionTruth(invalidProbeRefs),
      'credential values must be persisted as secret refs only',
    );
  });

  it('requires external_declared release-kit evidence to bind an external substrate connection truth', () => {
    const missingTruth = cloneFixture('release-kit-evidence.valid.json');
    missingTruth.substrate_source = 'external_declared';
    delete missingTruth.substrate_connection_truth;
    expectInvalid(
      validateReleaseKitEvidence(missingTruth),
      'external_declared release kit evidence must include substrate_connection_truth',
    );

    const dockerTruth = cloneFixture('release-kit-evidence.valid.json');
    dockerTruth.substrate_source = 'external_declared';
    dockerTruth.substrate_connection_truth = cloneFixture('substrate-connection.kit-installed.valid.json');
    expectInvalid(
      validateReleaseKitEvidence(dockerTruth),
      'substrate_connection_truth.substrate_source must be external_declared',
    );

    const removedDiagnosticExternalTruth = cloneFixture('release-kit-evidence.valid.json');
    removedDiagnosticExternalTruth.substrate_source = 'external_declared';
    removedDiagnosticExternalTruth.substrate_connection_truth =
      cloneFixture('substrate-connection.external-declared.valid.json');
    (removedDiagnosticExternalTruth.substrate_connection_truth as Record<string, unknown>).target_cluster =
      'kind_rehearsal';
    expectInvalid(
      validateReleaseKitEvidence(removedDiagnosticExternalTruth),
      'deployment mode is not allowed by the release boundary matrix',
    );

    const mismatchedTruth = cloneFixture('release-kit-evidence.valid.json');
    mismatchedTruth.substrate_source = 'external_declared';
    mismatchedTruth.target_cluster = 'kind_rehearsal';
    mismatchedTruth.substrate_connection_truth = cloneFixture('substrate-connection.external-declared.valid.json');
    expectInvalid(
      validateReleaseKitEvidence(mismatchedTruth),
      'substrate_connection_truth target axes must match release kit evidence target axes',
    );
  });

  it('rejects secret-looking field names unless the field stores a reference', () => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    ((truth.services as Record<string, unknown>).oidc as Record<string, unknown>).client_secret = 'plain-secret';

    expectInvalid(
      validateSubstrateConnectionTruth(truth),
      'secret-bearing field "client_secret" must use a reference field',
    );
  });

  it('rejects secret-looking reference fields unless their values are secret refs or safe sentinels', () => {
    const secretFields = cloneFixture('release-kit-evidence.valid.json');
    secretFields.provider = {
      clientSecretRef: 'plain-release-secret',
      AccessTokenRefs: ['plain-release-token'],
    };

    const result = validateReleaseKitEvidence(secretFields);

    expectInvalid(result, 'secret reference field "clientSecretRef" must use secretRef: values');
    expectInvalid(result, 'secret reference field "AccessTokenRefs" must use secretRef: values');
  });

  it('rejects empty or multi-line secret refs in substrate truth and generic release-kit reference fields', () => {
    const substrateTruth = cloneFixture('substrate-connection.external-declared.valid.json');
    ((substrateTruth.services as Record<string, unknown>).postgresql as Record<string, unknown>).credential_secret_ref =
      'secretRef:';
    ((substrateTruth.services as Record<string, unknown>).oidc as Record<string, unknown>).client_secret_ref =
      'secretRef:   :   ';

    expectInvalid(
      validateSubstrateConnectionTruth(substrateTruth),
      'secretRef path/id must be non-empty and single-line',
    );

    const releaseKitEvidence = cloneFixture('release-kit-evidence.valid.json');
    releaseKitEvidence.provider = {
      clientSecretRef: 'secretRef:',
      api_key_ref: 'secretRef:release/api-key\nleaked',
    };

    expectInvalid(
      validateReleaseKitEvidence(releaseKitEvidence),
      'secretRef path/id must be non-empty and single-line',
    );
  });

  it('rejects release-kit evidence with target cluster/writer mismatches and secret leaks', () => {
    const masquerade = cloneFixture('release-kit-evidence.valid.json');
    masquerade.target_cluster = 'kind_rehearsal';
    expectInvalid(
      validateReleaseKitEvidence(masquerade),
      'target_cluster is not allowed for the mapped current release-kit evidence writer',
    );

    const secretLeak = cloneFixture('release-kit-evidence.valid.json');
    secretLeak.debug_log = 'database password=super-secret';
    expectInvalid(validateReleaseKitEvidence(secretLeak), 'secret-looking value');
  });

  it('rejects focused release-kit outputs bound to the wrong target profile distribution', () => {
    const onlineWithAirgapDistribution = cloneFixture('release-kit-evidence.valid.json');
    onlineWithAirgapDistribution.distribution = 'airgap';
    (onlineWithAirgapDistribution.substrate_connection_truth as Record<string, unknown>).distribution = 'airgap';
    expectInvalid(
      validateReleaseKitEvidence(onlineWithAirgapDistribution),
      'target profile tuple is not allowed for the mapped current release-kit evidence writer',
    );

    const airgapWithOnlineDistribution = cloneFixture('release-kit-evidence.valid.json');
    airgapWithOnlineDistribution.target = 'images';
    airgapWithOnlineDistribution.canonical_writer = {
      gate_id: 'release-kit-airgap-bundle-check',
      line_kind: 'release_kit_airgap_bundle_check',
    };
    (airgapWithOnlineDistribution.evidence_subject as Record<string, unknown>).files = [
      {
        path: 'evidence.json',
        sha256: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      },
      {
        path: 'airgap-bundle-check-report.json',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'airgap-bundle-manifest.json',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      {
        path: 'image-map.json',
        sha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
    ];
    rehashArtifactProvenanceSubject(airgapWithOnlineDistribution, 'evidence_subject');
    expectInvalid(
      validateReleaseKitEvidence(airgapWithOnlineDistribution),
      'target profile tuple is not allowed for the mapped current release-kit evidence writer',
    );
  });

  it('accepts kit-installed airgap bundle evidence with substrate-pack-manifest subject binding', () => {
    const kitInstalledAirgap = cloneFixture('release-kit-evidence.valid.json');
    kitInstalledAirgap.target = 'images';
    kitInstalledAirgap.substrate_source = 'kit_installed';
    kitInstalledAirgap.distribution = 'airgap';
    kitInstalledAirgap.canonical_writer = {
      gate_id: 'release-kit-airgap-bundle-check',
      line_kind: 'release_kit_airgap_bundle_check',
    };
    kitInstalledAirgap.substrate_connection_truth = cloneFixture('substrate-connection.kit-installed.valid.json');
    (kitInstalledAirgap.substrate_connection_truth as Record<string, unknown>).distribution = 'airgap';
    (kitInstalledAirgap.evidence_subject as Record<string, unknown>).files = [
      {
        path: 'evidence.json',
        sha256: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      },
      {
        path: 'airgap-bundle-check-report.json',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'airgap-bundle-manifest.json',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      {
        path: 'image-map.json',
        sha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
      {
        path: 'substrate-pack-manifest.json',
        sha256: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      },
    ];
    rehashArtifactProvenanceSubject(kitInstalledAirgap, 'evidence_subject');

    expect(validateReleaseKitEvidence(kitInstalledAirgap).ok).toBe(true);
    expect(validateReleaseKitEvidenceForAggregate(kitInstalledAirgap)).toMatchObject({
      ok: true,
      value: {
        target: 'images',
        substrate_source: 'kit_installed',
        distribution: 'airgap',
      },
    });
  });

  it('rejects kit-installed airgap bundle evidence missing substrate-pack-manifest subject binding', () => {
    const kitInstalledAirgap = cloneFixture('release-kit-evidence.valid.json');
    kitInstalledAirgap.target = 'images';
    kitInstalledAirgap.substrate_source = 'kit_installed';
    kitInstalledAirgap.distribution = 'airgap';
    kitInstalledAirgap.canonical_writer = {
      gate_id: 'release-kit-airgap-bundle-check',
      line_kind: 'release_kit_airgap_bundle_check',
    };
    kitInstalledAirgap.substrate_connection_truth = cloneFixture('substrate-connection.kit-installed.valid.json');
    (kitInstalledAirgap.substrate_connection_truth as Record<string, unknown>).distribution = 'airgap';
    (kitInstalledAirgap.evidence_subject as Record<string, unknown>).files = [
      {
        path: 'evidence.json',
        sha256: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      },
      {
        path: 'airgap-bundle-check-report.json',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'airgap-bundle-manifest.json',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      {
        path: 'image-map.json',
        sha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
    ];
    rehashArtifactProvenanceSubject(kitInstalledAirgap, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(kitInstalledAirgap),
      'substrate-pack-manifest.json',
    );
  });

  it('rejects external-declared airgap bundle evidence with substrate-pack-manifest subject binding', () => {
    const externalDeclaredAirgap = cloneFixture('release-kit-evidence.valid.json');
    externalDeclaredAirgap.target = 'images';
    externalDeclaredAirgap.distribution = 'airgap';
    (externalDeclaredAirgap.substrate_connection_truth as Record<string, unknown>).distribution = 'airgap';
    externalDeclaredAirgap.canonical_writer = {
      gate_id: 'release-kit-airgap-bundle-check',
      line_kind: 'release_kit_airgap_bundle_check',
    };
    (externalDeclaredAirgap.evidence_subject as Record<string, unknown>).files = [
      {
        path: 'evidence.json',
        sha256: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      },
      {
        path: 'airgap-bundle-check-report.json',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'airgap-bundle-manifest.json',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      {
        path: 'image-map.json',
        sha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
      {
        path: 'substrate-pack-manifest.json',
        sha256: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      },
    ];
    rehashArtifactProvenanceSubject(externalDeclaredAirgap, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(externalDeclaredAirgap),
      'evidence_subject.files must contain only mapped release-kit subject file(s)',
    );
  });

  it('rejects release-kit evidence missing metadata subject file evidence.json', () => {
    const withoutMetadataSubjectFile = cloneFixture('release-kit-evidence.valid.json');
    const metadataFiles = (
      withoutMetadataSubjectFile.evidence_subject as Record<string, unknown>
    ).files as Record<string, unknown>[];
    (withoutMetadataSubjectFile.evidence_subject as Record<string, unknown>).files = metadataFiles
      .filter((file) => file.path !== 'evidence.json');
    rehashArtifactProvenanceSubject(withoutMetadataSubjectFile, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(withoutMetadataSubjectFile),
      'release-kit metadata subject file(s): evidence.json',
    );
  });

  it('rejects canonical release-kit evidence missing mapped native output files', () => {
    const onlineMissingReport = cloneFixture('release-kit-evidence.valid.json');
    const onlineFiles = (onlineMissingReport.evidence_subject as Record<string, unknown>).files as Record<string, unknown>[];
    (onlineMissingReport.evidence_subject as Record<string, unknown>).files = onlineFiles
      .filter((file) => file.path !== 'online-deployment-gate-report.json');
    rehashArtifactProvenanceSubject(onlineMissingReport, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(onlineMissingReport),
      'mapped release-kit native output file(s): online-deployment-gate-report.json',
    );

    const airgapMissingManifest = cloneFixture('release-kit-evidence.valid.json');
    airgapMissingManifest.target = 'images';
    airgapMissingManifest.distribution = 'airgap';
    (airgapMissingManifest.substrate_connection_truth as Record<string, unknown>).distribution = 'airgap';
    airgapMissingManifest.canonical_writer = {
      gate_id: 'release-kit-airgap-bundle-check',
      line_kind: 'release_kit_airgap_bundle_check',
    };
    (airgapMissingManifest.evidence_subject as Record<string, unknown>).files = [
      {
        path: 'evidence.json',
        sha256: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      },
      {
        path: 'airgap-bundle-check-report.json',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'image-map.json',
        sha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
    ];
    rehashArtifactProvenanceSubject(airgapMissingManifest, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(airgapMissingManifest),
      'mapped release-kit native output file(s): airgap-bundle-manifest.json',
    );

    const airgapMissingImageMap = cloneFixture('release-kit-evidence.valid.json');
    airgapMissingImageMap.target = 'images';
    airgapMissingImageMap.distribution = 'airgap';
    (airgapMissingImageMap.substrate_connection_truth as Record<string, unknown>).distribution = 'airgap';
    airgapMissingImageMap.canonical_writer = {
      gate_id: 'release-kit-airgap-bundle-check',
      line_kind: 'release_kit_airgap_bundle_check',
    };
    (airgapMissingImageMap.evidence_subject as Record<string, unknown>).files = [
      {
        path: 'evidence.json',
        sha256: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      },
      {
        path: 'airgap-bundle-check-report.json',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'airgap-bundle-manifest.json',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
    ];
    rehashArtifactProvenanceSubject(airgapMissingImageMap, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(airgapMissingImageMap),
      'mapped release-kit native output file(s): image-map.json',
    );
  });

  it('rejects prefixed env token and secret key leaks in release-kit evidence', () => {
    const prefixedToken = cloneFixture('release-kit-evidence.valid.json');
    prefixedToken.debug_log = 'release operator exported GITHUB_TOKEN=ghp_plainreleaseleak1234567890';
    expectInvalid(validateReleaseKitEvidence(prefixedToken), 'secret-looking value');

    const prefixedSecretKey = cloneFixture('release-kit-evidence.valid.json');
    prefixedSecretKey.debug_log = 'AWS_SECRET_ACCESS_KEY=plainreleaseawssecret1234567890';
    expectInvalid(validateReleaseKitEvidence(prefixedSecretKey), 'secret-looking value');
  });

  it('rejects release-kit evidence passed status with a non-none failure_class before aggregate mapping', () => {
    const contradictory = cloneFixture('release-kit-evidence.valid.json');
    contradictory.status = 'passed';
    contradictory.failure_class = 'contract_drift';

    expectInvalid(
      validateReleaseKitEvidence(contradictory),
      'passed release kit evidence must use failure_class none',
    );
    expectInvalid(
      validateReleaseKitEvidenceForAggregate(contradictory),
      'passed release kit evidence must use failure_class none',
    );
  });

  it.each(NON_PLAIN_RELEASE_KIT_VERSIONS)(
    'rejects release-kit evidence whose release_kit_version is not plain semver: %s',
    (version) => {
      const evidence = cloneFixture('release-kit-evidence.valid.json');
      evidence.release_kit_version = version;

      expectInvalid(
        validateReleaseKitEvidence(evidence),
        'release_kit_version must be a plain semver x.y.z string',
      );
    },
  );

  it('rejects release-kit raw evidence envelopes as aggregate canonical evidence', () => {
    const rawEnvelope = cloneFixture('release-kit-evidence.valid.json');
    rawEnvelope.schema_version = 'agentsmith.release-kit-evidence-envelope/v1';

    expectInvalid(
      validateReleaseKitEvidenceForAggregate(rawEnvelope),
      'schema_version must be "agentsmith.release-kit-evidence/v1"',
    );
  });

  it('rejects camelCase secret-looking release kit evidence fields in nested records and arrays', () => {
    const secretFields = cloneFixture('release-kit-evidence.valid.json');
    secretFields.provider = {
      clientSecret: 'plain-release-secret',
      apiKey: 'plain-release-key',
      probes: [
        {
          accessToken: 'plain-release-token',
        },
      ],
    };

    const result = validateReleaseKitEvidence(secretFields);

    expectInvalid(result, 'secret-bearing field "clientSecret" must use a reference field');
    expectInvalid(result, 'secret-bearing field "apiKey" must use a reference field');
    expectInvalid(result, 'secret-bearing field "accessToken" must use a reference field');
  });

  it('allows release kit evidence secret-looking reference fields across field name styles', () => {
    const referenceFields = cloneFixture('release-kit-evidence.valid.json');
    referenceFields.provider = {
      clientSecretRef: 'secretRef:release/client',
      api_key_ref: 'secretRef:release/api-key',
      'access-token-ref': 'secretRef:release/access-token',
      probes: [
        {
          AccessTokenRefs: ['secretRef:release/probe-access-token'],
        },
      ],
    };

    expect(validateReleaseKitEvidence(referenceFields).ok).toBe(true);
  });

  it('rejects arbitrary release-kit evidence subjects even when the provenance hash is recomputed', () => {
    const arbitrarySubject = cloneFixture('release-kit-evidence.valid.json');
    arbitrarySubject.evidence_subject = {
      schema_version: CURRENT_RELEASE_KIT_EVIDENCE_SUBJECT_SCHEMA_VERSION,
      note: 'this object does not bind evidence files',
    };
    rehashArtifactProvenanceSubject(arbitrarySubject, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(arbitrarySubject),
      'evidence_subject.files must be a non-empty array',
    );

    const absolutePath = cloneFixture('release-kit-evidence.valid.json');
    ((absolutePath.evidence_subject as Record<string, unknown>).files as Record<string, unknown>[])[0].path =
      '/tmp/render-report.json';
    rehashArtifactProvenanceSubject(absolutePath, 'evidence_subject');
    expectInvalid(validateReleaseKitEvidence(absolutePath), 'evidence_subject.files[0].path must be a safe relative path');

    const parentTraversal = cloneFixture('release-kit-evidence.valid.json');
    ((parentTraversal.evidence_subject as Record<string, unknown>).files as Record<string, unknown>[])[0].path =
      '../render-report.json';
    rehashArtifactProvenanceSubject(parentTraversal, 'evidence_subject');
    expectInvalid(validateReleaseKitEvidence(parentTraversal), 'evidence_subject.files[0].path must be a safe relative path');

    const duplicatePath = cloneFixture('release-kit-evidence.valid.json');
    const duplicateFiles = (duplicatePath.evidence_subject as Record<string, unknown>).files as Record<string, unknown>[];
    duplicateFiles.push({
      path: 'evidence.json',
      sha256: `sha256:${'8'.repeat(64)}`,
    });
    rehashArtifactProvenanceSubject(duplicatePath, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(duplicatePath),
      'evidence_subject.files contains duplicate path: evidence.json',
    );
  });

  it('rejects release-kit evidence subjects with schema drift even when the provenance hash is recomputed', () => {
    const evilSubjectSchema = cloneFixture('release-kit-evidence.valid.json');
    (evilSubjectSchema.evidence_subject as Record<string, unknown>).schema_version = 'evil.release-kit-subject/v0';
    rehashArtifactProvenanceSubject(evilSubjectSchema, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(evilSubjectSchema),
      `evidence_subject.schema_version must be "${CURRENT_RELEASE_KIT_EVIDENCE_SUBJECT_SCHEMA_VERSION}"`,
    );
  });

  it('rejects release-kit evidence subject ownership drift even when the provenance hash is recomputed', () => {
    const extraSubjectClaim = cloneFixture('release-kit-evidence.valid.json');
    (extraSubjectClaim.evidence_subject as Record<string, unknown>).extra_unowned_claim = 'release-kit owns more';
    rehashArtifactProvenanceSubject(extraSubjectClaim, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(extraSubjectClaim),
      'evidence_subject.extra_unowned_claim is not allowed',
    );

    const extraFileClaim = cloneFixture('release-kit-evidence.valid.json');
    const files = (extraFileClaim.evidence_subject as Record<string, unknown>).files as Record<string, unknown>[];
    files[0].extra_unowned_claim = 'release-kit owns file metadata';
    rehashArtifactProvenanceSubject(extraFileClaim, 'evidence_subject');

    expectInvalid(
      validateReleaseKitEvidence(extraFileClaim),
      'evidence_subject.files[0].extra_unowned_claim is not allowed',
    );
  });

  it('rejects mappings to nonexistent writers, duplicate ownership, and release-kit-forged product smoke evidence', () => {
    const mapping = structuredClone(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING);
    const productFlowMappingIndex = mapping.findIndex((entry) => entry.target === 'product_flows');
    mapping[productFlowMappingIndex] = {
      ...mapping[productFlowMappingIndex],
      canonical_writer: {
        ...mapping[productFlowMappingIndex].canonical_writer,
        gate_id: 'lane-unified-deploy-missing',
      },
    };
    expectInvalid(validateReleaseKitEvidenceMapping(mapping), 'canonical writer gate_id does not exist');

    const duplicateMapping = structuredClone(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING);
    duplicateMapping.push({ ...duplicateMapping[0] });
    const duplicateResult = validateReleaseKitEvidenceMapping(duplicateMapping);
    expectInvalid(duplicateResult, 'release kit output "image-map.json" is declared more than once');
    expectInvalid(duplicateResult, 'canonical writer "release-kit-image-map|release_kit_image_map" is declared more than once');

    const forgedProductFlows = cloneFixture('release-kit-evidence.valid.json');
    forgedProductFlows.target = 'product_flows';
    forgedProductFlows.canonical_writer = {
      gate_id: 'lane-unified-deploy-product-flows',
      line_kind: 'unified_deploy_product_flows',
    };
    forgedProductFlows.product_smoke_canonical_evidence = {
      schema_version: POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
      producer: 'agentsmith-release-kit',
    };
    expectInvalid(
      validateReleaseKitEvidence(forgedProductFlows),
      'product smoke canonical evidence must be produced by AgentSmith post-deploy product smoke',
    );

    const legacyProductFlowFallback = cloneFixture('release-kit-evidence.valid.json');
    legacyProductFlowFallback.target = 'product_flows';
    legacyProductFlowFallback.canonical_writer = {
      gate_id: 'lane-unified-deploy-product-flows',
      line_kind: 'unified_deploy_product_flows',
    };
    legacyProductFlowFallback.product_flow_canonical_evidence = {
      producer: 'unified-deploy-product-flows',
    };
    expectInvalid(
      validateReleaseKitEvidence(legacyProductFlowFallback),
      'product smoke canonical evidence must be produced by AgentSmith post-deploy product smoke',
    );
    expectInvalid(
      validateReleaseKitEvidence(legacyProductFlowFallback),
      'product smoke canonical evidence must use the AgentSmith post-deploy report schema',
    );

    const releaseKitProductFlows = cloneFixture('release-kit-evidence.valid.json');
    releaseKitProductFlows.target = 'product_flows';
    releaseKitProductFlows.canonical_writer = {
      gate_id: 'lane-unified-deploy-product-flows',
      line_kind: 'unified_deploy_product_flows',
    };
    releaseKitProductFlows.product_smoke_canonical_evidence = {
      schema_version: POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
      producer: POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
    };
    artifactProvenanceOf(releaseKitProductFlows).producer_repo = AGENTSMITH_CANONICAL_REPO;
    artifactProvenanceOf(releaseKitProductFlows).normalized_remote = AGENTSMITH_CANONICAL_REPO;
    artifactProvenanceOf(releaseKitProductFlows).subject_name = 'agentsmith-post-deploy-product-smoke-report';
    rehashArtifactProvenanceSubject(releaseKitProductFlows, 'evidence_subject');
    expectInvalid(
      validateReleaseKitEvidence(releaseKitProductFlows),
      'product_flows release-kit evidence is not accepted in P0; use AgentSmith post-deploy product smoke report evidence',
    );

    const splitTarget = cloneFixture('release-kit-evidence.valid.json');
    splitTarget.target = {
      section: 'rollout',
    };
    expectInvalid(validateReleaseKitEvidence(splitTarget), 'target must be one release summary section string');
  });

  it('rejects non-current target cluster axes in release kit evidence mapping', () => {
    const mapping = structuredClone(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING) as Record<string, unknown>[];
    mapping[0] = {
      ...mapping[0],
      current_campaign_target_clusters: ['local-kind'],
    };

    expectInvalid(
      validateReleaseKitEvidenceMapping(mapping),
      'target_cluster is not in the release boundary matrix',
    );
  });

  it('rejects duplicate truth ids in the release boundary truth matrix', () => {
    const matrix = structuredClone(CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX);
    matrix.push({ ...matrix[0] });

    expectInvalid(
      validateTruthMatrix(matrix),
      'truth matrix truth "release_contract" is declared more than once',
    );
  });

  it('keeps runner_contract current physical source on @mbos/agent-runner-contract after P4 extraction', () => {
    const runnerContractEntry = CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX.find((entry) => entry.truth === 'runner_contract');

    expect(runnerContractEntry).toMatchObject({
      physical_source: expect.stringContaining('@mbos/agent-runner-contract'),
    });
    expect(runnerContractEntry?.physical_source).not.toContain('packages/agent-runner/src');
    expect(runnerContractEntry?.generator).not.toContain('P4 extracts');

    const stalePhysicalSource = structuredClone(CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX);
    const index = stalePhysicalSource.findIndex((entry) => entry.truth === 'runner_contract');
    stalePhysicalSource[index] = {
      ...stalePhysicalSource[index],
      physical_source: '@mbos/agent-runner package (packages/agent-runner/src) schema/types/fixtures',
    };

    expectInvalid(
      validateTruthMatrix(stalePhysicalSource),
      'runner_contract physical_source must point to @mbos/agent-runner-contract',
    );
  });

  it('binds runner release manifests to the current runner protocol and a versioned contract string', () => {
    const manifest = cloneFixture('runner-release-manifest.valid.json');
    expect(manifest.supported_protocol_versions).toEqual(['1.0']);

    const missingProtocol = cloneFixture('runner-release-manifest.valid.json');
    missingProtocol.supported_protocol_versions = [];
    expectInvalid(
      validateRunnerReleaseManifest(missingProtocol),
      'supported_protocol_versions must exactly equal ["1.0"]',
    );

    const unknownProtocol = cloneFixture('runner-release-manifest.valid.json');
    unknownProtocol.supported_protocol_versions = ['1.0', '0.9'];
    expectInvalid(
      validateRunnerReleaseManifest(unknownProtocol),
      'supported_protocol_versions must exactly equal ["1.0"]',
    );

    const arbitraryContractVersion = cloneFixture('runner-release-manifest.valid.json');
    arbitraryContractVersion.runner_contract_version = 'whatever';
    expectInvalid(
      validateRunnerReleaseManifest(arbitraryContractVersion),
      'runner_contract_version must be a semver string',
    );

    const leadingZeroContractVersion = cloneFixture('runner-release-manifest.valid.json');
    leadingZeroContractVersion.runner_contract_version = '01.02.03';
    expectInvalid(
      validateRunnerReleaseManifest(leadingZeroContractVersion),
      'runner_contract_version must be a semver string',
    );
  });

  it('rejects runner release manifest legacy image id and P5.3a skeleton drift', () => {
    const legacyImageId = cloneFixture('runner-release-manifest.valid.json');
    (legacyImageId.image as Record<string, unknown>).id = 'agent-task-runner';
    expectInvalid(validateRunnerReleaseManifest(legacyImageId), 'image.id must be "agentsmith-runner"');

    const missingContractArtifact = cloneFixture('runner-release-manifest.valid.json');
    delete missingContractArtifact.contract_artifact;
    expectInvalid(validateRunnerReleaseManifest(missingContractArtifact), 'contract_artifact is required');

    const missingAdoptionPolicy = cloneFixture('runner-release-manifest.valid.json');
    delete missingAdoptionPolicy.adoption_policy;
    expectInvalid(validateRunnerReleaseManifest(missingAdoptionPolicy), 'adoption_policy is required');

    const descriptorFields = cloneFixture('runner-release-manifest.valid.json');
    const contractArtifact = descriptorFields.contract_artifact as Record<string, unknown>;
    contractArtifact.descriptor_uri = 'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/501/descriptor.json';
    contractArtifact.descriptor_sha256 = `sha256:${'e'.repeat(64)}`;
    expectInvalid(validateRunnerReleaseManifest(descriptorFields), 'contract_artifact.descriptor_uri is not allowed');

    const artifactHashDrift = cloneFixture('runner-release-manifest.valid.json');
    artifactProvenanceOf(artifactHashDrift).artifact_sha256 = `sha256:${'0'.repeat(64)}`;
    expectInvalid(
      validateRunnerReleaseManifest(artifactHashDrift),
      'artifact_provenance.artifact_sha256 must equal artifact_provenance.subject_sha256 in skeleton mode',
    );
  });

  it('requires canonical runner manifest and P5.2 contract artifact URIs', () => {
    const nonCanonicalManifestArtifactUri = cloneFixture('runner-release-manifest.valid.json');
    artifactProvenanceOf(nonCanonicalManifestArtifactUri).artifact_uri =
      'gh-artifact://agentsmith-runner/release/501/runner-release-manifest.json';
    expectInvalid(
      validateRunnerReleaseManifest(nonCanonicalManifestArtifactUri),
      'artifact_provenance.artifact_uri must equal gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/27233217906/runner-release-manifest.json',
    );

    const nonCanonicalPackageUri = cloneFixture('runner-release-manifest.valid.json');
    (nonCanonicalPackageUri.contract_artifact as Record<string, unknown>).package_uri =
      'gh-artifact://agentsmith-project/agentsmith-runner/runner-contract-artifact/501/mbos-agent-runner-contract-0.1.0.tgz';
    expectInvalid(
      validateRunnerReleaseManifest(nonCanonicalPackageUri),
      'contract_artifact.package_uri must be gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/<positive-run-id>/<*.tgz>',
    );
  });

  it('rejects runner image refs that use latest even when digest-pinned', () => {
    const manifest = cloneFixture('runner-release-manifest.valid.json');
    const manifestImage = manifest.image as Record<string, unknown>;
    manifestImage.image =
      'ghcr.io/agentsmith-project/agentsmith-runner:latest@sha256:1f2c9b46183d9c791ea1e9d887af4ade1e54df2f363f502a43fa08ba8654769b';
    expectInvalid(
      validateRunnerReleaseManifest(manifest),
      'image.image tag "latest" is not allowed for canonical runner image refs.',
    );

    const lock = parseRunnerImageLockText(
      readRunnerImageLockText()
        .replace(
          'ghcr.io/agentsmith-project/agentsmith-runner:release-main-06108c534526@sha256:',
          'ghcr.io/agentsmith-project/agentsmith-runner:latest@sha256:',
        ),
      'latest-agentsmith-runner-image.lock',
    );

    expectInvalid(
      lock,
      'image.image tag "latest" is not allowed for canonical runner image refs.',
    );
  });

  it('rejects legacy runner image ids in image lock text', () => {
    const lock = parseRunnerImageLockText(
      readRunnerImageLockText()
        .replace('image_id=agentsmith-runner', 'image_id=agent-task-runner'),
      'legacy-agent-task-runner-image.lock',
    );

    expectInvalid(lock, 'image.id must be "agentsmith-runner"');
  });

  it('rejects runner image locks without canonical GA handoff evidence', () => {
    const missingHandoff = parseRunnerImageLockText(
      readRunnerImageLockText()
        .split(/\r?\n/u)
        .filter((line) => !line.startsWith('runner_ga_handoff_report_sha256='))
        .join('\n'),
      'missing-runner-ga-handoff.lock',
    );
    expectInvalid(missingHandoff, 'handoff.report_sha256 must be a non-empty string.');

    const nonCanonicalHandoffUri = parseRunnerImageLockText(
      readRunnerImageLockText()
        .replace(
          'runner_ga_handoff_uri=gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/27233217906/runner-ga-handoff-report.json',
          'runner_ga_handoff_uri=gh-artifact://agentsmith-project/agentsmith-runner/handoff/27233217906/report.json',
        ),
      'non-canonical-runner-ga-handoff.lock',
    );
    expectInvalid(
      nonCanonicalHandoffUri,
      'handoff.report_artifact_uri must be gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/<positive-run-id>/runner-ga-handoff-report.json.',
    );
  });

  it('rejects target profiles that leave any GA deployment target optional', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const profiles = contract.target_profiles as Record<string, unknown>[];
    profiles[0] = {
      ...profiles[0],
      required: false,
    };

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'target profile required must be true for AgentSmith GA release contract handoff targets',
    );
  });

  it.each([
    ['kind_rehearsal', 'kit_installed', 'online', 'kind_rehearsal is a local/dev option and must not be declared as a release contract handoff target'],
    ['kind_rehearsal', 'kit_installed', 'airgap', 'target profile combination is not allowed by the release boundary matrix'],
    ['kind_rehearsal', 'external_declared', 'online', 'target profile combination is not allowed by the release boundary matrix'],
    ['kind_rehearsal', 'external_declared', 'airgap', 'target profile combination is not allowed by the release boundary matrix'],
    ['local_kind', 'kit_installed', 'online', 'target_cluster is not in the release boundary matrix'],
    ['existing_kubernetes', 'external', 'online', 'substrate_source is not in the release boundary matrix'],
    ['existing_kubernetes', 'external_declared', 'offline', 'distribution is not in the release boundary matrix'],
  ])(
    'rejects non-canonical declarable target profile tuple %s/%s/%s',
    (targetCluster, substrateSource, distribution, expectedReason) => {
      const contract = cloneFixture('release-contract.valid.json');
      const profiles = contract.target_profiles as Record<string, unknown>[];
      profiles[0] = {
        ...profiles[0],
        target_cluster: targetCluster,
        substrate_source: substrateSource,
        distribution,
      };

      expectInvalid(
        validateAgentSmithReleaseContract(contract),
        expectedReason,
      );
    },
  );

  it('rejects release contracts with no target profiles', () => {
    const contract = cloneFixture('release-contract.valid.json');
    contract.target_profiles = [];
    rehashReleaseContract(contract);

    expectInvalid(
      validateAgentSmithReleaseContract(contract),
      'target_profiles must not be empty',
    );
  });

  it('rejects duplicate target profile tuples and support_level-only handoff declarations', () => {
    const duplicateContract = cloneFixture('release-contract.valid.json');
    const duplicateProfiles = duplicateContract.target_profiles as Record<string, unknown>[];
    duplicateProfiles.push({
      ...duplicateProfiles[0],
      required: true,
    });

    expectInvalid(
      validateAgentSmithReleaseContract(duplicateContract),
      'target profile tuple existing_kubernetes|external_declared|online is declared more than once',
    );

    const supportLevelOnlyContract = cloneFixture('release-contract.valid.json');
    const supportLevelOnlyProfiles = supportLevelOnlyContract.target_profiles as Record<string, unknown>[];
    delete supportLevelOnlyProfiles[0].required;
    supportLevelOnlyProfiles[0].support_level = 'primary';

    expectInvalid(
      validateAgentSmithReleaseContract(supportLevelOnlyContract),
      'target profile required must be true for AgentSmith GA release contract handoff targets',
    );

    const supportLevelWithRequiredContract = cloneFixture('release-contract.valid.json');
    const supportLevelWithRequiredProfiles = supportLevelWithRequiredContract.target_profiles as Record<string, unknown>[];
    supportLevelWithRequiredProfiles[0].support_level = 'primary';
    rehashArtifactProvenanceContainer(supportLevelWithRequiredContract);
    rehashReleaseContractProjection(supportLevelWithRequiredContract);

    expectInvalid(
      validateAgentSmithReleaseContract(supportLevelWithRequiredContract),
      'target profile support_level is not allowed; support level lives in the release boundary matrix',
    );
  });
});
