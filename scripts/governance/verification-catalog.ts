import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { StoryDefinition } from '../../e2e/story-contract';
import {
  listVisualBaselineCatalogEntries,
  type VisualBaselineCatalogEntry,
} from '../../e2e/visual-baseline-support';
import { loadCommittedStoryDefinitionsSync } from '../story-catalog-support';
import {
  findCurrentGateDefinitionById,
  listCurrentGateDefinitions,
} from './current-gate-manifest';
import {
  findCurrentGateResultWriter,
  resolveCurrentGateResultPath,
  CURRENT_GATE_RESULT_ARTIFACT_NAME,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  CURRENT_GATE_RESULT_WRITERS,
} from './current-gate-result-schema';
import {
  CURRENT_EVIDENCE_CLAIM_SCHEMA,
  CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  CURRENT_EVIDENCE_CLAIM_SCOPES,
  CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS,
  CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES,
} from './current-evidence-claim-schema';
import {
  CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  CURRENT_JOB_METADATA_MANIFEST_VERSION,
  listCurrentJobMetadata,
  type CurrentJobMetadata,
} from './current-job-metadata-manifest';
import {
  CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
  CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
  listCurrentResourceLocks,
  type CurrentResourceLockDefinition,
} from './current-resource-lock-manifest';
import {
  listCurrentVerificationCampaigns,
  type CurrentVerificationCampaignDefinition,
} from './current-verification-campaign-manifest';
import {
  CURRENT_STORY_RISK_POLICY,
  CURRENT_STORY_RISK_POLICY_INPUT_OVERRIDE_SOURCE,
  CURRENT_STORY_RISK_POLICY_SCHEMA,
  CURRENT_STORY_RISK_POLICY_SOURCE,
  STORY_RISK_POLICY_REF_DEFINITIONS,
  resolveStoryRiskPolicyFloor,
  validateCurrentStoryRiskPolicy,
  type CurrentStoryRiskPolicyDocument,
  type StoryRiskPolicyRefId,
  type StoryRiskPolicyRisk,
  type StoryRiskPolicySource,
} from './current-story-risk-policy';
import {
  scanTraceSpecStoryMap,
  TRACE_SPEC_STORY_BINDING_CONTRACT,
  TRACE_SPEC_STORY_BINDING_SCANNER_PATH,
  TRACE_SPEC_STORY_BINDING_SOURCE_GLOB,
  type TraceSpecStoryMapEntry,
} from './trace-spec-story-map';

export const VERIFICATION_CATALOG_SCHEMA = 'agentsmith_verification_catalog/v1' as const;
export const VERIFICATION_CATALOG_FILE_NAME = 'verification-catalog.json' as const;
export const GENERATED_STORY_SPEC_PATH = 'e2e/generated/story-specs.generated.json' as const;
export const VERIFICATION_LEVEL_ORDER = ['V0', 'V1', 'V2', 'V3', 'V4'] as const;

export type VerificationCatalogLevel = (typeof VERIFICATION_LEVEL_ORDER)[number];

export interface VerificationCatalogStory {
  storyId: string;
  title: string;
  personas: readonly string[];
  family: string;
  lane: StoryDefinition['lane'];
  sourceFile: string;
  filePath: string;
  gatePolicy: StoryDefinition['gatePolicy'];
  riskPolicyRefs: readonly StoryRiskPolicyRefId[];
  riskPolicySource: StoryRiskPolicySource;
  riskPolicyRiskFloor: StoryRiskPolicyRisk;
  riskPolicyLevelFloor: readonly VerificationCatalogLevel[];
  requiredLevels: readonly VerificationCatalogLevel[];
  visualScenarioIds: readonly string[];
  sourceTruth: {
    kind: 'canonical_story_markdown';
    path: string;
  };
}

export interface VerificationCatalogVisualEntry {
  id: string;
  scenarioId: string;
  storyId: string;
  storySceneId: string;
  storySourceFile: string;
  route: string;
  group: VisualBaselineCatalogEntry['group'];
  codeRefs: readonly string[];
  storyEvidenceKind: VisualBaselineCatalogEntry['storyEvidenceKind'];
  storyEvidenceOwner: VisualBaselineCatalogEntry['storyEvidenceOwner'];
  sourceSpec: VisualBaselineCatalogEntry['sourceSpec'];
}

export interface VerificationCatalogVisualCodeRefMapping {
  codeRef: string;
  storyId: string;
  scenarioId: string;
  storySceneId: string;
  storySourceFile: string;
  surface: string;
  level: 'V2';
  evidenceOwner: 'npm run verify:visual';
}

export type VerificationCatalogTraceSpecStoryMapEntry = TraceSpecStoryMapEntry;

export interface VerificationEvidenceProjection {
  level: VerificationCatalogLevel;
  owner: string;
  gateId: string | null;
  source: 'current_gate_manifest' | 'current_gate_result_schema' | 'current_verification_campaign_manifest';
  state: 'not_inspected_projection';
  verdictState: 'none';
  artifactPathTemplate: string | null;
  additionalArtifactPathTemplates: readonly string[];
  artifactPathTemplateReason: string | null;
}

export interface VerificationCatalogV3EvidenceProjection extends VerificationEvidenceProjection {
  level: 'V3';
  releaseRealDiagnostic: VerificationEvidenceProjection & {
    level: 'V3';
  };
}

