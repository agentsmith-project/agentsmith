import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_DEPLOYMENT_MODE_MATRIX,
  CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
  CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
  CURRENT_RELEASE_KIT_EVIDENCE_SUBJECT_SCHEMA_VERSION,
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
  validateRunnerReleaseManifest,
  validateSubstrateConnectionTruth,
  validateTruthMatrix,
} from '../current-release-boundary-schema';

const FIXTURE_ROOT = resolve(process.cwd(), 'scripts/governance/__fixtures__/release-boundary');

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

const GITHUB_API_SOURCE_ROOT_ENDPOINTS = [
  'https://api.github.com/repos/agentsmith-project/agentsmith/cont%65nts?ref=main',
  'https://api.github.com/repos/agentsmith-project/agentsmith/contents?ref=main',
  'https://api.github.com/repos/agentsmith-project/agentsmith/tarball',
  'https://api.github.com/repos/agentsmith-project/agentsmith/zipball',
];

describe('current release boundary schema', () => {
  it('validates P0 handoff fixtures for release contract, substrate truth, release kit evidence, and runner manifest', () => {
    expect(validateDeployTemplatePackage(readFixture('deploy-template-package.valid.json')).ok).toBe(true);
    expect(validateAgentSmithReleaseContract(readFixture('release-contract.valid.json')).ok).toBe(true);
    expect(validateSubstrateConnectionTruth(readFixture('substrate-connection.external-declared.valid.json')).ok)
      .toBe(true);
    expect(validateSubstrateConnectionTruth(readFixture('substrate-connection.kit-installed.valid.json')).ok)
      .toBe(true);

    const releaseKitEvidence = readFixture('release-kit-evidence.valid.json');
    expect(releaseKitEvidence.target).toBe('rollout');
    expect(validateReleaseKitEvidence(releaseKitEvidence).ok).toBe(true);
    expect(validateReleaseKitEvidenceForAggregate(releaseKitEvidence)).toMatchObject({
      ok: true,
      value: {
        schema_version: 'agentsmith.release-kit-evidence.aggregate-canonical/v1',
        target: 'rollout',
        summary_section: 'rollout',
        canonical_writer: {
          gate_id: 'lane-unified-deploy-local-kind',
          line_kind: 'unified_deploy_local_kind',
          npm_script: 'lane:unified-deploy:local-kind',
          native_result_path: '<campaign-root>/lane-unified-deploy-local-kind/native/result.json',
          evidence_root: '<campaign-root>/unified-deploy/local-kind',
        },
      },
    });
    expect(diagnoseReleaseKitEvidenceForAggregate(releaseKitEvidence)).toMatchObject({
      ok: true,
      canonical_shape: {
        target: 'rollout',
        summary_section: 'rollout',
      },
      failures: [],
    });
    expect(validateRunnerReleaseManifest(readFixture('runner-release-manifest.valid.json')).ok).toBe(true);
  });

  it('freezes the deployment mode matrix without making kind a required target', () => {
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
      ['kind_rehearsal', 'kit_installed', 'airgap', 'rehearsal'],
      ['kind_rehearsal', 'external_declared', 'online', 'diagnostic'],
      ['kind_rehearsal', 'external_declared', 'airgap', 'diagnostic'],
    ]);
    expect(CURRENT_DEPLOYMENT_MODE_MATRIX.filter((entry) => entry.required_target)).toEqual([]);
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

    const productFlowMapping = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.find((entry) => entry.target === 'product_flows');
    expect(productFlowMapping).toMatchObject({
      canonical_writer: {
        gate_id: 'lane-unified-deploy-product-flows',
        line_kind: 'unified_deploy_product_flows',
      },
      canonical_evidence_owner: 'agentsmith',
      expected_product_flow_producer: 'unified-deploy-product-flows',
    });
  });

  it('rejects tag-only images, missing image digests, and missing required product flows', () => {
    const tagOnly = cloneFixture('release-contract.valid.json');
    const productImages = tagOnly.product_images as Record<string, unknown>[];
    productImages[0].image = 'ghcr.io/agentsmith-project/agentsmith-web:v1.0.0';
    expectInvalid(validateAgentSmithReleaseContract(tagOnly), 'image must be pinned by digest');

    const missingDigest = cloneFixture('release-contract.valid.json');
    const adoptedProviderImages = missingDigest.adopted_provider_images as Record<string, unknown>[];
    delete adoptedProviderImages[0].digest;
    expectInvalid(validateAgentSmithReleaseContract(missingDigest), 'image digest is required');

    const missingFlow = cloneFixture('release-contract.valid.json');
    missingFlow.required_product_flows = CURRENT_REQUIRED_PRODUCT_FLOWS.filter((flow) => flow !== 'files');
    expectInvalid(validateAgentSmithReleaseContract(missingFlow), 'required product flow "files" is missing');
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

  it('allows deploy template package GitHub Actions artifact API package_uri', () => {
    const packageRecord = cloneFixture('deploy-template-package.valid.json');
    const artifactUri = 'https://api.github.com/repos/agentsmith-project/agentsmith/actions/artifacts/123456789/zip';
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

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/release-contract.json',
    'https://github.com/agentsmith-project/agentsmith/archive/0123456789abcdef0123456789abcdef01234567.tar.gz',
  ])('rejects release contract source artifact_uri %s', (artifactUri) => {
    const contract = cloneFixture('release-contract.valid.json');
    artifactProvenanceOf(contract).artifact_uri = artifactUri;

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

  it('rejects external_declared substrate truth that reuses Docker truth', () => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    truth.source_truth_schema = 'docker-substrate.truth/v1';

    expectInvalid(validateSubstrateConnectionTruth(truth), 'external_declared must not use docker-substrate truth');
  });

  it('allows external_declared substrate truth without product-flow probe secret refs but validates them when present', () => {
    const withoutProbeRefs = cloneFixture('substrate-connection.external-declared.valid.json');
    delete withoutProbeRefs.product_flow_probe_secret_refs;
    expect(validateSubstrateConnectionTruth(withoutProbeRefs).ok).toBe(true);

    const invalidProbeRefs = cloneFixture('substrate-connection.external-declared.valid.json');
    (invalidProbeRefs.product_flow_probe_secret_refs as Record<string, unknown>).files = 'plain-probe-secret';
    expectInvalid(
      validateSubstrateConnectionTruth(invalidProbeRefs),
      'credential values must be persisted as secret refs only',
    );
  });

  it('requires external_declared release-kit evidence to bind an external substrate connection truth', () => {
    const missingTruth = cloneFixture('release-kit-evidence.valid.json');
    missingTruth.substrate_source = 'external_declared';
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

    const externalTruth = cloneFixture('release-kit-evidence.valid.json');
    externalTruth.substrate_source = 'external_declared';
    externalTruth.substrate_connection_truth = cloneFixture('substrate-connection.external-declared.valid.json');
    expect(validateReleaseKitEvidence(externalTruth).ok).toBe(true);
  });

  it('rejects secret-looking field names unless the field stores a reference', () => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    (truth.oidc as Record<string, unknown>).client_secret = 'plain-secret';

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
    (substrateTruth.postgres as Record<string, unknown>).user_secret_ref = 'secretRef:';
    (substrateTruth.oidc as Record<string, unknown>).client_secret_ref = 'secretRef:   :   ';

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

  it('rejects local-kind evidence masquerading as existing Kubernetes release evidence and secret leaks', () => {
    const masquerade = cloneFixture('release-kit-evidence.valid.json');
    masquerade.target_cluster = 'existing_kubernetes';
    expectInvalid(validateReleaseKitEvidence(masquerade), 'local-kind campaign writer cannot accept existing_kubernetes evidence');

    const secretLeak = cloneFixture('release-kit-evidence.valid.json');
    secretLeak.debug_log = 'database password=super-secret';
    expectInvalid(validateReleaseKitEvidence(secretLeak), 'secret-looking value');
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

  it('rejects mappings to nonexistent writers, duplicate ownership, and release-kit-forged product-flow evidence', () => {
    const mapping = structuredClone(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING);
    mapping[0] = {
      ...mapping[0],
      canonical_writer: {
        ...mapping[0].canonical_writer,
        gate_id: 'lane-unified-deploy-missing',
      },
    };
    expectInvalid(validateReleaseKitEvidenceMapping(mapping), 'canonical writer gate_id does not exist');

    const duplicateMapping = structuredClone(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING);
    duplicateMapping.push({ ...duplicateMapping[0] });
    const duplicateResult = validateReleaseKitEvidenceMapping(duplicateMapping);
    expectInvalid(duplicateResult, 'release kit evidence target "dependencies" is declared more than once');
    expectInvalid(duplicateResult, 'canonical writer "lane-unified-deploy-substrate|unified_deploy_substrate" is declared more than once');

    const forgedProductFlows = cloneFixture('release-kit-evidence.valid.json');
    forgedProductFlows.target = 'product_flows';
    forgedProductFlows.canonical_writer = {
      gate_id: 'lane-unified-deploy-product-flows',
      line_kind: 'unified_deploy_product_flows',
    };
    forgedProductFlows.product_flow_canonical_evidence = {
      producer: 'agentsmith-release-kit',
    };
    expectInvalid(validateReleaseKitEvidence(forgedProductFlows), 'product flow canonical evidence must be produced by AgentSmith');

    const releaseKitProductFlows = cloneFixture('release-kit-evidence.valid.json');
    releaseKitProductFlows.target = 'product_flows';
    releaseKitProductFlows.canonical_writer = {
      gate_id: 'lane-unified-deploy-product-flows',
      line_kind: 'unified_deploy_product_flows',
    };
    releaseKitProductFlows.product_flow_canonical_evidence = {
      producer: 'unified-deploy-product-flows',
    };
    artifactProvenanceOf(releaseKitProductFlows).producer_repo = AGENTSMITH_CANONICAL_REPO;
    artifactProvenanceOf(releaseKitProductFlows).normalized_remote = AGENTSMITH_CANONICAL_REPO;
    artifactProvenanceOf(releaseKitProductFlows).subject_name = 'agentsmith-product-flow-evidence';
    rehashArtifactProvenanceSubject(releaseKitProductFlows, 'evidence_subject');
    expectInvalid(
      validateReleaseKitEvidence(releaseKitProductFlows),
      'product_flows release-kit evidence is not accepted in P0',
    );

    const splitTarget = cloneFixture('release-kit-evidence.valid.json');
    splitTarget.target = {
      section: 'rollout',
    };
    expectInvalid(validateReleaseKitEvidence(splitTarget), 'target must be one release summary section string');
  });

  it('rejects duplicate truth ids in the release boundary truth matrix', () => {
    const matrix = structuredClone(CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX);
    matrix.push({ ...matrix[0] });

    expectInvalid(
      validateTruthMatrix(matrix),
      'truth matrix truth "release_contract" is declared more than once',
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

  it('rejects target profiles that mark kind as a required deployment target', () => {
    const contract = cloneFixture('release-contract.valid.json');
    const profiles = contract.target_profiles as Record<string, unknown>[];
    profiles.push({
      target_cluster: 'kind_rehearsal',
      substrate_source: 'kit_installed',
      distribution: 'online',
      required: true,
      prerequisites: {
        namespace: 'agentsmith',
        rbac: 'namespace_admin',
        ingress: 'local',
        tls: 'optional',
        storage_class: 'standard',
        registry: 'local',
        pull_secret_ref: 'not_required',
      },
    });

    expectInvalid(validateAgentSmithReleaseContract(contract), 'kind_rehearsal must not be marked as a required deployment target');
  });
});
