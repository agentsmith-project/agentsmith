import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findCurrentGateDefinitionById } from '../current-gate-manifest';
import {
  findCurrentJobMetadataById,
  listCurrentJobMetadata,
  CURRENT_JOB_METADATA_MANIFEST,
  CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  CURRENT_JOB_METADATA_MANIFEST_VERSION,
  validateCurrentJobMetadataManifest,
} from '../current-job-metadata-manifest';
import {
  CURRENT_PURE_CHECK_IDENTITY_MANIFEST,
  CURRENT_PURE_CHECK_IDS,
  listCurrentPureCheckIdentities,
  listCurrentPureCheckInputDigestRules,
  validateCurrentPureCheckIdentityManifest,
} from '../current-pure-check-identity-manifest';
import { listCurrentResourceLocks } from '../current-resource-lock-manifest';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignStep,
} from '../current-verification-campaign-manifest';

const GENERIC_JOB_IDS = ['', 'job', 'jobs', 'gate', 'campaign', 'step', 'test', 'release'];
const FORBIDDEN_RUNTIME_FIELDS = [
  'status',
  'exit_code',
  'failure_class',
  'started_at',
  'pid',
  'retry_count',
  'cache_hit',
  'claim_reuse',
  'verdict',
  'passed',
  'failed',
  'reusable',
  'claim_id',
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
const STANDALONE_JOB_IDS = [
  'standalone-gate-fast',
  'standalone-gate-default',
  'standalone-lane-visual',
  'standalone-lane-backend-real-core',
] as const;

function releaseFullCampaign() {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign.');
  }
  return campaign;
}

function cloneCurrentManifest(): Record<string, unknown> & { jobs: Record<string, unknown>[] } {
  return structuredClone(CURRENT_JOB_METADATA_MANIFEST) as Record<string, unknown> & {
    jobs: Record<string, unknown>[];
  };
}

function clonePureCheckManifest(): Record<string, unknown> & { checks: Record<string, unknown>[] } {
  return structuredClone(CURRENT_PURE_CHECK_IDENTITY_MANIFEST) as Record<string, unknown> & {
    checks: Record<string, unknown>[];
  };
}

function jobOutputs(job: Record<string, unknown>): Record<string, unknown> {
  if (!job.outputs || typeof job.outputs !== 'object' || Array.isArray(job.outputs)) {
    throw new Error(`Job ${String(job.id)} has invalid outputs.`);
  }
  return job.outputs as Record<string, unknown>;
}

function jobInputs(job: Record<string, unknown>): Record<string, unknown> {
  if (!job.inputs || typeof job.inputs !== 'object' || Array.isArray(job.inputs)) {
    throw new Error(`Job ${String(job.id)} has invalid inputs.`);
  }
  return job.inputs as Record<string, unknown>;
}

function clonedJob(manifest: { jobs: Record<string, unknown>[] }, id: string): Record<string, unknown> {
  const job = manifest.jobs.find((candidate) => candidate.id === id);
  if (!job) {
    throw new Error(`Missing cloned job: ${id}`);
  }
  return job;
}