export interface VerificationCatalogEvidenceProjection {
  levels: {
    V0: VerificationEvidenceProjection & { level: 'V0' };
    V1: VerificationEvidenceProjection & { level: 'V1' };
    V2: VerificationEvidenceProjection & { level: 'V2' };
    V3: VerificationCatalogV3EvidenceProjection;
    V4: VerificationEvidenceProjection & { level: 'V4' };
  };
}

export interface VerificationCatalogP2ClaimSchemaProjection {
  schema_version: typeof CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION;
  top_level_key_count: number;
  scope_count: number;
  validation_purpose_count: number;
  digest_format: (typeof CURRENT_EVIDENCE_CLAIM_SCHEMA)['digest_format'];
  claim_instances_included: false;
}

export interface VerificationCatalogResourceLockOwnerCountsProjection {
  gate_id_count: number;
  npm_script_count: number;
  command_surface_count: number;
}

export interface VerificationCatalogResourceLockAppliesToCountsProjection {
  gate_id_count: number;
  npm_script_count: number;
  runtime_line_count: number;
  path_count: number;
  port_count: number;
  provider_profile_count: number;
}

export interface VerificationCatalogResourceLockProfileReuseProjection {
  cross_provider_profile_reuse_forbidden: boolean;
  cross_secret_profile_reuse_forbidden: boolean;
}

export interface VerificationCatalogResourceLockProjection {
  id: string;
  category: string;
  scope: CurrentResourceLockDefinition['scope'];
  mode: CurrentResourceLockDefinition['mode'];
  enforcement: CurrentResourceLockDefinition['enforcement'];
  owner_counts: VerificationCatalogResourceLockOwnerCountsProjection;
  applies_to_counts: VerificationCatalogResourceLockAppliesToCountsProjection;
  profile_reuse: VerificationCatalogResourceLockProfileReuseProjection | null;
}

export interface VerificationCatalogJobInputCountsProjection {
  path_glob_count: number;
  env_profile_count: number;
  required_secret_count: number;
}

export interface VerificationCatalogJobOutputCountsProjection {
  expected_artifact_template_count: number;
}

export interface VerificationCatalogJobTimeoutSecondsProjection {
  local: number;
  ci: number;
}

export interface VerificationCatalogJobMetadataProjection {
  id: string;
  kind: CurrentJobMetadata['kind'];
  gate_id: string;
  step_id: string | null;
  npm_script: string;
  execution_mode: CurrentJobMetadata['execution_mode'];
  line_kind: string;
  depends_on: readonly string[];
  lock_ids: readonly string[];
  timeout_seconds: VerificationCatalogJobTimeoutSecondsProjection;
  retry: CurrentJobMetadata['retry'];
  cache: CurrentJobMetadata['cache'];
  input_counts: VerificationCatalogJobInputCountsProjection;
  output_counts: VerificationCatalogJobOutputCountsProjection;
}

export interface VerificationCatalogP2ModelProjection {
  projection_kind: 'read_only';
  artifact_directory_inspection: false;
  verdict_state: 'none';
  evidence_claims_created: false;
  claim_schema: VerificationCatalogP2ClaimSchemaProjection;
  resource_locks: {
    schema: typeof CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA;
    version: typeof CURRENT_RESOURCE_LOCK_MANIFEST_VERSION;
    lock_ids: readonly string[];
    lock_count: number;
    locks: readonly VerificationCatalogResourceLockProjection[];
  };
  job_metadata: {
    schema: typeof CURRENT_JOB_METADATA_MANIFEST_SCHEMA;
    version: typeof CURRENT_JOB_METADATA_MANIFEST_VERSION;
    job_ids: readonly string[];
    job_count: number;
    campaign_id_count: number;
    jobs: readonly VerificationCatalogJobMetadataProjection[];
  };
}

