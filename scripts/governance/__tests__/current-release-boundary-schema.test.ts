import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_DEPLOYMENT_MODE_MATRIX,
  CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
  CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
  CURRENT_REQUIRED_PRODUCT_FLOWS,
  AGENTSMITH_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  diagnoseReleaseKitEvidenceForAggregate,
  normalizeReleaseBoundaryRemote,
  sha256Digest,
  validateAgentSmithReleaseContract,
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

describe('current release boundary schema', () => {
  it('validates P0 handoff fixtures for release contract, substrate truth, release kit evidence, and runner manifest', () => {
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

  it('rejects secret-looking field names unless the field stores a reference', () => {
    const truth = cloneFixture('substrate-connection.external-declared.valid.json');
    (truth.oidc as Record<string, unknown>).client_secret = 'plain-secret';

    expectInvalid(
      validateSubstrateConnectionTruth(truth),
      'secret-bearing field "client_secret" must use a reference field',
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

  it('rejects mappings to nonexistent writers and release-kit-forged product-flow canonical evidence', () => {
    const mapping = structuredClone(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING);
    mapping[0] = {
      ...mapping[0],
      canonical_writer: {
        ...mapping[0].canonical_writer,
        gate_id: 'lane-unified-deploy-missing',
      },
    };
    expectInvalid(validateReleaseKitEvidenceMapping(mapping), 'canonical writer gate_id does not exist');

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

    const splitTarget = cloneFixture('release-kit-evidence.valid.json');
    splitTarget.target = {
      section: 'rollout',
    };
    expectInvalid(validateReleaseKitEvidence(splitTarget), 'target must be one release summary section string');
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