function expectValidationFailure(manifest: unknown, expectedReason: string): void {
  const result = validateCurrentJobMetadataManifest(manifest);

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

function expectPureCheckValidationFailure(manifest: unknown, expectedReason: string): void {
  const result = validateCurrentPureCheckIdentityManifest(manifest);

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

function campaignResultPathTemplate(step: CurrentVerificationCampaignStep): string {
  return `<campaign-root>/${step.id}/result.json`;
}

function expectedArtifactPathTemplates(step: CurrentVerificationCampaignStep): readonly string[] {
  return [
    ...new Set([
      ...step.evidenceHints,
      ...(step.nativeResult ? [step.nativeResult.path] : []),
    ]),
  ];
}

describe('current job metadata manifest', () => {
  it('defines a pure schema/manifest projection for release-full campaign jobs and standalone plan jobs', () => {
    const releaseFull = releaseFullCampaign();
    const expectedJobIds = [
      ...releaseFull.steps.map((step) => step.id),
      ...STANDALONE_JOB_IDS,
    ];

    expect(CURRENT_JOB_METADATA_MANIFEST_SCHEMA).toBe('current-job-metadata-manifest.v1');
    expect(CURRENT_JOB_METADATA_MANIFEST_VERSION).toBe(1);
    expect(CURRENT_JOB_METADATA_MANIFEST).toMatchObject({
      schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
      version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
    });
    expect(listCurrentJobMetadata()).toBe(CURRENT_JOB_METADATA_MANIFEST.jobs);
    expect(listCurrentJobMetadata().map((job) => job.id)).toEqual(expectedJobIds);
    expect(validateCurrentJobMetadataManifest()).toEqual({
      ok: true,
      value: CURRENT_JOB_METADATA_MANIFEST,
    });
  });

  it('keeps ids unique, stable kebab-case, and non-generic', () => {
    const jobs = listCurrentJobMetadata();
    const ids = jobs.map((job) => job.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(GENERIC_JOB_IDS).not.toContain(id);
    }

    const manifest = cloneCurrentManifest();
    manifest.jobs = [
      ...manifest.jobs,
      {
        ...manifest.jobs[0],
        id: 'job',
      },
    ];

    expectValidationFailure(manifest, 'non-generic kebab-case');
  });

  it('fails closed for unknown top-level and nested fields, including camelCase drift', () => {
    const topLevel = cloneCurrentManifest();
    topLevel.generatedAt = '2026-04-25T00:00:00.000Z';
    expectValidationFailure(topLevel, 'unknown top-level field "generatedAt"');

    const jobField = cloneCurrentManifest();
    jobField.jobs[0].gateId = jobField.jobs[0].gate_id;
    expectValidationFailure(jobField, 'unknown job field "gateId"');

    const outputField = cloneCurrentManifest();
    jobOutputs(outputField.jobs[0]).resultRequired = true;
    expectValidationFailure(outputField, 'unknown outputs field "resultRequired"');

    const inputField = cloneCurrentManifest();
    jobInputs(inputField.jobs[0]).requiredSecrets = [];
    expectValidationFailure(inputField, 'unknown inputs field "requiredSecrets"');

    const legacyArtifactField = cloneCurrentManifest();
    jobOutputs(legacyArtifactField.jobs[0]).artifact_path_templates = [];
    expectValidationFailure(legacyArtifactField, 'unknown outputs field "artifact_path_templates"');
  });

  it('binds every job to an existing gate and the gate manifest npm script', () => {
    for (const job of listCurrentJobMetadata()) {
      const gate = findCurrentGateDefinitionById(job.gate_id);

      expect(gate).toBeDefined();
      expect(job.npm_script).toBe(gate?.npmScript);
    }

    const unknownGate = cloneCurrentManifest();
    unknownGate.jobs[0].gate_id = 'missing-gate';
    expectValidationFailure(unknownGate, 'unknown gate_id');

    const mismatchedScript = cloneCurrentManifest();
    mismatchedScript.jobs[0].npm_script = 'test:e2e';
    expectValidationFailure(mismatchedScript, 'npm_script must match current gate manifest');
  });

  it('declares stable pure check identities owned by current gate and job metadata', () => {
    const jobsById = new Map(listCurrentJobMetadata().map((job) => [job.id, job]));
    const digestRuleIds = new Set(listCurrentPureCheckInputDigestRules().map((rule) => rule.id));
    const checks = listCurrentPureCheckIdentities();

    expect(CURRENT_PURE_CHECK_IDS).toEqual([
      'contracts',
      'openapi-contract',
      'openapi-generated',
      'lint',
      'typecheck',
      'unit',
    ]);
    expect(checks.map((check) => check.check_id)).toEqual(CURRENT_PURE_CHECK_IDS);
    expect(validateCurrentPureCheckIdentityManifest()).toEqual({
      ok: true,
      value: CURRENT_PURE_CHECK_IDENTITY_MANIFEST,
    });

    const checkIds = checks.map((check) => check.check_id);
    expect(new Set(checkIds).size).toBe(checkIds.length);

    for (const check of checks) {
      const gate = findCurrentGateDefinitionById(check.owning_gate_id);
      const job = jobsById.get(check.owning_job_id);

      expect(check.check_id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(check.check_id.trim()).toBe(check.check_id);
      expect(gate, `${check.check_id} owning gate exists`).toBeDefined();
      expect(job, `${check.check_id} owning job exists`).toBeDefined();
      expect(job?.gate_id, `${check.check_id} owner job maps to owning gate`).toBe(check.owning_gate_id);
      expect(check.path_globs.length, `${check.check_id} path_globs`).toBeGreaterThan(0);
      expect(check.path_globs).not.toEqual(expect.arrayContaining(['**/*', '**', '*', '.', './']));
      expect(['shadow', 'disabled']).toContain(check.cache_policy);
      expect(digestRuleIds.has(check.input_digest_rule_id)).toBe(true);
    }

    const source = readFileSync('scripts/governance/current-pure-check-identity-manifest.ts', 'utf8');
    expect(source).not.toMatch(/from 'node:fs'|existsSync|readdirSync|statSync|readFileSync|createHash|sha256/);
  });

  it('fails closed when pure check identity prerequisites are missing or unsafe', () => {
    const emptyId = clonePureCheckManifest();
    emptyId.checks[0] = {
      ...emptyId.checks[0],
      check_id: '',
    };
    expectPureCheckValidationFailure(emptyId, 'non-empty stable kebab-case');

    const duplicateId = clonePureCheckManifest();
    duplicateId.checks[1] = {
      ...duplicateId.checks[1],
      check_id: duplicateId.checks[0].check_id,
    };
    expectPureCheckValidationFailure(duplicateId, 'duplicate check_id');

    const missingGate = clonePureCheckManifest();
    missingGate.checks[0] = {
      ...missingGate.checks[0],
      owning_gate_id: 'missing-gate',
    };
    expectPureCheckValidationFailure(missingGate, 'unknown owning_gate_id');

    const missingJob = clonePureCheckManifest();
    missingJob.checks[0] = {
      ...missingJob.checks[0],
      owning_job_id: 'missing-job',
    };
    expectPureCheckValidationFailure(missingJob, 'unknown owning_job_id');

    const emptyGlobs = clonePureCheckManifest();
    emptyGlobs.checks[0] = {
      ...emptyGlobs.checks[0],
      path_globs: [],
    };
    expectPureCheckValidationFailure(emptyGlobs, 'path_globs must be non-empty');

    const fullRepoGlob = clonePureCheckManifest();
    fullRepoGlob.checks[0] = {
      ...fullRepoGlob.checks[0],
      path_globs: ['**/*'],
    };
    expectPureCheckValidationFailure(fullRepoGlob, 'must not generalize to the full repo');

    const enabledReuse = clonePureCheckManifest();
    enabledReuse.checks[0] = {
      ...enabledReuse.checks[0],
      cache_policy: 'enabled' as never,
    };
    expectPureCheckValidationFailure(enabledReuse, 'cache_policy must be shadow or disabled');

    const missingDigestRule = clonePureCheckManifest();
    missingDigestRule.checks[0] = {
      ...missingDigestRule.checks[0],
      input_digest_rule_id: 'missing-rule',
    };
    expectPureCheckValidationFailure(missingDigestRule, 'unknown input_digest_rule_id');
  });

  it('mirrors release-full steps exactly without executing or acquiring anything', () => {
    const releaseFull = releaseFullCampaign();
    const campaignJobs = listCurrentJobMetadata().filter((job) => job.kind === 'campaign_step');

    expect(campaignJobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      campaign_id: job.campaign_id,
      step_id: job.step_id,
      gate_id: job.gate_id,
      npm_script: job.npm_script,
      command: job.command,
      execution_mode: job.execution_mode,
      line_kind: job.line_kind,
      depends_on: job.depends_on,
      result_required: job.outputs.result_required,
      evidence_required: job.outputs.evidence_required,
    }))).toEqual(releaseFull.steps.map((step) => ({
      id: step.id,
      kind: 'campaign_step',
      campaign_id: releaseFull.id,
      step_id: step.id,
      gate_id: step.gateId,
      npm_script: step.npmScript,
      command: step.command,
      execution_mode: step.executionMode,
      line_kind: step.lineKind,
      depends_on: step.dependsOn,
      result_required: step.resultRequired,
      evidence_required: step.evidenceRequired,
    })));

    const driftedDependsOn = cloneCurrentManifest();
    driftedDependsOn.jobs[1].depends_on = [];
    expectValidationFailure(driftedDependsOn, 'must mirror release-full step gate-default');

    const extraStandalone = cloneCurrentManifest();
    extraStandalone.jobs = [
      ...extraStandalone.jobs,
      {
        ...extraStandalone.jobs[0],
        id: 'extra-standalone-gate',
        kind: 'standalone_gate',
      },
    ];
    expectValidationFailure(extraStandalone, 'standalone jobs must mirror current standalone goal jobs');

    const extraCampaign = cloneCurrentManifest();
    extraCampaign.jobs = [
      ...extraCampaign.jobs,
      {
        ...extraCampaign.jobs[0],
        id: 'other-campaign-step',
        campaign_id: 'other-campaign',
        step_id: 'other-campaign-step',
      },
    ];
    expectValidationFailure(extraCampaign, 'release-full campaign jobs must mirror current release-full steps');
  });

  it('keeps standalone job ids distinct from release campaign steps and bound to stable gate truth', () => {
    const standaloneJobs = listCurrentJobMetadata().filter((job) => job.kind === 'standalone_gate');

    expect(standaloneJobs.map((job) => job.id)).toEqual(STANDALONE_JOB_IDS);
    expect(standaloneJobs.map((job) => ({
      id: job.id,
      gate_id: job.gate_id,
      npm_script: job.npm_script,
      campaign_id: job.campaign_id,
      step_id: job.step_id,
      execution_mode: job.execution_mode,
      depends_on: job.depends_on,
      cache: job.cache,
    }))).toEqual([
      {
        id: 'standalone-gate-fast',
        gate_id: 'gate-fast',
        npm_script: 'gate:fast',
        campaign_id: undefined,
        step_id: undefined,
        execution_mode: 'execute',
        depends_on: [],
        cache: 'disabled',
      },
      {
        id: 'standalone-gate-default',
        gate_id: 'gate-default',
        npm_script: 'gate:default',
        campaign_id: undefined,
        step_id: undefined,
        execution_mode: 'execute',
        depends_on: ['standalone-gate-fast'],
        cache: 'disabled',
      },
      {
        id: 'standalone-lane-visual',
        gate_id: 'lane-visual',
        npm_script: 'lane:visual',
        campaign_id: undefined,
        step_id: undefined,
        execution_mode: 'execute',
        depends_on: ['standalone-gate-fast'],
        cache: 'disabled',
      },
      {
        id: 'standalone-lane-backend-real-core',
        gate_id: 'lane-backend-real-core',
        npm_script: 'lane:backend-real:core',
        campaign_id: undefined,
        step_id: undefined,
        execution_mode: 'execute',
        depends_on: ['standalone-gate-default'],
        cache: 'disabled',
      },
    ]);

    for (const job of standaloneJobs) {
      const gate = findCurrentGateDefinitionById(job.gate_id);

      expect(gate).toBeDefined();
      expect(job.npm_script).toBe(gate?.npmScript);
      expect(job.outputs.result_path_template).toBe(`<governance-run-report-root>/${job.id}/result.json`);
      expect(job.outputs.expected_artifact_path_templates).toEqual(gate?.standaloneEvidenceArtifacts ?? []);
      expect(job.locks).not.toContain('release-campaign-root-writes');
    }

    const standaloneCampaignId = cloneCurrentManifest();
    clonedJob(standaloneCampaignId, 'standalone-gate-fast').campaign_id = 'release-full';
    expectValidationFailure(standaloneCampaignId, 'standalone jobs must not declare campaign_id or step_id');
  });

  it('derives standalone locks from gate execution target npm scripts, not only the wrapper script', () => {
    const backendRealCore = findCurrentJobMetadataById('standalone-lane-backend-real-core');
    const backendRealGate = findCurrentGateDefinitionById('lane-backend-real-core');
    const fixedLocalPorts = listCurrentResourceLocks().find((lock) => lock.id === 'fixed-local-ports');

    expect(backendRealGate?.npmScript).toBe('lane:backend-real:core');
    expect(backendRealGate?.executionTargets).toContainEqual({
      kind: 'npm_script',
      npmScript: 'backend-real:run',
    });
    expect(fixedLocalPorts?.appliesTo.gateIds).not.toContain('lane-backend-real-core');
    expect(fixedLocalPorts?.appliesTo.npmScripts).not.toContain('lane:backend-real:core');
    expect(fixedLocalPorts?.appliesTo.npmScripts).toContain('backend-real:run');
    expect(backendRealCore?.locks).toEqual(expect.arrayContaining([
      'shared-local-substrate',
      'fixed-local-ports',
      'backend-real-provider-quota',
    ]));
  });

  it('references resource lock ids only and keeps them in the current lock manifest', () => {
    const lockIds = new Set(listCurrentResourceLocks().map((lock) => lock.id));

    for (const job of listCurrentJobMetadata()) {
      expect(new Set(job.locks).size).toBe(job.locks.length);
      for (const lockId of job.locks) {
        expect(lockIds.has(lockId)).toBe(true);
      }
    }

    const unknownLock = cloneCurrentManifest();
    unknownLock.jobs[0].locks = ['not-a-current-lock'];
    expectValidationFailure(unknownLock, 'unknown resource lock id');
  });

  it('derives output path templates from campaign step and gate evidence truth only', () => {
    const releaseFull = releaseFullCampaign();

    for (const step of releaseFull.steps) {
      const job = findCurrentJobMetadataById(step.id);
      const gate = findCurrentGateDefinitionById(step.gateId);

      expect(job).toBeDefined();
      expect(job?.outputs.result_path_template).toBe(campaignResultPathTemplate(step));
      expect(job?.outputs.expected_artifact_path_templates).toEqual(expectedArtifactPathTemplates(step));
      expect(job?.outputs.expected_artifact_path_templates).toEqual(
        expect.arrayContaining(gate?.campaignEvidenceArtifacts ?? []),
      );
    }

    const source = readFileSync('scripts/governance/current-job-metadata-manifest.ts', 'utf8');
    expect(source).not.toMatch(/from 'node:fs'|existsSync|readdirSync|statSync|readFileSync|createHash|sha256/);

    const driftedArtifact = cloneCurrentManifest();
    jobOutputs(driftedArtifact.jobs[2]).expected_artifact_path_templates = ['artifacts/runtime/not-campaign-truth.json'];
    expectValidationFailure(
      driftedArtifact,
      'expected_artifact_path_templates must mirror release-full step lane-visual',
    );
  });

  it('mirrors derived locks, inputs, timeouts, retry, and cache from release-full step metadata', () => {
    const gateRelease = findCurrentJobMetadataById('gate-release');
    const gateReleaseStep = releaseFullCampaign().steps.find((step) => step.id === 'gate-release');

    expect(gateRelease?.locks).toEqual(
      expect.arrayContaining([
        'release-campaign-root-writes',
        'backend-real-provider-quota',
        'provider-secret-profile',
      ]),
    );
    expect(gateRelease?.inputs.required_secret_names).toEqual(['PRESET_ENDPOINT_API_KEY']);
    expect(gateRelease?.timeouts.source).toBe('p2_metadata_schema_static_envelope');
    expect(gateReleaseStep).toBeDefined();
    expect(gateRelease?.timeouts.ci_seconds).toBe((gateReleaseStep?.timeoutMs ?? 0) / 1000);
    expect(gateRelease?.retry).toBe('manual_only');
    expect(gateRelease?.cache).toBe('release_campaign_only');

    const missingLock = cloneCurrentManifest();
    const gateReleaseWithoutLock = clonedJob(missingLock, 'gate-release');
    gateReleaseWithoutLock.locks = (gateReleaseWithoutLock.locks as string[]).filter(
      (lockId) => lockId !== 'backend-real-provider-quota',
    );
    expectValidationFailure(missingLock, 'locks must mirror release-full step gate-release');

    const removedSecretName = cloneCurrentManifest();
    jobInputs(clonedJob(removedSecretName, 'gate-release')).required_secret_names = [];
    expectValidationFailure(removedSecretName, 'inputs must mirror release-full step gate-release');

    const timeoutSourceDrift = cloneCurrentManifest();
    const gateFastTimeouts = clonedJob(timeoutSourceDrift, 'gate-fast').timeouts as Record<string, unknown>;
    gateFastTimeouts.source = 'runtime_observed_timeout';
    expectValidationFailure(timeoutSourceDrift, 'timeouts must mirror release-full step gate-fast');

    const retryDrift = cloneCurrentManifest();
    clonedJob(retryDrift, 'gate-fast').retry = 'none';
    expectValidationFailure(retryDrift, 'retry must mirror release-full step gate-fast');

    const cacheDrift = cloneCurrentManifest();
    clonedJob(cacheDrift, 'gate-fast').cache = 'disabled';
    expectValidationFailure(cacheDrift, 'cache must mirror release-full step gate-fast');
  });

  it('keeps backend-real, release, and unified deploy jobs out of automatic retry and unsafe cache reuse', () => {
    for (const job of listCurrentJobMetadata()) {
      expect(['none', 'manual_only']).toContain(job.retry);
      expect(['disabled', 'release_campaign_only']).toContain(job.cache);
    }

    const automaticRetry = cloneCurrentManifest();
    automaticRetry.jobs[3].retry = 'safe_transient_only';
    expectValidationFailure(automaticRetry, 'must not enable automatic retry');

    const unsafeCache = cloneCurrentManifest();
    unsafeCache.jobs[3].cache = 'same_commit_same_env';
    expectValidationFailure(unsafeCache, 'must not reuse cache across release or provider profiles');
  });

  it('rejects runtime result, verdict, and cache decision fields', () => {
    for (const field of FORBIDDEN_RUNTIME_FIELDS) {
      const manifest = cloneCurrentManifest();
      manifest.jobs[0][field] = field === 'exit_code' ? 0 : 'runtime-value';

      expectValidationFailure(manifest, `forbidden runtime field "${field}"`);
    }
  });

  it('allows secret names but rejects secret-looking values anywhere in the manifest', () => {
    const releaseGate = findCurrentJobMetadataById('gate-release');
    expect(releaseGate?.inputs.required_secret_names).toContain('PRESET_ENDPOINT_API_KEY');
    expect(validateCurrentJobMetadataManifest().ok).toBe(true);

    for (const value of SECRET_LOOKING_VALUES) {
      const manifest = cloneCurrentManifest();
      jobInputs(manifest.jobs[3]).required_secret_names = [value];

      expectValidationFailure(manifest, 'secret-looking value');
    }
  });

  it('supports list and find without throwing on validation failures', () => {
    const jobs = listCurrentJobMetadata();

    expect(findCurrentJobMetadataById(jobs[0].id)).toBe(jobs[0]);
    expect(findCurrentJobMetadataById('missing-job')).toBeUndefined();
    expect(() => validateCurrentJobMetadataManifest({ jobs: 'not-an-array' })).not.toThrow();
    expect(validateCurrentJobMetadataManifest({ jobs: 'not-an-array' }).ok).toBe(false);
  });
});