export interface VerificationCatalog {
  schema: typeof VERIFICATION_CATALOG_SCHEMA;
  provenance: {
    generated_at: string;
    projection_kind: 'read_only';
    artifact_directory_inspection: false;
    verdict_state: 'none';
    evidence_claims_created: false;
  };
  source_truth: {
    canonical_stories: {
      authority: 'authoritative' | 'input_override_non_authoritative';
      source_mode: 'default_loader' | 'input_override';
      loader: 'loadCommittedStoryDefinitionsSync' | null;
      path_glob: 'e2e/stories/**/*.story.md' | null;
      story_count: number;
    };
    current_gate_manifest: {
      authority: 'authoritative';
      module: 'scripts/governance/current-gate-manifest.ts';
      gate_ids: readonly string[];
    };
    current_verification_campaign_manifest: {
      authority: 'authoritative' | 'input_override_non_authoritative';
      source_mode: 'default_manifest' | 'input_override';
      module: 'scripts/governance/current-verification-campaign-manifest.ts' | null;
      campaign_ids: readonly string[];
    };
    visual_catalog: {
      authority: 'derived_projection' | 'input_override_non_authoritative';
      source_mode: 'default_builder' | 'input_override';
      builder: 'listVisualBaselineCatalogEntries' | null;
      source_spec: 'e2e/visual.spec.ts' | null;
      source_module: 'e2e/visual-baseline-support.ts' | null;
      entry_count: number;
      scenario_count: number;
    };
    gate_result_schema: {
      authority: 'authoritative';
      module: 'scripts/governance/current-gate-result-schema.ts';
      schema_version: typeof CURRENT_GATE_RESULT_SCHEMA_VERSION;
      artifact_name: typeof CURRENT_GATE_RESULT_ARTIFACT_NAME;
      statuses: typeof CURRENT_GATE_RESULT_STATUSES;
      writer_gate_ids: readonly string[];
    };
    current_evidence_claim_schema: {
      authority: 'authoritative';
      module: 'scripts/governance/current-evidence-claim-schema.ts';
      schema_version: typeof CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION;
      top_level_key_count: number;
      scope_count: number;
      validation_purpose_count: number;
      digest_format: (typeof CURRENT_EVIDENCE_CLAIM_SCHEMA)['digest_format'];
      claim_instances_included: false;
    };
    current_resource_lock_manifest: {
      authority: 'authoritative';
      module: 'scripts/governance/current-resource-lock-manifest.ts';
      schema: typeof CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA;
      version: typeof CURRENT_RESOURCE_LOCK_MANIFEST_VERSION;
      lock_ids: readonly string[];
      lock_count: number;
    };
    current_job_metadata_manifest: {
      authority: 'authoritative';
      module: 'scripts/governance/current-job-metadata-manifest.ts';
      schema: typeof CURRENT_JOB_METADATA_MANIFEST_SCHEMA;
      version: typeof CURRENT_JOB_METADATA_MANIFEST_VERSION;
      job_ids: readonly string[];
      job_count: number;
      campaign_ids: readonly string[];
    };
    generated_story_specs: {
      authority: 'derived_cache';
      authoritative: false;
      path: typeof GENERATED_STORY_SPEC_PATH;
      source_builder: string;
      used_as_story_truth: false;
      spec_count: number;
    };
    trace_spec_story_bindings: {
      authority: 'derived_projection' | 'input_override_non_authoritative';
      source_mode: 'default_scanner' | 'input_override' | 'disabled_for_story_input_override';
      used_as_story_truth: false;
      scanner: typeof TRACE_SPEC_STORY_BINDING_SCANNER_PATH;
      source_glob: typeof TRACE_SPEC_STORY_BINDING_SOURCE_GLOB;
      binding_contract: typeof TRACE_SPEC_STORY_BINDING_CONTRACT;
      spec_count: number;
      binding_count: number;
      unresolved_count: number;
    };
    current_story_risk_policy: {
      authority: 'authoritative' | 'input_override_non_authoritative';
      source_mode: 'default_sidecar' | 'input_override';
      module: typeof CURRENT_STORY_RISK_POLICY_SOURCE | null;
      schema: typeof CURRENT_STORY_RISK_POLICY_SCHEMA;
      story_count: number;
      policy_ref_ids: readonly StoryRiskPolicyRefId[];
    };
  };
  stories: readonly VerificationCatalogStory[];
  story_by_id: Record<string, VerificationCatalogStory>;
  story_source_file_map: Record<string, string>;
  visual_catalog: {
    entries: readonly VerificationCatalogVisualEntry[];
  };
  visual_code_ref_map: Record<string, readonly VerificationCatalogVisualCodeRefMapping[]>;
  trace_spec_story_map: {
    entries: readonly VerificationCatalogTraceSpecStoryMapEntry[];
  };
  evidence: VerificationCatalogEvidenceProjection;
  p2_model_projection: VerificationCatalogP2ModelProjection;
  generated_story_specs: {
    authority: 'derived_cache_only';
    authoritative: false;
    used_as_story_truth: false;
    path: typeof GENERATED_STORY_SPEC_PATH;
    story_ids: readonly string[];
  };
}

export interface BuildVerificationCatalogInput {
  generatedAt?: string;
  stories?: readonly StoryDefinition[];
  visualCatalogEntries?: readonly VisualBaselineCatalogEntry[];
  verificationCampaigns?: readonly CurrentVerificationCampaignDefinition[];
  storyRiskPolicy?: unknown;
  traceSpecStoryMapEntries?: readonly TraceSpecStoryMapEntry[];
}

export interface VerificationCatalogWriteResult {
  reportRoot: string;
  jsonPath: string;
  catalog: VerificationCatalog;
}

type EvidenceTemplateResolution = {
  artifactPathTemplate: string | null;
  additionalArtifactPathTemplates: readonly string[];
  artifactPathTemplateReason: string | null;
};

export function normalizeVerificationCatalogRepoPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
  const relative = path.relative(process.cwd(), absolute).replace(/\\/g, '/');
  return relative.startsWith('../') ? normalized.replace(/^\.\//, '') : relative;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isDefinedString(value: string | null | undefined): value is string {
  return typeof value === 'string';
}

function projectP2CampaignIds(jobs: readonly CurrentJobMetadata[]): readonly string[] {
  return uniqueSorted(jobs.map((job) => job.campaign_id).filter(isDefinedString));
}

function sanitizeP2ModelToken(value: string): string {
  return value
    .replaceAll('campaign_root', 'campaign_boundary')
    .replaceAll('verdict', 'terminal_decision');
}

function projectResourceLockOwnerCounts(
  lock: CurrentResourceLockDefinition,
): VerificationCatalogResourceLockOwnerCountsProjection {
  return {
    gate_id_count: lock.owners.gateIds?.length ?? 0,
    npm_script_count: lock.owners.npmScripts?.length ?? 0,
    command_surface_count: lock.owners.commandSurfaces?.length ?? 0,
  };
}

