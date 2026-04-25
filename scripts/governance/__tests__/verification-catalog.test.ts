import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCommittedStoryDefinitionsSync } from '../../story-catalog-support';
import {
  CURRENT_EVIDENCE_CLAIM_SCHEMA,
  CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  CURRENT_EVIDENCE_CLAIM_SCOPES,
  CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS,
  CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES,
} from '../current-evidence-claim-schema';
import {
  CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  CURRENT_JOB_METADATA_MANIFEST_VERSION,
  listCurrentJobMetadata,
} from '../current-job-metadata-manifest';
import {
  CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
  CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
  listCurrentResourceLocks,
} from '../current-resource-lock-manifest';
import {
  listCurrentVerificationCampaigns,
  type CurrentVerificationCampaignDefinition,
} from '../current-verification-campaign-manifest';
import {
  CURRENT_STORY_RISK_POLICY,
  CURRENT_STORY_RISK_POLICY_SCHEMA,
  CURRENT_STORY_RISK_POLICY_SOURCE,
  validateCurrentStoryRiskPolicy,
} from '../current-story-risk-policy';
import {
  buildVerificationCatalogP2ModelProjection,
  buildVerificationCatalog,
  GENERATED_STORY_SPEC_PATH,
  VERIFICATION_CATALOG_SCHEMA,
  writeVerificationCatalog,
} from '../verification-catalog';
import { scanTraceSpecStoryMap } from '../trace-spec-story-map';

const FORBIDDEN_P2_RUNTIME_FIELD_NAMES = [
  'passed',
  'failed',
  'stale',
  'reusable',
  'cache_hit',
  'claim_id',
  'verdict',
  'result_status',
  'failure_class',
  'exists',
  'artifact_digest',
  'result_digest',
  'run_id',
  'campaign_root',
] as const;

function serializedWithoutAllowedVerdictState(value: unknown): string {
  return JSON.stringify(value).replaceAll('"verdict_state":"none"', '"allowed_state":"none"');
}

function expectNoForbiddenP2RuntimeTokens(value: unknown, label: string): void {
  const serialized = serializedWithoutAllowedVerdictState(value);

  for (const fieldName of FORBIDDEN_P2_RUNTIME_FIELD_NAMES) {
    expect(serialized, `${label} must not contain forbidden token ${fieldName}`).not.toContain(fieldName);
  }
}

