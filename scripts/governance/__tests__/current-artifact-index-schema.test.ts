import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findCurrentGateDefinitionById } from '../current-gate-manifest';
import {
  CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  CURRENT_JOB_METADATA_MANIFEST_VERSION,
  listCurrentJobMetadata,
} from '../current-job-metadata-manifest';
import { listCurrentVerificationCampaigns } from '../current-verification-campaign-manifest';
import {
  buildCurrentArtifactTemplateIndex,
  CURRENT_ARTIFACT_TEMPLATE_INDEX,
  CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
  CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
  listCurrentArtifactTemplates,
  validateCurrentArtifactTemplateIndex,
} from '../current-artifact-index-schema';

const FORBIDDEN_TEMPLATE_RUNTIME_FIELDS = [
  'exists',
  'status',
  'exit_code',
  'passed',
  'failed',
  'stale',
  'reusable',
  'cache_hit',
  'claim_id',
  'claim_reuse',
  'verdict',
  'result_status',
  'failure_class',
  'artifact_digest',
  'result_digest',
  'input_digest',
  'run_id',
  'campaign_root',
] as const;

const SECRET_LOOKING_VALUES = [
  'sk-test-secret',
  'Bearer test-secret',
  'api_key=test-secret',
  'access_token=test-secret',
  'client_secret=test-secret',
  'password=test-secret',
  'ticket=test-secret',
] as const;

function cloneCurrentIndex(): typeof CURRENT_ARTIFACT_TEMPLATE_INDEX {
  return structuredClone(CURRENT_ARTIFACT_TEMPLATE_INDEX);
}

function expectValidationFailure(index: unknown, expectedReason: string): void {
  const result = validateCurrentArtifactTemplateIndex(index);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining(expectedReason),
        }),
      ]),
    );
  }
}

function expectedTemplatePaths(): readonly string[] {
  return listCurrentJobMetadata().flatMap((job) => job.outputs.expected_artifact_path_templates);
}

function expectedRequiredFor(entry: ReturnType<typeof buildCurrentArtifactTemplateIndex>['templates'][number]): readonly string[] {
  if (entry.producer.kind === 'campaign_step') {
    return ['release'];
  }

  const gate = findCurrentGateDefinitionById(entry.producer.gate_id);
  const requirements = gate?.requiredFor.length ? gate.requiredFor : gate?.storyEvidenceRequiredFor ?? [];
  const ordered = ['default', 'release', 'visual'] as const;

  return ordered.filter((requirement) => requirements.includes(requirement));
}