function projectResourceLockAppliesToCounts(
  lock: CurrentResourceLockDefinition,
): VerificationCatalogResourceLockAppliesToCountsProjection {
  return {
    gate_id_count: lock.appliesTo.gateIds?.length ?? 0,
    npm_script_count: lock.appliesTo.npmScripts?.length ?? 0,
    runtime_line_count: lock.appliesTo.runtimeLines?.length ?? 0,
    path_count: lock.appliesTo.paths?.length ?? 0,
    port_count: lock.appliesTo.ports?.length ?? 0,
    provider_profile_count: lock.appliesTo.providerProfiles?.length ?? 0,
  };
}

function projectResourceLockProfileReuse(
  lock: CurrentResourceLockDefinition,
): VerificationCatalogResourceLockProfileReuseProjection | null {
  if (!lock.profileReuse) {
    return null;
  }

  return {
    cross_provider_profile_reuse_forbidden: lock.profileReuse.crossProviderProfileReuse === 'forbidden',
    cross_secret_profile_reuse_forbidden: lock.profileReuse.crossSecretProfileReuse === 'forbidden',
  };
}

function projectResourceLock(
  lock: CurrentResourceLockDefinition,
): VerificationCatalogResourceLockProjection {
  return {
    id: lock.id,
    category: sanitizeP2ModelToken(lock.category),
    scope: lock.scope,
    mode: lock.mode,
    enforcement: lock.enforcement,
    owner_counts: projectResourceLockOwnerCounts(lock),
    applies_to_counts: projectResourceLockAppliesToCounts(lock),
    profile_reuse: projectResourceLockProfileReuse(lock),
  };
}

function projectJobInputCounts(job: CurrentJobMetadata): VerificationCatalogJobInputCountsProjection {
  return {
    path_glob_count: job.inputs.path_globs.length,
    env_profile_count: job.inputs.env_profiles.length,
    required_secret_count: job.inputs.required_secret_names.length,
  };
}

function projectJobOutputCounts(job: CurrentJobMetadata): VerificationCatalogJobOutputCountsProjection {
  return {
    expected_artifact_template_count: job.outputs.expected_artifact_path_templates.length,
  };
}

function projectJobTimeoutSeconds(job: CurrentJobMetadata): VerificationCatalogJobTimeoutSecondsProjection {
  return {
    local: job.timeouts.local_seconds,
    ci: job.timeouts.ci_seconds,
  };
}

function projectJobMetadata(job: CurrentJobMetadata): VerificationCatalogJobMetadataProjection {
  return {
    id: job.id,
    kind: job.kind,
    gate_id: job.gate_id,
    step_id: job.step_id ?? null,
    npm_script: job.npm_script,
    execution_mode: job.execution_mode,
    line_kind: sanitizeP2ModelToken(job.line_kind),
    depends_on: [...job.depends_on],
    lock_ids: [...job.locks],
    timeout_seconds: projectJobTimeoutSeconds(job),
    retry: job.retry,
    cache: job.cache,
    input_counts: projectJobInputCounts(job),
    output_counts: projectJobOutputCounts(job),
  };
}

function assertProjectedJobLocksKnown(
  resourceLocks: readonly CurrentResourceLockDefinition[],
  jobs: readonly CurrentJobMetadata[],
): void {
  const lockIds = new Set(resourceLocks.map((lock) => lock.id));

  for (const job of jobs) {
    for (const lockId of job.locks) {
      if (!lockIds.has(lockId)) {
        throw new Error(`current job metadata ${job.id} references unknown current resource lock id: ${lockId}`);
      }
    }
  }
}

export function buildVerificationCatalogP2ModelProjection(args: {
  resourceLocks: readonly CurrentResourceLockDefinition[];
  jobs: readonly CurrentJobMetadata[];
}): VerificationCatalogP2ModelProjection {
  assertProjectedJobLocksKnown(args.resourceLocks, args.jobs);

  return {
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
      lock_ids: args.resourceLocks.map((lock) => lock.id),
      lock_count: args.resourceLocks.length,
      locks: args.resourceLocks.map(projectResourceLock),
    },
    job_metadata: {
      schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
      version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
      job_ids: args.jobs.map((job) => job.id),
      job_count: args.jobs.length,
      campaign_id_count: projectP2CampaignIds(args.jobs).length,
      jobs: args.jobs.map(projectJobMetadata),
    },
  };
}

function orderedLevels(values: Iterable<VerificationCatalogLevel>): VerificationCatalogLevel[] {
  const selected = new Set(values);
  return VERIFICATION_LEVEL_ORDER.filter((level) => selected.has(level));
}

function levelsForStory(
  story: StoryDefinition,
  riskPolicyLevelFloor: readonly VerificationCatalogLevel[] = [],
): readonly VerificationCatalogLevel[] {
  const levels = new Set<VerificationCatalogLevel>(['V0', 'V1']);
  if (story.lane === 'mock-lane' || story.gatePolicy.requiredEvidence.includes('visual')) {
    levels.add('V2');
  }
  if (story.lane === 'backend-real') {
    levels.add('V3');
  }
  for (const level of riskPolicyLevelFloor) {
    levels.add(level);
  }
  return orderedLevels(levels);
}

function currentGateResultTemplate(gateId: string): EvidenceTemplateResolution {
  if (!findCurrentGateResultWriter(gateId)) {
    return {
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: `No registered current gate result writer for ${gateId}; verify report records the owner but cannot name a stable canonical artifact template.`,
    };
  }

  return {
    artifactPathTemplate: resolveCurrentGateResultPath(`artifacts/gate-results/${gateId}/<run-id>`),
    additionalArtifactPathTemplates: [],
    artifactPathTemplateReason: null,
  };
}

