import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateReleaseKitEvidenceForAggregate,
} from '../current-release-boundary-schema';
import { adaptReleaseKitRawEvidenceEnvelope } from '../release-kit-evidence-adapter';

const FIXTURE_ROOT = resolve(process.cwd(), 'scripts/governance/__fixtures__/release-boundary');
const EXPECTED_RELEASE_CONTRACT_DIGEST = `sha256:${'a'.repeat(64)}`;
const ARTIFACT_SHA256 = `sha256:${'e'.repeat(64)}`;
const EVIDENCE_JSON_SHA256 = `sha256:${'8'.repeat(64)}`;

type AdapterResult = ReturnType<typeof adaptReleaseKitRawEvidenceEnvelope>;

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as Record<string, unknown>;
}

function cloneFixture(name: string): Record<string, unknown> {
  return structuredClone(readFixture(name));
}

function expectInvalid(result: AdapterResult, expectedReason: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('\n'))
      .toContain(expectedReason);
  }
}

function validEvidenceSubject(): Record<string, unknown> {
  return evidenceSubjectForFiles([
    {
      path: 'evidence.json',
      sha256: EVIDENCE_JSON_SHA256,
    },
    {
      path: 'render-report.json',
      sha256: `sha256:${'b'.repeat(64)}`,
    },
    {
      path: 'rollout-report.json',
      sha256: `sha256:${'c'.repeat(64)}`,
    },
  ]);
}

function evidenceSubjectForFiles(files: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema_version: 'agentsmith.release-kit-evidence-subject/v1',
    files,
  };
}

function validRawEnvelope(evidenceSubject = validEvidenceSubject()): Record<string, unknown> {
  const substrateConnectionTruth = cloneFixture('substrate-connection.external-declared.valid.json');

  return {
    schema_version: 'agentsmith.release-kit-evidence-envelope/v1',
    release_kit_output: 'render-report.json+rollout-report.json',
    release_contract_digest: EXPECTED_RELEASE_CONTRACT_DIGEST,
    release_id: '2026.05.23-p0',
    git_sha: '0123456789abcdef0123456789abcdef01234567',
    release_kit_version: '0.1.0',
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'online',
    target: {
      namespace: 'agentsmith',
      base_url: 'https://agentsmith.example.com',
    },
    status: 'passed',
    failure_class: 'none',
    substrate_connection_truth: substrateConnectionTruth,
    artifact_provenance: {
      schema_version: 'agentsmith.artifact-provenance/v1',
      provenance_kind: 'ci_artifact',
      producer_repo: 'github.com/agentsmith-project/agentsmith-release-kit',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-release-kit',
      commit_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      subject_name: 'release-kit-evidence-subject',
      subject_sha256: sha256Digest(canonicalReleaseBoundaryJson(evidenceSubject)),
      subject_uri: 'evidence-subject.json',
      workflow_name: 'release-kit-evidence',
      run_id: '10001',
      run_attempt: '1',
      job: 'evidence',
      artifact_uri: 'gh-artifact://agentsmith-release-kit/release-kit-evidence/10001/evidence-subject.json',
      artifact_sha256: ARTIFACT_SHA256,
      generated_at: '2026-05-23T12:05:00.000Z',
      generator_command: 'bash scripts/verify-release.sh --evidence',
      generator_version: '0.1.0',
      attestation: 'none',
    },
  };
}

function adapt(
  rawEnvelope: Record<string, unknown>,
  evidenceSubject = validEvidenceSubject(),
  contextOverrides: Partial<Parameters<typeof adaptReleaseKitRawEvidenceEnvelope>[2]> = {},
): AdapterResult {
  return adaptReleaseKitRawEvidenceEnvelope(rawEnvelope, evidenceSubject, {
    expectedReleaseContractDigest: EXPECTED_RELEASE_CONTRACT_DIGEST,
    expectedTargetProfile: {
      target_cluster: 'existing_kubernetes',
      substrate_source: 'external_declared',
      distribution: 'online',
    },
    evidenceRoot: 'artifacts/release-kit/raw-rollout',
    artifactSha256: ARTIFACT_SHA256,
    ...contextOverrides,
  });
}