describe('verification catalog', () => {
  it('validates the risk policy sidecar with exact canonical story coverage and policy refs only', () => {
    const canonicalStoryIds = loadCommittedStoryDefinitionsSync()
      .map((story) => story.storyId)
      .sort((left, right) => left.localeCompare(right));
    const policy = validateCurrentStoryRiskPolicy(CURRENT_STORY_RISK_POLICY, canonicalStoryIds);

    expect(CURRENT_STORY_RISK_POLICY_SCHEMA).toBe('agentsmith_story_risk_policy/v1');
    expect(Object.keys(policy.stories).sort((left, right) => left.localeCompare(right))).toEqual(canonicalStoryIds);
    expect(policy.schema).toBe(CURRENT_STORY_RISK_POLICY_SCHEMA);
    expect(policy.stories['unicode-filename-round-trip']?.policy_refs).toContain('file_continuity_integrity');
    for (const entry of Object.values(policy.stories)) {
      expect(Object.keys(entry)).toEqual(['policy_refs']);
      expect(entry.policy_refs.length).toBeGreaterThan(0);
    }
  });

  it('hard-fails invalid risk policy sidecar documents', () => {
    const validPolicy = {
      schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
      stories: {
        alpha: { policy_refs: ['low_risk_reference'] },
        beta: { policy_refs: ['standard_mock_workflow'] },
      },
    };
    const validate = (policy: unknown) => validateCurrentStoryRiskPolicy(policy, ['alpha', 'beta']);

    expect(() => validate({
      ...validPolicy,
      stories: {
        alpha: { policy_refs: ['low_risk_reference'] },
      },
    })).toThrow(/missing canonical story ids: beta/);
    expect(() => validate({
      ...validPolicy,
      stories: {
        ...validPolicy.stories,
        gamma: { policy_refs: ['low_risk_reference'] },
      },
    })).toThrow(/unknown story ids: gamma/);
    expect(() => validate({
      ...validPolicy,
      stories: {
        ...validPolicy.stories,
        beta: { policy_refs: [] },
      },
    })).toThrow(/beta.*policy_refs.*empty/);
    expect(() => validate({
      ...validPolicy,
      stories: {
        ...validPolicy.stories,
        beta: { policy_refs: [''] },
      },
    })).toThrow(/beta.*empty policy ref/);
    expect(() => validate({
      ...validPolicy,
      stories: {
        ...validPolicy.stories,
        beta: { policy_refs: ['unknown_ref'] },
      },
    })).toThrow(/beta.*unknown policy ref: unknown_ref/);
    expect(() => validate({
      ...validPolicy,
      stories: {
        ...validPolicy.stories,
        beta: {
          policy_refs: ['low_risk_reference'],
          title: 'copied canonical title',
        },
      },
    })).toThrow(/beta.*only contain policy_refs/);
  });

  it('declares the read-only catalog schema and authoritative provenance', () => {
    const catalog = buildVerificationCatalog({
      generatedAt: '2026-04-25T12:00:00.000Z',
    });

    expect(catalog.schema).toBe(VERIFICATION_CATALOG_SCHEMA);
    expect(catalog.provenance).toEqual({
      generated_at: '2026-04-25T12:00:00.000Z',
      projection_kind: 'read_only',
      artifact_directory_inspection: false,
      verdict_state: 'none',
      evidence_claims_created: false,
    });
    expect(catalog.source_truth.canonical_stories).toMatchObject({
      authority: 'authoritative',
      source_mode: 'default_loader',
      loader: 'loadCommittedStoryDefinitionsSync',
      path_glob: 'e2e/stories/**/*.story.md',
    });
    expect(catalog.source_truth.current_gate_manifest.gate_ids).toContain('lane-visual');
    expect(catalog.source_truth.current_verification_campaign_manifest.campaign_ids).toEqual(['release-full']);
    expect(catalog.source_truth.visual_catalog).toMatchObject({
      authority: 'derived_projection',
      source_mode: 'default_builder',
      builder: 'listVisualBaselineCatalogEntries',
      source_module: 'e2e/visual-baseline-support.ts',
    });
    expect(catalog.source_truth.gate_result_schema.writer_gate_ids).toContain('lane-backend-real-core');
    expect(catalog.source_truth.current_story_risk_policy).toMatchObject({
      authority: 'authoritative',
      module: CURRENT_STORY_RISK_POLICY_SOURCE,
      schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
      story_count: catalog.stories.length,
    });
  });

  it('registers the P2 model source truth without inspecting artifacts', () => {
    const catalog = buildVerificationCatalog();
    const lockIds = listCurrentResourceLocks().map((lock) => lock.id);
    const jobIds = listCurrentJobMetadata().map((job) => job.id);
    const campaignIds = [
      ...new Set(listCurrentJobMetadata()
        .map((job) => job.campaign_id)
        .filter((campaignId): campaignId is string => typeof campaignId === 'string')),
    ].sort((left, right) => left.localeCompare(right));

    expect(catalog.source_truth.current_evidence_claim_schema).toEqual({
      authority: 'authoritative',
      module: 'scripts/governance/current-evidence-claim-schema.ts',
      schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
      top_level_key_count: CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS.length,
      scope_count: CURRENT_EVIDENCE_CLAIM_SCOPES.length,
      validation_purpose_count: CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES.length,
      digest_format: CURRENT_EVIDENCE_CLAIM_SCHEMA.digest_format,
      claim_instances_included: false,
    });
    expect(catalog.source_truth.current_resource_lock_manifest).toEqual({
      authority: 'authoritative',
      module: 'scripts/governance/current-resource-lock-manifest.ts',
      schema: CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
      version: CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
      lock_ids: lockIds,
      lock_count: lockIds.length,
    });
    expect(catalog.source_truth.current_job_metadata_manifest).toEqual({
      authority: 'authoritative',
      module: 'scripts/governance/current-job-metadata-manifest.ts',
      schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
      version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
      job_ids: jobIds,
      job_count: jobIds.length,
      campaign_ids: campaignIds,
    });
  });

  it('projects P2 claim schema, resource locks, and job metadata as read-only model data', () => {
    const catalog = buildVerificationCatalog();
    const projection = catalog.p2_model_projection;
    const providerSecretLock = projection.resource_locks.locks.find((lock) => lock.id === 'provider-secret-profile');
    const gateReleaseJob = projection.job_metadata.jobs.find((job) => job.id === 'gate-release');

    expect(projection).toMatchObject({
      projection_kind: 'read_only',
      artifact_directory_inspection: false,
      verdict_state: 'none',
      evidence_claims_created: false,
      claim_schema: {
        schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
        top_level_key_count: CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS.length,
        scope_count: CURRENT_EVIDENCE_CLAIM_SCOPES.length,
        validation_purpose_count: CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES.length,
        digest_format: CURRENT_EVIDENCE_CLAIM_SCHEMA.digest_format,
        claim_instances_included: false,
      },
      resource_locks: {
        schema: CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
        version: CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
        lock_ids: listCurrentResourceLocks().map((lock) => lock.id),
        lock_count: listCurrentResourceLocks().length,
      },
      job_metadata: {
        schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
        version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
        job_ids: listCurrentJobMetadata().map((job) => job.id),
        job_count: listCurrentJobMetadata().length,
        campaign_id_count: 1,
      },
    });
    expect(providerSecretLock).toMatchObject({
      id: 'provider-secret-profile',
      category: 'secret_profile',
      scope: 'provider_profile',
      mode: 'exclusive',
      owner_counts: {
        gate_id_count: 2,
        npm_script_count: 4,
        command_surface_count: 2,
      },
      applies_to_counts: {
        gate_id_count: 2,
        npm_script_count: 6,
        runtime_line_count: 0,
        path_count: 0,
        port_count: 0,
        provider_profile_count: 3,
      },
      enforcement: 'modeled_only',
      profile_reuse: {
        cross_provider_profile_reuse_forbidden: true,
        cross_secret_profile_reuse_forbidden: true,
      },
    });
    expect(gateReleaseJob).toMatchObject({
      id: 'gate-release',
      kind: 'campaign_step',
      gate_id: 'gate-release',
      step_id: 'gate-release',
      npm_script: 'gate:release',
      execution_mode: 'execute',
      line_kind: 'release_backend_real',
      lock_ids: expect.arrayContaining([
        'release-campaign-root-writes',
        'backend-real-provider-quota',
        'provider-secret-profile',
      ]),
      retry: 'manual_only',
      cache: 'release_campaign_only',
      timeout_seconds: {
        local: 3600,
        ci: 5400,
      },
      input_counts: {
        path_glob_count: 0,
        env_profile_count: 2,
        required_secret_count: 1,
      },
    });
    expect(gateReleaseJob?.output_counts.expected_artifact_template_count).toBeGreaterThan(0);
    expect(Object.keys(gateReleaseJob ?? {}).sort()).toEqual([
      'cache',
      'depends_on',
      'execution_mode',
      'gate_id',
      'id',
      'input_counts',
      'kind',
      'line_kind',
      'lock_ids',
      'npm_script',
      'output_counts',
      'retry',
      'step_id',
      'timeout_seconds',
    ]);
  });

  it('keeps every projected job lock mapped to a projected resource lock id', () => {
    const catalog = buildVerificationCatalog();
    const lockIds = new Set(catalog.p2_model_projection.resource_locks.lock_ids);

    for (const job of catalog.p2_model_projection.job_metadata.jobs) {
      for (const lockId of job.lock_ids) {
        expect(lockIds.has(lockId), `${job.id} references unknown projected lock ${lockId}`).toBe(true);
      }
    }
  });

  it('fails closed when projected job locks reference unknown current resource lock ids', () => {
    const [firstJob] = listCurrentJobMetadata();
    if (!firstJob) {
      throw new Error('current job metadata fixture is required');
    }

    expect(() => buildVerificationCatalogP2ModelProjection({
      resourceLocks: listCurrentResourceLocks(),
      jobs: [{
        ...firstJob,
        locks: [...firstJob.locks, 'unknown-resource-lock'],
      }],
    })).toThrow(/unknown current resource lock id: unknown-resource-lock/);
  });

  it('does not serialize runtime verdict, cache decision, or evidence instance tokens in P2 catalog fields', () => {
    const catalog = buildVerificationCatalog();

    expect(JSON.stringify(catalog.p2_model_projection)).toContain('"verdict_state":"none"');
    expectNoForbiddenP2RuntimeTokens(
      catalog.source_truth.current_evidence_claim_schema,
      'source_truth.current_evidence_claim_schema',
    );
    expectNoForbiddenP2RuntimeTokens(catalog.p2_model_projection, 'p2_model_projection');
  });

  it('does not introduce artifact inspection APIs in the verification catalog source', () => {
    const source = readFileSync('scripts/governance/verification-catalog.ts', 'utf8');

    expect(source).not.toMatch(/\b(?:existsSync|readdirSync|statSync|createHash|sha256)\b/);
    expect(source).not.toMatch(/from ['"]node:crypto['"]/);
  });

  it('marks custom story and visual inputs as non-default input overrides', () => {
    const [story] = loadCommittedStoryDefinitionsSync();
    const catalog = buildVerificationCatalog({
      stories: [story],
      visualCatalogEntries: [],
    });

    expect(catalog.source_truth.canonical_stories).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      loader: null,
      path_glob: null,
      story_count: 1,
    });
    expect(catalog.source_truth.visual_catalog).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      builder: null,
      source_spec: null,
      source_module: null,
      entry_count: 0,
    });
    expect(catalog.source_truth.generated_story_specs.source_builder).toContain('input story override');
  });

  it('marks risk policy input overrides as non-authoritative story policy sources', () => {
    const [story] = loadCommittedStoryDefinitionsSync();
    const catalog = buildVerificationCatalog({
      stories: [story],
      visualCatalogEntries: [],
      storyRiskPolicy: {
        schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
        stories: {
          [story.storyId]: {
            policy_refs: ['low_risk_reference'],
          },
        },
      },
    });

    expect(catalog.source_truth.current_story_risk_policy).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      module: null,
    });
    expect(catalog.story_by_id[story.storyId]?.riskPolicySource).toBe('input_override_non_authoritative');
  });

  it('hard-fails present but invalid risk policy input overrides instead of falling back to defaults', () => {
    const [story] = loadCommittedStoryDefinitionsSync();
    const baseInput = {
      stories: [story],
      visualCatalogEntries: [],
    };

    expect(() => buildVerificationCatalog({
      ...baseInput,
      storyRiskPolicy: null,
    })).toThrow(/current story risk policy must be an object/);
    expect(() => buildVerificationCatalog({
      ...baseInput,
      storyRiskPolicy: false,
    })).toThrow(/current story risk policy must be an object/);
    expect(() => buildVerificationCatalog({
      ...baseInput,
      storyRiskPolicy: '',
    })).toThrow(/current story risk policy must be an object/);
  });

  it('marks generated story specs as derived cache and never uses them as story truth', () => {
    const catalog = buildVerificationCatalog();

    expect(catalog.source_truth.generated_story_specs).toMatchObject({
      authority: 'derived_cache',
      authoritative: false,
      path: GENERATED_STORY_SPEC_PATH,
      used_as_story_truth: false,
    });
    expect(catalog.generated_story_specs).toMatchObject({
      authority: 'derived_cache_only',
      authoritative: false,
      used_as_story_truth: false,
      path: GENERATED_STORY_SPEC_PATH,
    });
    expect(catalog.story_source_file_map[GENERATED_STORY_SPEC_PATH]).toBeUndefined();
    expect(catalog.stories.every((story) => story.sourceFile !== GENERATED_STORY_SPEC_PATH)).toBe(true);
    expect(catalog.generated_story_specs.story_ids.length).toBe(catalog.stories.length);
  });

  it('projects trace spec story bindings without using them as canonical story truth', () => {
    const catalog = buildVerificationCatalog();
    const entriesBySpec = new Map<string, string[]>();
    for (const entry of catalog.trace_spec_story_map.entries) {
      entriesBySpec.set(entry.specFile, [
        ...(entriesBySpec.get(entry.specFile) ?? []),
        entry.storyId,
      ].sort((left, right) => left.localeCompare(right)));
      expect(Object.keys(entry).sort()).toEqual([
        'sourceTruth',
        'specFile',
        'storyId',
        'storySourceFile',
      ]);
      expect(entry.sourceTruth).toMatchObject({
        kind: 'trace_spec_story_binding',
        usedAsStoryTruth: false,
      });
      expect(catalog.story_by_id[entry.storyId]?.sourceFile).toBe(entry.storySourceFile);
    }

    expect(catalog.source_truth.trace_spec_story_bindings).toMatchObject({
      authority: 'derived_projection',
      used_as_story_truth: false,
      scanner: 'scripts/governance/trace-spec-story-map.ts',
      source_glob: 'e2e/integration*.spec.ts',
      binding_contract: 'createUxTraceBundleWriter({ specFile, storyId, storyBinding })',
      unresolved_count: 0,
    });
    expect(catalog.source_truth.trace_spec_story_bindings.spec_count).toBeGreaterThan(0);
    expect(catalog.source_truth.trace_spec_story_bindings.binding_count).toBe(catalog.trace_spec_story_map.entries.length);
    expect(entriesBySpec.get('e2e/integration-chat.spec.ts')).toEqual([
      'chat-day-two-thread-workflow',
      'chat-stop-terminate-idempotent-state-resync',
    ]);
    expect(entriesBySpec.get('e2e/integration-notebook-terminal-ux.spec.ts')).toEqual([
      'notebook-terminal-reentry-recovery',
      'notebook-terminal-truth-unavailable-retry',
      'notebook-terminal-workspace-multi-session',
    ]);
    expect(entriesBySpec.get('e2e/integration-visual-review.spec.ts')).toEqual(expect.arrayContaining([
      'project-surface-handoff-continuity',
      'real-backend-visual-review',
    ]));
    expect(entriesBySpec.get('e2e/integration-release-user-story.spec.ts')).toEqual([
      'release-user-story-end-to-end',
    ]);
  });

  it('disables default trace spec scanning for story input override fixtures', () => {
    const [story] = loadCommittedStoryDefinitionsSync();
    const catalog = buildVerificationCatalog({
      stories: [story],
      visualCatalogEntries: [],
    });

    expect(catalog.source_truth.trace_spec_story_bindings).toMatchObject({
      source_mode: 'disabled_for_story_input_override',
      used_as_story_truth: false,
      spec_count: 0,
      binding_count: 0,
      unresolved_count: 0,
    });
    expect(catalog.trace_spec_story_map.entries).toEqual([]);
  });

  it('hard-fails trace spec bindings that point at unknown canonical stories', () => {
    const [story] = loadCommittedStoryDefinitionsSync();

    expect(() => scanTraceSpecStoryMap({
      stories: [story],
      sourceTexts: [{
        filePath: 'e2e/integration-synthetic-unknown.spec.ts',
        text: `
          import { loadStoryDefinitionSync } from './story-loader';
          import { buildTraceStoryBinding } from './story-trace-binding';
          import { createUxTraceBundleWriter } from './trace-bundle-support';
          const STORY = loadStoryDefinitionSync('unknown-story-id');
          const BINDING = buildTraceStoryBinding(STORY);
          async function run() {
            await createUxTraceBundleWriter({
              specFile: 'e2e/integration-synthetic-unknown.spec.ts',
              storyId: STORY.storyId,
              storyBinding: BINDING,
            });
          }
        `,
      }],
    })).toThrow(/unknown trace spec story id: unknown-story-id/);
  });

  it('hard-fails unresolved trace spec writer metadata with source file, line, and reason', () => {
    const [story] = loadCommittedStoryDefinitionsSync();

    expect(() => scanTraceSpecStoryMap({
      stories: [story],
      sourceTexts: [{
        filePath: 'e2e/integration-synthetic-unresolved.spec.ts',
        text: `
          import { loadStoryDefinitionSync } from './story-loader';
          import { createUxTraceBundleWriter } from './trace-bundle-support';
          const STORY = loadStoryDefinitionSync('${story.storyId}');
          async function run() {
            await createUxTraceBundleWriter({
              storyId: STORY.storyId,
            });
          }
        `,
      }],
    })).toThrow(
      /unresolved trace spec story binding\(s\) found:\n- e2e\/integration-synthetic-unresolved\.spec\.ts:\d+: specFile metadata could not be resolved; storyBinding metadata could not be resolved/,
    );
  });

  it('hard-fails partial trace spec scans when any writer binding is unresolved', () => {
    const [story] = loadCommittedStoryDefinitionsSync();

    expect(() => scanTraceSpecStoryMap({
      stories: [story],
      sourceTexts: [{
        filePath: 'e2e/integration-synthetic-partial.spec.ts',
        text: `
          import { loadStoryDefinitionSync } from './story-loader';
          import { buildTraceStoryBinding } from './story-trace-binding';
          import { createUxTraceBundleWriter } from './trace-bundle-support';
          const STORY = loadStoryDefinitionSync('${story.storyId}');
          const BINDING = buildTraceStoryBinding(STORY);
          async function run() {
            await createUxTraceBundleWriter({
              specFile: 'e2e/integration-synthetic-partial.spec.ts',
              storyId: STORY.storyId,
              storyBinding: BINDING,
            });
            await createUxTraceBundleWriter({
              specFile: 'e2e/integration-synthetic-partial.spec.ts',
              storyId: STORY.storyId,
            });
          }
        `,
      }],
    })).toThrow(
      /unresolved trace spec story binding\(s\) found:\n- e2e\/integration-synthetic-partial\.spec\.ts:\d+: storyBinding metadata could not be resolved/,
    );
  });

  it('hard-fails trace spec writer specFile metadata that does not match the scanned source file', () => {
    const [story] = loadCommittedStoryDefinitionsSync();

    expect(() => scanTraceSpecStoryMap({
      stories: [story],
      sourceTexts: [{
        filePath: 'e2e/integration-synthetic-actual.spec.ts',
        text: `
          import { loadStoryDefinitionSync } from './story-loader';
          import { buildTraceStoryBinding } from './story-trace-binding';
          import { createUxTraceBundleWriter } from './trace-bundle-support';
          const STORY = loadStoryDefinitionSync('${story.storyId}');
          const BINDING = buildTraceStoryBinding(STORY);
          async function run() {
            await createUxTraceBundleWriter({
              specFile: 'e2e/integration-synthetic-declared.spec.ts',
              storyId: STORY.storyId,
              storyBinding: BINDING,
            });
          }
        `,
      }],
    })).toThrow(
      /trace spec specFile metadata mismatch in current source file e2e\/integration-synthetic-actual\.spec\.ts:\d+: declared specFile=e2e\/integration-synthetic-declared\.spec\.ts, actual source file=e2e\/integration-synthetic-actual\.spec\.ts/,
    );
  });

  it('hard-fails trace spec storyId and storyBinding mismatches', () => {
    const stories = loadCommittedStoryDefinitionsSync();
    const leftStory = stories[0];
    const rightStory = stories.find((candidate) => candidate.storyId !== leftStory?.storyId);
    if (!leftStory || !rightStory) {
      throw new Error('at least two canonical story fixtures are required');
    }

    expect(() => scanTraceSpecStoryMap({
      stories,
      sourceTexts: [{
        filePath: 'e2e/integration-synthetic-mismatch.spec.ts',
        text: `
          import { loadStoryDefinitionSync } from './story-loader';
          import { buildTraceStoryBinding } from './story-trace-binding';
          import { createUxTraceBundleWriter } from './trace-bundle-support';
          const LEFT_STORY = loadStoryDefinitionSync('${leftStory.storyId}');
          const RIGHT_STORY = loadStoryDefinitionSync('${rightStory.storyId}');
          const RIGHT_BINDING = buildTraceStoryBinding(RIGHT_STORY);
          async function run() {
            await createUxTraceBundleWriter({
              specFile: 'e2e/integration-synthetic-mismatch.spec.ts',
              storyId: LEFT_STORY.storyId,
              storyBinding: RIGHT_BINDING,
            });
          }
        `,
      }],
    })).toThrow(
      new RegExp(
        `trace spec story binding mismatch in e2e/integration-synthetic-mismatch.spec.ts:\\d+: `
        + `LEFT_STORY.storyId resolved to ${leftStory.storyId}, RIGHT_BINDING resolved to ${rightStory.storyId}`,
      ),
    );
  });

  it('maps ChatMainPane visual code refs to V2 visual story surfaces', () => {
    const catalog = buildVerificationCatalog();
    const mappings = catalog.visual_code_ref_map['src/components/chat/ChatMainPane.tsx'] ?? [];

    expect(mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storyId: 'mock-lane-chat-operate-and-recover',
        level: 'V2',
        evidenceOwner: 'npm run verify:visual',
      }),
    ]));
    expect(mappings.some((mapping) => mapping.surface.startsWith('visual:'))).toBe(true);
    expect(catalog.story_by_id['mock-lane-chat-operate-and-recover']?.visualScenarioIds.length)
      .toBeGreaterThan(0);
  });

  it('projects backend-real stories with V3 owner and artifact template without inspecting artifacts', () => {
    const catalog = buildVerificationCatalog();
    const story = catalog.story_by_id['notebook-first-success'];
    const v3 = catalog.evidence.levels.V3;

    expect(story).toMatchObject({
      lane: 'backend-real',
      sourceFile: 'e2e/stories/backend-real/notebook-first-success.story.md',
      requiredLevels: ['V0', 'V1', 'V3'],
    });
    expect(v3).toMatchObject({
      owner: 'npm run verify:real',
      gateId: 'lane-backend-real-core',
      artifactPathTemplate: 'artifacts/backend-real/runs/<run-id>/ux-traces',
      verdictState: 'none',
    });
  });

  it('projects risk policy refs and only raises canonical story levels', () => {
    const catalog = buildVerificationCatalog();
    const unicodeStory = catalog.story_by_id['unicode-filename-round-trip'];
    const notebookStory = catalog.story_by_id['notebook-first-success'];

    expect(unicodeStory).toMatchObject({
      riskPolicyRefs: ['file_continuity_integrity'],
      riskPolicySource: CURRENT_STORY_RISK_POLICY_SOURCE,
      riskPolicyRiskFloor: 'R0',
      riskPolicyLevelFloor: ['V0', 'V1', 'V2', 'V3'],
      requiredLevels: ['V0', 'V1', 'V2', 'V3'],
    });
    expect(notebookStory).toMatchObject({
      riskPolicyRefs: ['core_ai_workflow'],
      riskPolicyRiskFloor: 'R1',
      riskPolicyLevelFloor: ['V0', 'V1', 'V3'],
      requiredLevels: ['V0', 'V1', 'V3'],
    });
  });

  it('projects V4 release-ready ownership without a release verdict', () => {
    const catalog = buildVerificationCatalog();
    const v4 = catalog.evidence.levels.V4;

    expect(v4).toMatchObject({
      owner: 'npm run release:ready',
      gateId: 'gate-release-full',
      artifactPathTemplate: 'artifacts/release-runs/<campaign-run-id>/gate-release-full/result.json',
      verdictState: 'none',
    });
    expect(v4.additionalArtifactPathTemplates).toContain('artifacts/release-runs/<campaign-run-id>');
    expect(catalog.provenance.verdict_state).toBe('none');
  });

  it('does not fabricate V4 release evidence templates when campaign truth is missing', () => {
    const withoutCampaign = buildVerificationCatalog({
      verificationCampaigns: [],
    });
    const releaseFull = listCurrentVerificationCampaigns().find((campaign) => campaign.id === 'release-full');
    if (!releaseFull) {
      throw new Error('release-full campaign fixture is required');
    }
    const withoutTerminalHint: CurrentVerificationCampaignDefinition = {
      ...releaseFull,
      steps: releaseFull.steps.map((step) => (
        step.id === 'gate-release-full'
          ? { ...step, evidenceHints: [] }
          : step
      )),
    };
    const withoutHint = buildVerificationCatalog({
      verificationCampaigns: [withoutTerminalHint],
    });

    expect(withoutCampaign.source_truth.current_verification_campaign_manifest).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      module: null,
      campaign_ids: [],
    });
    expect(withoutCampaign.evidence.levels.V4).toMatchObject({
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    });
    expect(withoutHint.evidence.levels.V4).toMatchObject({
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [releaseFull.runRootPattern],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    });
  });

  it('keeps evidence owner commands aligned with package entrypoints', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const catalog = buildVerificationCatalog();
    const ownerCommands = [
      catalog.evidence.levels.V0.owner,
      catalog.evidence.levels.V1.owner,
      catalog.evidence.levels.V2.owner,
      catalog.evidence.levels.V3.owner,
      catalog.evidence.levels.V3.releaseRealDiagnostic.owner,
      catalog.evidence.levels.V4.owner,
    ];

    for (const ownerCommand of ownerCommands) {
      expect(ownerCommand.startsWith('npm run ')).toBe(true);
      expect(packageJson.scripts[ownerCommand.replace(/^npm run /, '')]).toBeTruthy();
    }
  });

  it('writes the read-only catalog projection under the report root', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verification-catalog-'));
    try {
      const catalog = buildVerificationCatalog({
        generatedAt: '2026-04-25T12:00:00.000Z',
      });
      const result = writeVerificationCatalog(catalog, root);
      const persisted = JSON.parse(readFileSync(result.jsonPath, 'utf8')) as typeof catalog;

      expect(result).toMatchObject({
        reportRoot: resolve(root),
        jsonPath: join(resolve(root), 'verification-catalog.json'),
      });
      expect(persisted.schema).toBe(VERIFICATION_CATALOG_SCHEMA);
      expect(persisted.provenance).toEqual({
        generated_at: '2026-04-25T12:00:00.000Z',
        projection_kind: 'read_only',
        artifact_directory_inspection: false,
        verdict_state: 'none',
        evidence_claims_created: false,
      });
      expect(readFileSync(result.jsonPath, 'utf8').endsWith('\n')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