function firstCurrentGateStoryArtifact(gateId: string, match: (artifactPath: string) => boolean): string | null {
  return findCurrentGateDefinitionById(gateId)?.storyEvidenceArtifacts.find(match) ?? null;
}

function firstCurrentGateStandaloneArtifact(gateId: string, match: (artifactPath: string) => boolean): string | null {
  return findCurrentGateDefinitionById(gateId)?.standaloneEvidenceArtifacts.find(match) ?? null;
}

function releaseCampaignEvidenceTemplate(
  campaigns: readonly CurrentVerificationCampaignDefinition[],
): EvidenceTemplateResolution {
  const campaign = campaigns.find((entry) => entry.id === 'release-full');
  if (!campaign) {
    return {
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    };
  }

  const runRootPattern = campaign.runRootPattern;
  const terminalStep = campaign?.steps.find((step) => step.id === 'gate-release-full');
  const resultHint = terminalStep?.evidenceHints.find((hint) => hint.endsWith('/gate-release-full/result.json'));
  if (!resultHint) {
    return {
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [runRootPattern],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    };
  }

  return {
    artifactPathTemplate: resultHint.replaceAll('<campaign-root>', runRootPattern),
    additionalArtifactPathTemplates: [runRootPattern],
    artifactPathTemplateReason: null,
  };
}

function evidenceProjection(args: {
  level: VerificationCatalogLevel;
  owner: string;
  gateId: string | null;
  source: VerificationEvidenceProjection['source'];
  template: EvidenceTemplateResolution;
}): VerificationEvidenceProjection {
  return {
    level: args.level,
    owner: args.owner,
    gateId: args.gateId,
    source: args.source,
    state: 'not_inspected_projection',
    verdictState: 'none',
    artifactPathTemplate: args.template.artifactPathTemplate,
    additionalArtifactPathTemplates: args.template.additionalArtifactPathTemplates,
    artifactPathTemplateReason: args.template.artifactPathTemplateReason,
  };
}

function buildEvidenceProjection(
  verificationCampaigns: readonly CurrentVerificationCampaignDefinition[],
): VerificationCatalogEvidenceProjection {
  const v0 = evidenceProjection({
    level: 'V0',
    owner: 'npm run verify:quick',
    gateId: 'gate-fast',
    source: 'current_gate_result_schema',
    template: currentGateResultTemplate('gate-fast'),
  }) as VerificationCatalogEvidenceProjection['levels']['V0'];
  const v1 = evidenceProjection({
    level: 'V1',
    owner: 'npm run verify:default',
    gateId: 'gate-default',
    source: 'current_gate_result_schema',
    template: currentGateResultTemplate('gate-default'),
  }) as VerificationCatalogEvidenceProjection['levels']['V1'];
  const v2Template = firstCurrentGateStandaloneArtifact(
    'lane-visual',
    (artifactPath) => artifactPath.endsWith('/run-manifest.json'),
  );
  const v2 = evidenceProjection({
    level: 'V2',
    owner: 'npm run verify:visual',
    gateId: 'lane-visual',
    source: 'current_gate_manifest',
    template: {
      artifactPathTemplate: v2Template,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: v2Template
        ? null
        : 'No current lane-visual standalone run-manifest artifact template is registered.',
    },
  }) as VerificationCatalogEvidenceProjection['levels']['V2'];
  const v3Template = firstCurrentGateStoryArtifact(
    'lane-backend-real-core',
    (artifactPath) => artifactPath.includes('/ux-traces'),
  );
  const v3ReleaseDiagnosticTemplate = firstCurrentGateStandaloneArtifact(
    'gate-release',
    (artifactPath) => artifactPath.includes('/ux-traces'),
  );
  const v3 = {
    ...evidenceProjection({
      level: 'V3',
      owner: 'npm run verify:real',
      gateId: 'lane-backend-real-core',
      source: 'current_gate_manifest',
      template: {
        artifactPathTemplate: v3Template,
        additionalArtifactPathTemplates: [],
        artifactPathTemplateReason: v3Template
          ? null
          : 'No current lane-backend-real-core UX trace artifact template is registered.',
      },
    }),
    releaseRealDiagnostic: evidenceProjection({
      level: 'V3',
      owner: 'npm run verify:release-real',
      gateId: 'gate-release',
      source: 'current_gate_manifest',
      template: {
        artifactPathTemplate: v3ReleaseDiagnosticTemplate,
        additionalArtifactPathTemplates: [],
        artifactPathTemplateReason: v3ReleaseDiagnosticTemplate
          ? null
          : 'No current gate-release UX trace artifact template is registered.',
      },
    }) as VerificationEvidenceProjection & { level: 'V3' },
  } as VerificationCatalogV3EvidenceProjection;
  const v4 = evidenceProjection({
    level: 'V4',
    owner: 'npm run release:ready',
    gateId: 'gate-release-full',
    source: 'current_verification_campaign_manifest',
    template: releaseCampaignEvidenceTemplate(verificationCampaigns),
  }) as VerificationCatalogEvidenceProjection['levels']['V4'];

  return {
    levels: {
      V0: v0,
      V1: v1,
      V2: v2,
      V3: v3,
      V4: v4,
    },
  };
}