describe('current artifact template index schema', () => {
  it('declares only expected artifact templates derived from current job metadata', () => {
    const index = buildCurrentArtifactTemplateIndex();
    const jobs = listCurrentJobMetadata();
    const campaigns = listCurrentVerificationCampaigns();
    const paths = expectedTemplatePaths();

    expect(CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA).toBe('current-artifact-template-index.v1');
    expect(CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION).toBe(1);
    expect(index).toMatchObject({
      schema: CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
      version: CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
      source_truth: {
        current_job_metadata_manifest: {
          schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
          version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
          job_count: jobs.length,
          output_template_source: 'outputs.expected_artifact_path_templates',
        },
        current_verification_campaign_manifest: {
          campaign_ids: campaigns.map((campaign) => campaign.id),
          campaign_count: campaigns.length,
        },
      },
      summary: {
        projection_kind: 'declared_template_index',
        artifact_directory_inspection: false,
        creates_evidence_claim: false,
        schema_validation: 'fail_closed',
        job_count: jobs.length,
        template_count: paths.length,
        required_template_count: paths.length,
        campaign_id_count: 1,
      },
    });
    expect(index.templates.map((entry) => entry.template)).toEqual(paths);
    expect(listCurrentArtifactTemplates()).toBe(CURRENT_ARTIFACT_TEMPLATE_INDEX.templates);
    expect(validateCurrentArtifactTemplateIndex()).toEqual({
      ok: true,
      value: CURRENT_ARTIFACT_TEMPLATE_INDEX,
    });
  });

  it('projects template entries with producer, topology, and provenance only', () => {
    const index = buildCurrentArtifactTemplateIndex();
    const gateReleaseEntries = index.templates.filter((entry) => entry.producer.job_id === 'gate-release');
    const nativeEntry = gateReleaseEntries.find((entry) => (
      entry.template === '<campaign-root>/gate-release/native/result.json'
    ));

    expect(gateReleaseEntries.length).toBeGreaterThan(0);
    expect(nativeEntry).toMatchObject({
      kind: 'native_result_template',
      required_for: ['release'],
      producer: {
        kind: 'campaign_step',
        job_id: 'gate-release',
        campaign_id: 'release-full',
        gate_id: 'gate-release',
        step_id: 'gate-release',
        npm_script: 'gate:release',
      },
      topology: {
        line_kind: 'release_backend_real',
        execution_mode: 'execute',
        evidence_required: true,
        result_required: true,
      },
      provenance: {
        source: 'current_job_metadata_manifest',
        source_field: 'outputs.expected_artifact_path_templates',
        campaign_step_field: 'native_result_path',
        gate_field: 'campaign_evidence_artifacts',
      },
    });
    expect(Object.keys(nativeEntry ?? {}).sort()).toEqual([
      'id',
      'kind',
      'producer',
      'provenance',
      'required_for',
      'template',
      'topology',
    ]);
    expect(Object.keys(nativeEntry?.producer ?? {}).sort()).toEqual([
      'campaign_id',
      'gate_id',
      'job_id',
      'kind',
      'npm_script',
      'step_id',
    ]);
    expect(Object.keys(nativeEntry?.provenance ?? {}).sort()).toEqual([
      'campaign_step_field',
      'gate_field',
      'gate_id',
      'source',
      'source_field',
    ]);
    expect(nativeEntry?.template).toContain('<campaign-root>');
  });

  it('marks standalone evidence artifact provenance with the standalone gate field', () => {
    const index = buildCurrentArtifactTemplateIndex();
    const standaloneVisualEntry = index.templates.find((entry) => (
      entry.producer.job_id === 'standalone-lane-visual'
      && entry.template === 'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json'
    ));

    expect(standaloneVisualEntry).toMatchObject({
      kind: 'declared_output_template',
      required_for: ['release', 'visual'],
      producer: {
        kind: 'standalone_gate',
        job_id: 'standalone-lane-visual',
        campaign_id: null,
        gate_id: 'lane-visual',
        step_id: null,
        npm_script: 'lane:visual',
      },
      provenance: {
        source: 'current_job_metadata_manifest',
        source_field: 'outputs.expected_artifact_path_templates',
        campaign_step_field: null,
        gate_id: 'lane-visual',
        gate_field: 'standalone_evidence_artifacts',
      },
    });
  });

  it('keeps every entry aligned with the current gate manifest required-for topology', () => {
    const index = buildCurrentArtifactTemplateIndex();

    for (const entry of index.templates) {
      const gate = findCurrentGateDefinitionById(entry.producer.gate_id);

      expect(gate, `${entry.id} must reference a current gate`).toBeDefined();
      expect(entry.producer.npm_script).toBe(gate?.npmScript);
      expect(entry.required_for.length).toBeGreaterThan(0);
      expect(entry.required_for).toEqual(expectedRequiredFor(entry));
    }
  });

  it('fails closed for unknown top-level and nested fields, including camelCase drift', () => {
    const topLevel = cloneCurrentIndex();
    (topLevel as Record<string, unknown>).generatedAt = '2026-04-25T00:00:00.000Z';
    expectValidationFailure(topLevel, 'unknown top-level field "generatedAt"');
    expectValidationFailure(topLevel, 'keys must be snake_case');

    const nested = cloneCurrentIndex();
    (nested.templates[0] as unknown as Record<string, unknown>).pathTemplate = nested.templates[0].template;
    expectValidationFailure(nested, 'unknown template field "pathTemplate"');
    expectValidationFailure(nested, 'keys must be snake_case');
  });

  it('rejects runtime result, verdict, digest, and cache-decision fields anywhere in the index', () => {
    for (const field of FORBIDDEN_TEMPLATE_RUNTIME_FIELDS) {
      const index = cloneCurrentIndex();
      (index.templates[0] as unknown as Record<string, unknown>)[field] = 'runtime-value';

      expectValidationFailure(index, `forbidden runtime field "${field}"`);
    }
  });

  it('allows secret names in upstream job metadata but rejects secret-looking values in the index', () => {
    expect(validateCurrentArtifactTemplateIndex().ok).toBe(true);

    for (const value of SECRET_LOOKING_VALUES) {
      const index = cloneCurrentIndex();
      (index.templates[0].producer as unknown as Record<string, unknown>).npm_script = value;

      expectValidationFailure(index, 'secret-looking value');
    }
  });

  it('does not serialize runtime state tokens in the declared template index', () => {
    const serialized = JSON.stringify(buildCurrentArtifactTemplateIndex());

    for (const field of FORBIDDEN_TEMPLATE_RUNTIME_FIELDS) {
      expect(serialized, `artifact template index must not contain forbidden token ${field}`).not.toContain(field);
    }
  });

  it('does not import artifact inspection, digest, or filesystem APIs in the schema source', () => {
    const source = readFileSync('scripts/governance/current-artifact-index-schema.ts', 'utf8');

    expect(source).not.toMatch(/\b(?:existsSync|readdirSync|statSync|createHash|sha256)\b/);
    expect(source).not.toMatch(/from ['"]node:(?:fs|crypto)['"]/);
  });

  it('keeps release verdict producers independent from the artifact template index', () => {
    for (const sourcePath of [
      'scripts/governance/run-release-aggregate.ts',
      'scripts/governance/release-summary.ts',
      'scripts/governance/run-release-full-aggregate.ts',
      'scripts/governance/release-ready.ts',
      'scripts/governance/release-status.ts',
      'scripts/governance/run-current-verification-campaign.ts',
    ]) {
      const source = readFileSync(sourcePath, 'utf8');

      expect(source).not.toMatch(/current-artifact-index-schema|CurrentArtifactTemplate/);
    }
  });
});