describe('release kit raw evidence adapter', () => {
  it('maps a release-kit raw output into canonical AgentSmith release-kit evidence', () => {
    const evidenceSubject = validEvidenceSubject();
    const result = adapt(validRawEnvelope(evidenceSubject), evidenceSubject);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toMatchObject({
      schema_version: 'agentsmith.release-kit-evidence/v1',
      target: 'rollout',
      canonical_writer: {
        gate_id: 'release-kit-rollout',
        line_kind: 'release_kit_rollout',
        summary_section: 'rollout',
      },
    });
    expect(validateReleaseKitEvidenceForAggregate(result.value)).toMatchObject({
      ok: true,
      value: {
        target: 'rollout',
        summary_section: 'rollout',
      },
    });
    const files = result.value.evidence_subject.files as Record<string, unknown>[];
    expect(files.map((file) => file.path)).toEqual([
      'evidence.json',
      'render-report.json',
      'rollout-report.json',
    ]);
  });

  it('maps render/rollout/smoke raw output without falling back to local-kind writers', () => {
    const smokeSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'render-report.json',
        sha256: `sha256:${'b'.repeat(64)}`,
      },
      {
        path: 'rollout-report.json',
        sha256: `sha256:${'c'.repeat(64)}`,
      },
      {
        path: 'smoke-report.json',
        sha256: `sha256:${'d'.repeat(64)}`,
      },
    ]);
    const raw = validRawEnvelope(smokeSubject);
    raw.release_kit_output = 'render-report.json+rollout-report.json+smoke-report.json';

    const result = adapt(raw, smokeSubject);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        target_cluster: 'existing_kubernetes',
        target: 'rollout',
        canonical_writer: {
          gate_id: 'release-kit-rollout-smoke',
          line_kind: 'release_kit_rollout_smoke',
          summary_section: 'rollout',
        },
      });
      expect(validateReleaseKitEvidenceForAggregate(result.value)).toMatchObject({
        ok: true,
        value: {
          target_cluster: 'existing_kubernetes',
          target: 'rollout',
          canonical_writer: {
            gate_id: 'release-kit-rollout-smoke',
            line_kind: 'release_kit_rollout_smoke',
          },
        },
      });
    }
  });

  it('maps deploy-result and image-map raw outputs when their subject files match', () => {
    const substrateSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'deploy-result.json',
        sha256: `sha256:${'d'.repeat(64)}`,
      },
    ]);
    const substrateRaw = validRawEnvelope(substrateSubject);
    substrateRaw.release_kit_output = 'deploy-result.json#substrate';

    const substrateResult = adapt(substrateRaw, substrateSubject);

    expect(substrateResult.ok).toBe(true);
    if (substrateResult.ok) {
      expect(substrateResult.value).toMatchObject({
        target: 'dependencies',
        canonical_writer: {
          gate_id: 'release-kit-target-preflight',
          line_kind: 'release_kit_target_preflight',
        },
      });
      expect(validateReleaseKitEvidenceForAggregate(substrateResult.value)).toMatchObject({
        ok: true,
        value: {
          target: 'dependencies',
          summary_section: 'dependencies',
        },
      });
    }

    const imageSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'image-map.json',
        sha256: `sha256:${'f'.repeat(64)}`,
      },
    ]);
    const imageRaw = validRawEnvelope(imageSubject);
    imageRaw.release_kit_output = 'image-map.json';

    const imageResult = adapt(imageRaw, imageSubject);

    expect(imageResult.ok).toBe(true);
    if (imageResult.ok) {
      expect(imageResult.value).toMatchObject({
        target: 'images',
        canonical_writer: {
          gate_id: 'release-kit-image-map',
          line_kind: 'release_kit_image_map',
        },
      });
      expect(validateReleaseKitEvidenceForAggregate(imageResult.value)).toMatchObject({
        ok: true,
        value: {
          target: 'images',
          summary_section: 'images',
        },
      });
    }
  });

  it('fails fast when release_kit_output is missing, unknown, or product-flow-owned', () => {
    const missingOutput = validRawEnvelope();
    delete missingOutput.release_kit_output;
    expectInvalid(adapt(missingOutput), 'release_kit_output is required');

    const unknownOutput = validRawEnvelope();
    unknownOutput.release_kit_output = 'unknown-output.json';
    expectInvalid(adapt(unknownOutput), 'release_kit_output is not mapped');

    const productFlowOutput = validRawEnvelope();
    productFlowOutput.release_kit_output = 'AgentSmith product flow aggregate';
    expectInvalid(adapt(productFlowOutput), 'release-kit cannot produce AgentSmith product-flow evidence');
  });

  it('fails fast when release_kit_output does not match evidence_subject files', () => {
    const rolloutSubject = validEvidenceSubject();
    const raw = validRawEnvelope(rolloutSubject);
    raw.release_kit_output = 'image-map.json';

    expectInvalid(
      adapt(raw, rolloutSubject),
      'release_kit_output image-map.json requires evidence_subject.files to include image-map.json',
    );

    const partialRolloutSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'render-report.json',
        sha256: `sha256:${'b'.repeat(64)}`,
      },
    ]);
    const partialRolloutRaw = validRawEnvelope(partialRolloutSubject);

    expectInvalid(
      adapt(partialRolloutRaw, partialRolloutSubject),
      'release_kit_output render-report.json+rollout-report.json requires evidence_subject.files to include rollout-report.json',
    );
  });

  it('fails fast when evidence_subject omits evidence.json', () => {
    const subjectWithoutEvidenceJson = evidenceSubjectForFiles([
      {
        path: 'render-report.json',
        sha256: `sha256:${'b'.repeat(64)}`,
      },
      {
        path: 'rollout-report.json',
        sha256: `sha256:${'c'.repeat(64)}`,
      },
    ]);
    const raw = validRawEnvelope(subjectWithoutEvidenceJson);

    expectInvalid(
      adapt(raw, subjectWithoutEvidenceJson),
      'release_kit_output render-report.json+rollout-report.json requires evidence_subject.files to include evidence.json',
    );
  });

  it('fails fast when evidence_subject contains duplicate paths even when subject_sha256 is recomputed', () => {
    const duplicateEvidenceJsonSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'render-report.json',
        sha256: `sha256:${'b'.repeat(64)}`,
      },
      {
        path: 'rollout-report.json',
        sha256: `sha256:${'c'.repeat(64)}`,
      },
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
    ]);
    const raw = validRawEnvelope(duplicateEvidenceJsonSubject);

    expectInvalid(
      adapt(raw, duplicateEvidenceJsonSubject),
      'evidence_subject.files contains duplicate path: evidence.json',
    );
  });

  it('fails fast when image-map evidence subject includes unrelated output files', () => {
    const imageSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'image-map.json',
        sha256: `sha256:${'f'.repeat(64)}`,
      },
      {
        path: 'rollout-report.json',
        sha256: `sha256:${'c'.repeat(64)}`,
      },
    ]);
    const imageRaw = validRawEnvelope(imageSubject);
    imageRaw.release_kit_output = 'image-map.json';

    expectInvalid(
      adapt(imageRaw, imageSubject),
      'release_kit_output image-map.json requires evidence_subject.files to contain only evidence.json, image-map.json',
    );
  });

  it('fails fast when render/rollout evidence subject includes unrelated output files', () => {
    const rolloutSubject = evidenceSubjectForFiles([
      {
        path: 'evidence.json',
        sha256: EVIDENCE_JSON_SHA256,
      },
      {
        path: 'render-report.json',
        sha256: `sha256:${'b'.repeat(64)}`,
      },
      {
        path: 'rollout-report.json',
        sha256: `sha256:${'c'.repeat(64)}`,
      },
      {
        path: 'image-map.json',
        sha256: `sha256:${'f'.repeat(64)}`,
      },
    ]);
    const rolloutRaw = validRawEnvelope(rolloutSubject);

    expectInvalid(
      adapt(rolloutRaw, rolloutSubject),
      'release_kit_output render-report.json+rollout-report.json requires evidence_subject.files to contain only evidence.json, render-report.json, rollout-report.json',
    );
  });

  it('fails fast on target axes and release contract digest mismatch', () => {
    const wrongAxes = validRawEnvelope();
    wrongAxes.target_cluster = 'kind_rehearsal';
    expectInvalid(adapt(wrongAxes), 'target axes must match adapter context');

    const wrongDigest = validRawEnvelope();
    wrongDigest.release_contract_digest = `sha256:${'f'.repeat(64)}`;
    expectInvalid(adapt(wrongDigest), 'release_contract_digest must match adapter context');
  });

  it('fails fast when raw artifact provenance conflicts with context artifactSha256', () => {
    const wrongArtifactSha = validRawEnvelope();
    (wrongArtifactSha.artifact_provenance as Record<string, unknown>).artifact_sha256 = `sha256:${'1'.repeat(64)}`;

    expectInvalid(
      adapt(wrongArtifactSha),
      'artifact_provenance.artifact_sha256 must match adapter context',
    );

    const missingArtifactSha = validRawEnvelope();
    delete (missingArtifactSha.artifact_provenance as Record<string, unknown>).artifact_sha256;

    const result = adapt(missingArtifactSha);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifact_provenance.artifact_sha256).toBe(ARTIFACT_SHA256);
    }
  });

  it('keeps canonical substrate truth validation for external_declared evidence', () => {
    const raw = validRawEnvelope();
    delete raw.substrate_connection_truth;

    expectInvalid(
      adapt(raw),
      'external_declared release kit evidence must include substrate_connection_truth',
    );
  });

  it('fails fast when the raw release_kit_version is not plain semver', () => {
    const raw = validRawEnvelope();
    raw.release_kit_version = 'v0.1.0';

    expectInvalid(
      adapt(raw),
      'release_kit_version must be a plain semver x.y.z string',
    );
  });

  it('fails fast on subject hash mismatch, old subject name, and secret leaks', () => {
    const raw = validRawEnvelope();
    const mismatchedSubject = validEvidenceSubject();
    ((mismatchedSubject.files as Record<string, unknown>[])[0]).sha256 = `sha256:${'d'.repeat(64)}`;
    expectInvalid(adapt(raw, mismatchedSubject), 'subject_sha256 must match evidence subject');

    const oldSubjectName = validRawEnvelope();
    (oldSubjectName.artifact_provenance as Record<string, unknown>).subject_name = 'agentsmith-release-kit-evidence';
    expectInvalid(adapt(oldSubjectName), 'subject_name must be release-kit-evidence-subject');

    const secretLeak = validRawEnvelope();
    secretLeak.target = {
      namespace: 'agentsmith',
      base_url: 'https://agentsmith.example.com',
      api_token: 'ghp_plainreleaseleak1234567890',
    };
    expectInvalid(adapt(secretLeak), 'secret-bearing field "api_token" must use a reference field');
  });

  it('rejects raw-only camelCase and sk-prefixed secret leaks before canonical adaptation', () => {
    const raw = validRawEnvelope();
    raw.raw_only_diagnostics = {
      provider: {
        clientSecret: 'plain-release-secret',
        apiKey: 'plain-release-key',
      },
      logs: [
        'provider returned sk-releaseleak1234567890',
      ],
    };

    const result = adapt(raw);

    expectInvalid(result, 'secret-bearing field "clientSecret" must use a reference field');
    expectInvalid(result, 'secret-bearing field "apiKey" must use a reference field');
    expectInvalid(result, 'secret-looking value');
  });
});