function buildVisualProjection(entries: readonly VisualBaselineCatalogEntry[]): {
  entries: VerificationCatalogVisualEntry[];
  codeRefMap: Record<string, readonly VerificationCatalogVisualCodeRefMapping[]>;
  scenarioIdsByStoryId: Map<string, string[]>;
} {
  const codeRefMap = new Map<string, VerificationCatalogVisualCodeRefMapping[]>();
  const scenarioIdsByStoryId = new Map<string, string[]>();

  const projectedEntries = entries.map((entry) => {
    const storySourceFile = normalizeVerificationCatalogRepoPath(entry.storySourceFile);
    const codeRefs = entry.codeRefs.map(normalizeVerificationCatalogRepoPath);
    const storyScenarioIds = scenarioIdsByStoryId.get(entry.storyId) ?? [];
    storyScenarioIds.push(entry.scenarioId);
    scenarioIdsByStoryId.set(entry.storyId, storyScenarioIds);

    for (const codeRef of codeRefs) {
      const mappings = codeRefMap.get(codeRef) ?? [];
      mappings.push({
        codeRef,
        storyId: entry.storyId,
        scenarioId: entry.scenarioId,
        storySceneId: entry.storySceneId,
        storySourceFile,
        surface: `visual:${entry.scenarioId}`,
        level: 'V2',
        evidenceOwner: 'npm run verify:visual',
      });
      codeRefMap.set(codeRef, mappings);
    }

    return {
      id: entry.id,
      scenarioId: entry.scenarioId,
      storyId: entry.storyId,
      storySceneId: entry.storySceneId,
      storySourceFile,
      route: entry.route,
      group: entry.group,
      codeRefs,
      storyEvidenceKind: entry.storyEvidenceKind,
      storyEvidenceOwner: entry.storyEvidenceOwner,
      sourceSpec: entry.sourceSpec,
    };
  });

  return {
    entries: projectedEntries,
    codeRefMap: Object.fromEntries(
      [...codeRefMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([codeRef, mappings]) => [
          codeRef,
          [...mappings].sort((left, right) => (
            `${left.scenarioId}:${left.storyId}`.localeCompare(`${right.scenarioId}:${right.storyId}`)
          )),
        ]),
    ),
    scenarioIdsByStoryId,
  };
}

function buildStoryProjection(
  stories: readonly StoryDefinition[],
  scenarioIdsByStoryId: ReadonlyMap<string, readonly string[]>,
  riskPolicy: CurrentStoryRiskPolicyDocument,
  riskPolicySource: StoryRiskPolicySource,
): {
  stories: VerificationCatalogStory[];
  storyById: Record<string, VerificationCatalogStory>;
  storySourceFileMap: Record<string, string>;
} {
  const projectedStories = stories.map((story) => {
    const sourceFile = normalizeVerificationCatalogRepoPath(story.sourceFile ?? story.filePath);
    const filePath = normalizeVerificationCatalogRepoPath(story.filePath);
    const policyRefs = riskPolicy.stories[story.storyId]?.policy_refs;
    if (!policyRefs) {
      throw new Error(`current story risk policy is missing story ${story.storyId}`);
    }
    const riskPolicyFloor = resolveStoryRiskPolicyFloor(policyRefs);
    const riskPolicyLevelFloor = orderedLevels(riskPolicyFloor.levelFloor);
    return {
      storyId: story.storyId,
      title: story.title,
      personas: [...story.personas],
      family: story.family,
      lane: story.lane,
      sourceFile,
      filePath,
      gatePolicy: {
        tier: story.gatePolicy.tier,
        requiredEvidence: [...story.gatePolicy.requiredEvidence],
      },
      riskPolicyRefs: [...policyRefs],
      riskPolicySource,
      riskPolicyRiskFloor: riskPolicyFloor.riskFloor,
      riskPolicyLevelFloor,
      requiredLevels: levelsForStory(story, riskPolicyLevelFloor),
      visualScenarioIds: uniqueSorted(scenarioIdsByStoryId.get(story.storyId) ?? []),
      sourceTruth: {
        kind: 'canonical_story_markdown',
        path: sourceFile,
      },
    };
  }).sort((left, right) => left.storyId.localeCompare(right.storyId));

  return {
    stories: projectedStories,
    storyById: Object.fromEntries(projectedStories.map((story) => [story.storyId, story])),
    storySourceFileMap: Object.fromEntries(projectedStories.map((story) => [story.sourceFile, story.storyId])),
  };
}

function selectStoryRiskPolicy(args: {
  stories: readonly StoryDefinition[];
  inputPolicy: unknown;
  hasInputPolicyOverride: boolean;
  storiesUseInputOverride: boolean;
}): CurrentStoryRiskPolicyDocument {
  const storyIds = args.stories.map((story) => story.storyId);
  if (args.hasInputPolicyOverride) {
    return validateCurrentStoryRiskPolicy(args.inputPolicy, storyIds);
  }
  if (!args.storiesUseInputOverride) {
    return validateCurrentStoryRiskPolicy(CURRENT_STORY_RISK_POLICY, storyIds);
  }

  const defaultPolicy = CURRENT_STORY_RISK_POLICY as CurrentStoryRiskPolicyDocument;
  return validateCurrentStoryRiskPolicy({
    schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
    stories: Object.fromEntries(storyIds.map((storyId) => {
      const entry = defaultPolicy.stories[storyId];
      if (!entry) {
        throw new Error(`current story risk policy is missing input story override id: ${storyId}`);
      }
      return [storyId, entry];
    })),
  }, storyIds);
}

function traceSpecSummary(entries: readonly TraceSpecStoryMapEntry[]): {
  specCount: number;
  bindingCount: number;
  unresolvedCount: number;
} {
  return {
    specCount: new Set(entries.map((entry) => entry.specFile)).size,
    bindingCount: entries.length,
    unresolvedCount: 0,
  };
}

function normalizeTraceSpecStoryMapEntries(
  entries: readonly TraceSpecStoryMapEntry[],
  storyById: Record<string, VerificationCatalogStory>,
): VerificationCatalogTraceSpecStoryMapEntry[] {
  return entries.map((entry) => {
    const story = storyById[entry.storyId];
    if (!story) {
      throw new Error(`trace spec story map references unknown canonical story id: ${entry.storyId}`);
    }
    return {
      specFile: normalizeVerificationCatalogRepoPath(entry.specFile),
      storyId: entry.storyId,
      storySourceFile: story.sourceFile,
      sourceTruth: entry.sourceTruth,
    };
  }).sort((left, right) => (
    left.specFile.localeCompare(right.specFile)
    || left.storyId.localeCompare(right.storyId)
  ));
}

export function buildVerificationCatalog(input: BuildVerificationCatalogInput = {}): VerificationCatalog {
  const stories = input.stories ?? loadCommittedStoryDefinitionsSync();
  const visualCatalogEntries = input.visualCatalogEntries ?? listVisualBaselineCatalogEntries();
  const verificationCampaigns = input.verificationCampaigns ?? listCurrentVerificationCampaigns();
  const currentResourceLocks = listCurrentResourceLocks();
  const currentJobMetadata = listCurrentJobMetadata();
  const generatedStorySpecStoryIds = stories.map((story) => story.storyId);
  const visualProjection = buildVisualProjection(visualCatalogEntries);
  const storiesUseInputOverride = Boolean(input.stories);
  const riskPolicyUsesInputOverride = Object.prototype.hasOwnProperty.call(input, 'storyRiskPolicy');
  const riskPolicy = selectStoryRiskPolicy({
    stories,
    inputPolicy: input.storyRiskPolicy,
    hasInputPolicyOverride: riskPolicyUsesInputOverride,
    storiesUseInputOverride,
  });
  const storyProjection = buildStoryProjection(
    stories,
    visualProjection.scenarioIdsByStoryId,
    riskPolicy,
    riskPolicyUsesInputOverride
      ? CURRENT_STORY_RISK_POLICY_INPUT_OVERRIDE_SOURCE
      : CURRENT_STORY_RISK_POLICY_SOURCE,
  );
  const gateIds = listCurrentGateDefinitions().map((definition) => definition.id);
  const campaignIds = verificationCampaigns.map((campaign) => campaign.id);
  const currentResourceLockIds = currentResourceLocks.map((lock) => lock.id);
  const currentJobIds = currentJobMetadata.map((job) => job.id);
  const currentJobCampaignIds = projectP2CampaignIds(currentJobMetadata);
  const visualScenarioCount = new Set(visualCatalogEntries.map((entry) => entry.scenarioId)).size;
  const visualCatalogUsesInputOverride = Boolean(input.visualCatalogEntries);
  const verificationCampaignsUseInputOverride = Boolean(input.verificationCampaigns);
  const traceSpecMapUsesInputOverride = Object.prototype.hasOwnProperty.call(input, 'traceSpecStoryMapEntries');
  const traceSpecScan = (() => {
    if (traceSpecMapUsesInputOverride) {
      const entries = normalizeTraceSpecStoryMapEntries(input.traceSpecStoryMapEntries ?? [], storyProjection.storyById);
      return {
        entries,
        summary: traceSpecSummary(entries),
      };
    }
    if (storiesUseInputOverride) {
      return {
        entries: [],
        summary: {
          specCount: 0,
          bindingCount: 0,
          unresolvedCount: 0,
        },
      };
    }
    return scanTraceSpecStoryMap({ stories });
  })();

  return {
    schema: VERIFICATION_CATALOG_SCHEMA,
    provenance: {
      generated_at: input.generatedAt ?? new Date().toISOString(),
      projection_kind: 'read_only',
      artifact_directory_inspection: false,
      verdict_state: 'none',
      evidence_claims_created: false,
    },
    source_truth: {
      canonical_stories: {
        authority: storiesUseInputOverride ? 'input_override_non_authoritative' : 'authoritative',
        source_mode: storiesUseInputOverride ? 'input_override' : 'default_loader',
        loader: storiesUseInputOverride ? null : 'loadCommittedStoryDefinitionsSync',
        path_glob: storiesUseInputOverride ? null : 'e2e/stories/**/*.story.md',
        story_count: storyProjection.stories.length,
      },
      current_gate_manifest: {
        authority: 'authoritative',
        module: 'scripts/governance/current-gate-manifest.ts',
        gate_ids: gateIds,
      },
      current_verification_campaign_manifest: {
        authority: verificationCampaignsUseInputOverride ? 'input_override_non_authoritative' : 'authoritative',
        source_mode: verificationCampaignsUseInputOverride ? 'input_override' : 'default_manifest',
        module: verificationCampaignsUseInputOverride
          ? null
          : 'scripts/governance/current-verification-campaign-manifest.ts',
        campaign_ids: campaignIds,
      },
      visual_catalog: {
        authority: visualCatalogUsesInputOverride ? 'input_override_non_authoritative' : 'derived_projection',
        source_mode: visualCatalogUsesInputOverride ? 'input_override' : 'default_builder',
        builder: visualCatalogUsesInputOverride ? null : 'listVisualBaselineCatalogEntries',
        source_spec: visualCatalogUsesInputOverride ? null : 'e2e/visual.spec.ts',
        source_module: visualCatalogUsesInputOverride ? null : 'e2e/visual-baseline-support.ts',
        entry_count: visualCatalogEntries.length,
        scenario_count: visualScenarioCount,
      },
      gate_result_schema: {
        authority: 'authoritative',
        module: 'scripts/governance/current-gate-result-schema.ts',
        schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
        artifact_name: CURRENT_GATE_RESULT_ARTIFACT_NAME,
        statuses: CURRENT_GATE_RESULT_STATUSES,
        writer_gate_ids: CURRENT_GATE_RESULT_WRITERS.map((writer) => writer.gate_id),
      },
      current_evidence_claim_schema: {
        authority: 'authoritative',
        module: 'scripts/governance/current-evidence-claim-schema.ts',
        schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
        top_level_key_count: CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS.length,
        scope_count: CURRENT_EVIDENCE_CLAIM_SCOPES.length,
        validation_purpose_count: CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES.length,
        digest_format: CURRENT_EVIDENCE_CLAIM_SCHEMA.digest_format,
        claim_instances_included: false,
      },
      current_resource_lock_manifest: {
        authority: 'authoritative',
        module: 'scripts/governance/current-resource-lock-manifest.ts',
        schema: CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
        version: CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
        lock_ids: currentResourceLockIds,
        lock_count: currentResourceLockIds.length,
      },
      current_job_metadata_manifest: {
        authority: 'authoritative',
        module: 'scripts/governance/current-job-metadata-manifest.ts',
        schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
        version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
        job_ids: currentJobIds,
        job_count: currentJobIds.length,
        campaign_ids: currentJobCampaignIds,
      },
      generated_story_specs: {
        authority: 'derived_cache',
        authoritative: false,
        path: GENERATED_STORY_SPEC_PATH,
        source_builder: storiesUseInputOverride
          ? 'input story override metadata; generated specs are not loaded as story truth'
          : 'canonical story id projection; generated specs are not loaded as story truth',
        used_as_story_truth: false,
        spec_count: generatedStorySpecStoryIds.length,
      },
      trace_spec_story_bindings: {
        authority: traceSpecMapUsesInputOverride || storiesUseInputOverride
          ? 'input_override_non_authoritative'
          : 'derived_projection',
        source_mode: traceSpecMapUsesInputOverride
          ? 'input_override'
          : storiesUseInputOverride
            ? 'disabled_for_story_input_override'
            : 'default_scanner',
        used_as_story_truth: false,
        scanner: TRACE_SPEC_STORY_BINDING_SCANNER_PATH,
        source_glob: TRACE_SPEC_STORY_BINDING_SOURCE_GLOB,
        binding_contract: TRACE_SPEC_STORY_BINDING_CONTRACT,
        spec_count: traceSpecScan.summary.specCount,
        binding_count: traceSpecScan.summary.bindingCount,
        unresolved_count: traceSpecScan.summary.unresolvedCount,
      },
      current_story_risk_policy: {
        authority: riskPolicyUsesInputOverride ? 'input_override_non_authoritative' : 'authoritative',
        source_mode: riskPolicyUsesInputOverride ? 'input_override' : 'default_sidecar',
        module: riskPolicyUsesInputOverride ? null : CURRENT_STORY_RISK_POLICY_SOURCE,
        schema: riskPolicy.schema,
        story_count: storyProjection.stories.length,
        policy_ref_ids: Object.keys(STORY_RISK_POLICY_REF_DEFINITIONS)
          .sort((left, right) => left.localeCompare(right)) as StoryRiskPolicyRefId[],
      },
    },
    stories: storyProjection.stories,
    story_by_id: storyProjection.storyById,
    story_source_file_map: storyProjection.storySourceFileMap,
    visual_catalog: {
      entries: visualProjection.entries,
    },
    visual_code_ref_map: visualProjection.codeRefMap,
    trace_spec_story_map: {
      entries: traceSpecScan.entries,
    },
    evidence: buildEvidenceProjection(verificationCampaigns),
    p2_model_projection: buildVerificationCatalogP2ModelProjection({
      resourceLocks: currentResourceLocks,
      jobs: currentJobMetadata,
    }),
    generated_story_specs: {
      authority: 'derived_cache_only',
      authoritative: false,
      used_as_story_truth: false,
      path: GENERATED_STORY_SPEC_PATH,
      story_ids: generatedStorySpecStoryIds,
    },
  };
}

export function loadDefaultVerificationCatalog(): VerificationCatalog {
  return buildVerificationCatalog();
}

export function writeVerificationCatalog(
  catalog: VerificationCatalog,
  reportRoot: string,
): VerificationCatalogWriteResult {
  const resolvedReportRoot = path.resolve(reportRoot);
  const jsonPath = path.join(resolvedReportRoot, VERIFICATION_CATALOG_FILE_NAME);

  mkdirSync(resolvedReportRoot, { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`);

  return {
    reportRoot: resolvedReportRoot,
    jsonPath,
    catalog,
  };
}

export function evidenceProjectionForLevel(args: {
  catalog: VerificationCatalog;
  level: VerificationCatalogLevel;
  releaseRealDiagnostic?: boolean;
}): VerificationEvidenceProjection {
  if (args.level === 'V3' && args.releaseRealDiagnostic) {
    return args.catalog.evidence.levels.V3.releaseRealDiagnostic;
  }
  return args.catalog.evidence.levels[args.level];
}
