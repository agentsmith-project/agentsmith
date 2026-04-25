import {
  findCurrentGateDefinitionById,
} from './current-gate-manifest';
import {
  listCurrentResourceLocks,
} from './current-resource-lock-manifest';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignExecutionMode,
  type CurrentVerificationCampaignId,
  type CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';

export const CURRENT_JOB_METADATA_MANIFEST_SCHEMA = 'current-job-metadata-manifest.v1' as const;
export const CURRENT_JOB_METADATA_MANIFEST_VERSION = 1 as const;

export type CurrentJobMetadataKind = 'standalone_gate' | 'campaign_step';
export type CurrentJobMetadataRetry = 'none' | 'manual_only' | 'safe_transient_only';
export type CurrentJobMetadataCache =
  | 'disabled'
  | 'same_commit_pure_check'
  | 'same_commit_same_env'
  | 'release_campaign_only';

export interface CurrentJobMetadataInputs {
  path_globs: readonly string[];
  env_profiles: readonly string[];
  required_secret_names: readonly string[];
}

export interface CurrentJobMetadataOutputs {
  result_required: boolean;
  evidence_required: boolean;
  result_path_template: string;
  expected_artifact_path_templates: readonly string[];
}

export interface CurrentJobMetadataTimeouts {
  local_seconds: number;
  ci_seconds: number;
  source: string;
}

export interface CurrentJobMetadata {
  id: string;
  kind: CurrentJobMetadataKind;
  gate_id: string;
  campaign_id?: CurrentVerificationCampaignId;
  step_id?: string;
  npm_script: string;
  command: string;
  execution_mode: CurrentVerificationCampaignExecutionMode;
  line_kind: string;
  depends_on: readonly string[];
  inputs: CurrentJobMetadataInputs;
  outputs: CurrentJobMetadataOutputs;
  locks: readonly string[];
  timeouts: CurrentJobMetadataTimeouts;
  retry: CurrentJobMetadataRetry;
  cache: CurrentJobMetadataCache;
}

export interface CurrentJobMetadataManifest {
  schema: typeof CURRENT_JOB_METADATA_MANIFEST_SCHEMA;
  version: typeof CURRENT_JOB_METADATA_MANIFEST_VERSION;
  jobs: readonly CurrentJobMetadata[];
}

export interface CurrentJobMetadataManifestFailure {
  index: number;
  id?: string;
  path: string;
  reason: string;
}

export type CurrentJobMetadataManifestValidationResult =
  | {
      ok: true;
      value: CurrentJobMetadataManifest;
    }
  | {
      ok: false;
      failures: readonly CurrentJobMetadataManifestFailure[];
    };

const TOP_LEVEL_FIELDS = ['schema', 'version', 'jobs'] as const;
const JOB_FIELDS = [
  'id',
  'kind',
  'gate_id',
  'campaign_id',
  'step_id',
  'npm_script',
  'command',
  'execution_mode',
  'line_kind',
  'depends_on',
  'inputs',
  'outputs',
  'locks',
  'timeouts',
  'retry',
  'cache',
] as const;
const REQUIRED_JOB_FIELDS = [
  'id',
  'kind',
  'gate_id',
  'npm_script',
  'command',
  'execution_mode',
  'line_kind',
  'depends_on',
  'inputs',
  'outputs',
  'locks',
  'timeouts',
  'retry',
  'cache',
] as const;
const INPUT_FIELDS = ['path_globs', 'env_profiles', 'required_secret_names'] as const;
const OUTPUT_FIELDS = [
  'result_required',
  'evidence_required',
  'result_path_template',
  'expected_artifact_path_templates',
] as const;
const TIMEOUT_FIELDS = ['local_seconds', 'ci_seconds', 'source'] as const;
const JOB_KINDS = ['standalone_gate', 'campaign_step'] as const satisfies readonly CurrentJobMetadataKind[];
const EXECUTION_MODES = ['execute', 'aggregate_only'] as const satisfies readonly CurrentVerificationCampaignExecutionMode[];
const RETRY_POLICIES = ['none', 'manual_only', 'safe_transient_only'] as const satisfies readonly CurrentJobMetadataRetry[];
const CACHE_POLICIES = [
  'disabled',
  'same_commit_pure_check',
  'same_commit_same_env',
  'release_campaign_only',
] as const satisfies readonly CurrentJobMetadataCache[];
const GENERIC_JOB_IDS = new Set(['', 'job', 'jobs', 'gate', 'campaign', 'step', 'test', 'release']);
const FORBIDDEN_RUNTIME_FIELDS = new Set([
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
]);
const SECRET_VALUE_PATTERNS = [
  /sk-/i,
  /\bBearer\s+/i,
  /api_key=/i,
  /access_token=/i,
  /client_secret=/i,
  /password=/i,
  /ticket=/i,
] as const;
const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const JOB_FIELD_SET = new Set<string>(JOB_FIELDS);
const REQUIRED_JOB_FIELD_SET = new Set<string>(REQUIRED_JOB_FIELDS);
const INPUT_FIELD_SET = new Set<string>(INPUT_FIELDS);
const OUTPUT_FIELD_SET = new Set<string>(OUTPUT_FIELDS);
const TIMEOUT_FIELD_SET = new Set<string>(TIMEOUT_FIELDS);
const JOB_KIND_SET = new Set<string>(JOB_KINDS);
const EXECUTION_MODE_SET = new Set<string>(EXECUTION_MODES);
const RETRY_POLICY_SET = new Set<string>(RETRY_POLICIES);
const CACHE_POLICY_SET = new Set<string>(CACHE_POLICIES);
const RELEASE_SENSITIVE_CACHE_POLICIES = new Set<CurrentJobMetadataCache>([
  'disabled',
  'release_campaign_only',
]);
const RELEASE_SENSITIVE_RETRY_POLICIES = new Set<CurrentJobMetadataRetry>([
  'none',
  'manual_only',
]);
const CAMPAIGN_TIMEOUT_SOURCE = 'p2_metadata_schema_static_envelope';
const RELEASE_CAMPAIGN_ROOT_WRITE_LOCK_ID = 'release-campaign-root-writes';

function requireReleaseFullCampaign() {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign for current job metadata manifest.');
  }
  return campaign;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function campaignResultPathTemplate(step: CurrentVerificationCampaignStep): string {
  return `<campaign-root>/${step.id}/result.json`;
}

function expectedArtifactPathTemplates(step: CurrentVerificationCampaignStep): readonly string[] {
  return uniqueStrings([
    ...step.evidenceHints,
    ...(step.nativeResult ? [step.nativeResult.path] : []),
  ]);
}

function stepLockIds(step: CurrentVerificationCampaignStep): readonly string[] {
  const gateIds = new Set([
    step.gateId,
    ...(step.nativeResult?.gateId ? [step.nativeResult.gateId] : []),
  ]);
  const npmScripts = new Set([
    step.npmScript,
    ...(step.nativeResult?.npmScript ? [step.nativeResult.npmScript] : []),
  ]);
  const selectedLockIds = new Set<string>([RELEASE_CAMPAIGN_ROOT_WRITE_LOCK_ID]);

  for (const lock of listCurrentResourceLocks()) {
    if (
      lock.appliesTo.gateIds?.some((gateId) => gateIds.has(gateId))
      || lock.appliesTo.npmScripts?.some((npmScript) => npmScripts.has(npmScript))
    ) {
      selectedLockIds.add(lock.id);
    }
  }

  return listCurrentResourceLocks()
    .filter((lock) => selectedLockIds.has(lock.id))
    .map((lock) => lock.id);
}

function envProfiles(step: CurrentVerificationCampaignStep): readonly string[] {
  const profiles = ['release_campaign'];

  if (step.id === 'lane-visual') {
    profiles.push('visual_baseline');
  }
  if (step.id === 'gate-release' || step.nativeResult?.gateId === 'lane-backend-real-release') {
    profiles.push('backend_real_release');
  }
  if (step.id.includes('rehearsal')) {
    profiles.push('scenario_rehearsal');
  }
  if (step.executionMode === 'aggregate_only') {
    profiles.push('aggregate_verdict');
  }

  return profiles;
}

function requiredSecretNames(step: CurrentVerificationCampaignStep): readonly string[] {
  if (step.id === 'gate-release' || step.nativeResult?.gateId === 'lane-backend-real-release') {
    return ['BACKEND_REAL_API_KEY'];
  }
  return [];
}

function timeoutsForStep(step: CurrentVerificationCampaignStep): CurrentJobMetadataTimeouts {
  if (step.executionMode === 'aggregate_only') {
    return {
      local_seconds: 300,
      ci_seconds: 600,
      source: CAMPAIGN_TIMEOUT_SOURCE,
    };
  }
  if (step.id === 'gate-release' || step.id.includes('rehearsal')) {
    return {
      local_seconds: 3600,
      ci_seconds: 5400,
      source: CAMPAIGN_TIMEOUT_SOURCE,
    };
  }
  if (step.id === 'lane-visual' || step.id === 'gate-default') {
    return {
      local_seconds: 1800,
      ci_seconds: 2700,
      source: CAMPAIGN_TIMEOUT_SOURCE,
    };
  }
  return {
    local_seconds: 900,
    ci_seconds: 1200,
    source: CAMPAIGN_TIMEOUT_SOURCE,
  };
}

function retryPolicyForStep(step: CurrentVerificationCampaignStep): CurrentJobMetadataRetry {
  return step.executionMode === 'aggregate_only' ? 'none' : 'manual_only';
}

function buildCampaignJob(
  campaignId: CurrentVerificationCampaignId,
  step: CurrentVerificationCampaignStep,
): CurrentJobMetadata {
  return {
    id: step.id,
    kind: 'campaign_step',
    gate_id: step.gateId,
    campaign_id: campaignId,
    step_id: step.id,
    npm_script: step.npmScript,
    command: step.command,
    execution_mode: step.executionMode,
    line_kind: step.lineKind,
    depends_on: step.dependsOn,
    inputs: {
      path_globs: [],
      env_profiles: envProfiles(step),
      required_secret_names: requiredSecretNames(step),
    },
    outputs: {
      result_required: step.resultRequired,
      evidence_required: step.evidenceRequired,
      result_path_template: campaignResultPathTemplate(step),
      expected_artifact_path_templates: expectedArtifactPathTemplates(step),
    },
    locks: stepLockIds(step),
    timeouts: timeoutsForStep(step),
    retry: retryPolicyForStep(step),
    cache: 'release_campaign_only',
  };
}

const RELEASE_FULL_CAMPAIGN = requireReleaseFullCampaign();

export const CURRENT_JOB_METADATA_MANIFEST: CurrentJobMetadataManifest = {
  schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
  jobs: RELEASE_FULL_CAMPAIGN.steps.map((step) => buildCampaignJob(RELEASE_FULL_CAMPAIGN.id, step)),
};

export function listCurrentJobMetadata(): readonly CurrentJobMetadata[] {
  return CURRENT_JOB_METADATA_MANIFEST.jobs;
}

export function findCurrentJobMetadataById(id: string): CurrentJobMetadata | undefined {
  return CURRENT_JOB_METADATA_MANIFEST.jobs.find((job) => job.id === id);
}

export function validateCurrentJobMetadataManifest(
  manifest: unknown = CURRENT_JOB_METADATA_MANIFEST,
): CurrentJobMetadataManifestValidationResult {
  const failures: CurrentJobMetadataManifestFailure[] = [];

  validateForbiddenRuntimeFields(manifest, 'manifest', failures);
  validateNoSecretLookingValues(manifest, 'manifest', failures);

  if (!isRecord(manifest)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          index: -1,
          path: 'manifest',
          reason: 'manifest must be an object.',
        },
      ],
    };
  }

  validateAllowedFields(manifest, TOP_LEVEL_FIELD_SET, 'top-level', 'manifest', -1, undefined, failures);
  validateRequiredTopLevel(manifest, failures);

  if (manifest.schema !== CURRENT_JOB_METADATA_MANIFEST_SCHEMA) {
    failures.push({
      index: -1,
      path: 'manifest.schema',
      reason: `schema must be ${CURRENT_JOB_METADATA_MANIFEST_SCHEMA}.`,
    });
  }
  if (manifest.version !== CURRENT_JOB_METADATA_MANIFEST_VERSION) {
    failures.push({
      index: -1,
      path: 'manifest.version',
      reason: `version must be ${String(CURRENT_JOB_METADATA_MANIFEST_VERSION)}.`,
    });
  }
  if (!Array.isArray(manifest.jobs)) {
    failures.push({
      index: -1,
      path: 'manifest.jobs',
      reason: 'jobs must be an array.',
    });
    return {
      ok: false,
      failures,
    };
  }

  validateJobs(manifest.jobs, failures);
  validateReleaseFullCampaignMirror(manifest.jobs, failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: manifest as CurrentJobMetadataManifest,
  };
}

function validateRequiredTopLevel(
  manifest: Record<string, unknown>,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in manifest)) {
      failures.push({
        index: -1,
        path: `manifest.${field}`,
        reason: `${field} is required.`,
      });
    }
  }
}

function validateJobs(
  jobs: readonly unknown[],
  failures: CurrentJobMetadataManifestFailure[],
): void {
  const seenIds = new Set<string>();
  const currentLockIds = new Set(listCurrentResourceLocks().map((lock) => lock.id));

  jobs.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push({
        index,
        path: `jobs[${index}]`,
        reason: 'job metadata entry must be an object.',
      });
      return;
    }

    const id = typeof entry.id === 'string' ? entry.id : undefined;

    validateAllowedFields(entry, JOB_FIELD_SET, 'job', `jobs[${index}]`, index, id, failures);
    for (const field of REQUIRED_JOB_FIELD_SET) {
      if (!(field in entry)) {
        failures.push({
          index,
          id,
          path: `jobs[${index}].${field}`,
          reason: `${field} is required.`,
        });
      }
    }

    validateJobId(entry.id, index, seenIds, failures);
    validateEnum(entry.kind, JOB_KIND_SET, 'kind', index, id, failures);
    validateRequiredString(entry.gate_id, 'gate_id', index, id, failures);
    validateRequiredString(entry.npm_script, 'npm_script', index, id, failures);
    validateRequiredString(entry.command, 'command', index, id, failures);
    validateEnum(entry.execution_mode, EXECUTION_MODE_SET, 'execution_mode', index, id, failures);
    validateRequiredString(entry.line_kind, 'line_kind', index, id, failures);
    validateStringArray(entry.depends_on, 'depends_on', index, id, failures);
    validateEnum(entry.retry, RETRY_POLICY_SET, 'retry', index, id, failures);
    validateEnum(entry.cache, CACHE_POLICY_SET, 'cache', index, id, failures);

    if (entry.kind === 'campaign_step') {
      validateRequiredString(entry.campaign_id, 'campaign_id', index, id, failures);
      validateRequiredString(entry.step_id, 'step_id', index, id, failures);
    }

    validateGateBinding(entry, index, id, failures);
    validateInputs(entry.inputs, index, id, failures);
    validateOutputs(entry.outputs, index, id, failures);
    validateLocks(entry.locks, currentLockIds, index, id, failures);
    validateTimeouts(entry.timeouts, index, id, failures);
    validateSensitiveRetryAndCache(entry, index, id, failures);
  });
}

function validateReleaseFullCampaignMirror(
  jobs: readonly unknown[],
  failures: CurrentJobMetadataManifestFailure[],
): void {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    failures.push({
      index: -1,
      path: 'manifest.jobs',
      reason: 'release-full campaign truth is missing.',
    });
    return;
  }

  if (jobs.length !== campaign.steps.length) {
    failures.push({
      index: -1,
      path: 'manifest.jobs',
      reason: 'jobs must contain only release-full campaign steps and match the current release-full step count.',
    });
  }

  campaign.steps.forEach((step, index) => {
    const job = jobs[index];
    if (!isRecord(job)) {
      failures.push({
        index,
        path: `jobs[${index}]`,
        reason: `missing release-full campaign job for step ${step.id}.`,
      });
      return;
    }

    const id = typeof job.id === 'string' ? job.id : undefined;
    const expected = buildCampaignJob(campaign.id, step);

    if (job.kind !== 'campaign_step' || job.campaign_id !== campaign.id) {
      failures.push({
        index,
        id,
        path: `jobs[${index}]`,
        reason: 'jobs must contain only release-full campaign steps.',
      });
    }

    validateMirrorField(job.kind, expected.kind, 'kind', step, index, id, failures);
    validateMirrorField(job.id, expected.id, 'id', step, index, id, failures);
    validateMirrorField(job.campaign_id, expected.campaign_id, 'campaign_id', step, index, id, failures);
    validateMirrorField(job.step_id, expected.step_id, 'step_id', step, index, id, failures);
    validateMirrorField(job.gate_id, expected.gate_id, 'gate_id', step, index, id, failures);
    validateMirrorField(job.npm_script, expected.npm_script, 'npm_script', step, index, id, failures);
    validateMirrorField(job.command, expected.command, 'command', step, index, id, failures);
    validateMirrorField(job.execution_mode, expected.execution_mode, 'execution_mode', step, index, id, failures);
    validateMirrorField(job.line_kind, expected.line_kind, 'line_kind', step, index, id, failures);
    validateMirrorArray(job.depends_on, expected.depends_on, 'depends_on', step, index, id, failures);

    if (isRecord(job.outputs)) {
      validateMirrorField(
        job.outputs.result_required,
        expected.outputs.result_required,
        'outputs.result_required',
        step,
        index,
        id,
        failures,
      );
      validateMirrorField(
        job.outputs.evidence_required,
        expected.outputs.evidence_required,
        'outputs.evidence_required',
        step,
        index,
        id,
        failures,
      );
      validateMirrorField(
        job.outputs.result_path_template,
        expected.outputs.result_path_template,
        'outputs.result_path_template',
        step,
        index,
        id,
        failures,
      );
      validateMirrorArray(
        job.outputs.expected_artifact_path_templates,
        expected.outputs.expected_artifact_path_templates,
        'expected_artifact_path_templates',
        step,
        index,
        id,
        failures,
      );
    }

    validateMirrorInputs(job.inputs, expected.inputs, step, index, id, failures);
    validateMirrorArray(job.locks, expected.locks, 'locks', step, index, id, failures);
    validateMirrorTimeouts(job.timeouts, expected.timeouts, step, index, id, failures);
    validateMirrorField(job.retry, expected.retry, 'retry', step, index, id, failures);
    validateMirrorField(job.cache, expected.cache, 'cache', step, index, id, failures);
  });
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({
        index,
        id,
        path: `${path}.${key}`,
        reason: `unknown ${label} field "${key}".`,
      });
    }
  }
}

function validateJobId(
  value: unknown,
  index: number,
  seenIds: Set<string>,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof value !== 'string') {
    failures.push({
      index,
      path: `jobs[${index}].id`,
      reason: 'id must be a non-generic kebab-case string.',
    });
    return;
  }
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || GENERIC_JOB_IDS.has(value)) {
    failures.push({
      index,
      id: value,
      path: `jobs[${index}].id`,
      reason: 'id must be a non-generic kebab-case string.',
    });
  }
  if (seenIds.has(value)) {
    failures.push({
      index,
      id: value,
      path: `jobs[${index}].id`,
      reason: `duplicate job id "${value}".`,
    });
    return;
  }
  seenIds.add(value);
}

function validateGateBinding(
  entry: Record<string, unknown>,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof entry.gate_id !== 'string') {
    return;
  }

  const gate = findCurrentGateDefinitionById(entry.gate_id);
  if (!gate) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].gate_id`,
      reason: `unknown gate_id "${entry.gate_id}".`,
    });
    return;
  }

  if (entry.npm_script !== gate.npmScript) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].npm_script`,
      reason: `npm_script must match current gate manifest for gate_id ${entry.gate_id}.`,
    });
  }
}

function validateInputs(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].inputs`,
      reason: 'inputs must be an object.',
    });
    return;
  }

  validateAllowedFields(value, INPUT_FIELD_SET, 'inputs', `jobs[${index}].inputs`, index, id, failures);
  validateStringArray(value.path_globs, 'inputs.path_globs', index, id, failures);
  validateStringArray(value.env_profiles, 'inputs.env_profiles', index, id, failures);
  validateSecretNames(value.required_secret_names, index, id, failures);
}

function validateOutputs(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].outputs`,
      reason: 'outputs must be an object.',
    });
    return;
  }

  validateAllowedFields(value, OUTPUT_FIELD_SET, 'outputs', `jobs[${index}].outputs`, index, id, failures);
  validateBoolean(value.result_required, 'outputs.result_required', index, id, failures);
  validateBoolean(value.evidence_required, 'outputs.evidence_required', index, id, failures);
  validateRequiredString(value.result_path_template, 'outputs.result_path_template', index, id, failures);
  validateStringArray(
    value.expected_artifact_path_templates,
    'outputs.expected_artifact_path_templates',
    index,
    id,
    failures,
    'outputs.expected_artifact_path_templates must be a string array of templates only; it does not assert evidence completeness.',
  );
}

function validateLocks(
  value: unknown,
  currentLockIds: ReadonlySet<string>,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  const locks = validateStringArray(value, 'locks', index, id, failures);
  if (!locks) {
    return;
  }

  const seen = new Set<string>();
  locks.forEach((lockId, lockIndex) => {
    if (!currentLockIds.has(lockId)) {
      failures.push({
        index,
        id,
        path: `jobs[${index}].locks[${lockIndex}]`,
        reason: `unknown resource lock id "${lockId}".`,
      });
    }
    if (seen.has(lockId)) {
      failures.push({
        index,
        id,
        path: `jobs[${index}].locks[${lockIndex}]`,
        reason: `duplicate resource lock id "${lockId}".`,
      });
    }
    seen.add(lockId);
  });
}

function validateTimeouts(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].timeouts`,
      reason: 'timeouts must be an object.',
    });
    return;
  }

  validateAllowedFields(value, TIMEOUT_FIELD_SET, 'timeouts', `jobs[${index}].timeouts`, index, id, failures);
  validatePositiveNumber(value.local_seconds, 'timeouts.local_seconds', index, id, failures);
  validatePositiveNumber(value.ci_seconds, 'timeouts.ci_seconds', index, id, failures);
  validateRequiredString(value.source, 'timeouts.source', index, id, failures);
}

function validateSensitiveRetryAndCache(
  entry: Record<string, unknown>,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!isReleaseSensitiveJob(entry)) {
    return;
  }

  if (!RELEASE_SENSITIVE_RETRY_POLICIES.has(entry.retry as CurrentJobMetadataRetry)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].retry`,
      reason: 'backend-real/release/rehearsal jobs must not enable automatic retry.',
    });
  }
  if (!RELEASE_SENSITIVE_CACHE_POLICIES.has(entry.cache as CurrentJobMetadataCache)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].cache`,
      reason: 'backend-real/release/rehearsal jobs must not reuse cache across release or provider profiles.',
    });
  }
}

function isReleaseSensitiveJob(entry: Record<string, unknown>): boolean {
  const values = [
    entry.id,
    entry.gate_id,
    entry.campaign_id,
    entry.step_id,
    entry.npm_script,
    entry.command,
    entry.line_kind,
    ...(isRecord(entry.inputs) && Array.isArray(entry.inputs.env_profiles) ? entry.inputs.env_profiles : []),
    ...(Array.isArray(entry.locks) ? entry.locks : []),
  ];
  const joined = values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return joined.includes('backend-real')
    || joined.includes('backend_real')
    || joined.includes('release')
    || joined.includes('rehearsal')
    || joined.includes('provider-secret-profile')
    || joined.includes('backend-real-provider-quota');
}

function validateMirrorField(
  actual: unknown,
  expected: unknown,
  field: string,
  step: CurrentVerificationCampaignStep,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (actual !== expected) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: `${field} must mirror release-full step ${step.id}.`,
    });
  }
}

function validateMirrorArray(
  actual: unknown,
  expected: readonly string[],
  field: string,
  step: CurrentVerificationCampaignStep,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!Array.isArray(actual) || !stringArraysEqual(actual, expected)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: `${field} must mirror release-full step ${step.id}.`,
    });
  }
}

function validateMirrorInputs(
  actual: unknown,
  expected: CurrentJobMetadataInputs,
  step: CurrentVerificationCampaignStep,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!isRecord(actual)) {
    return;
  }

  if (
    !stringArrayValueEquals(actual.path_globs, expected.path_globs)
    || !stringArrayValueEquals(actual.env_profiles, expected.env_profiles)
    || !stringArrayValueEquals(actual.required_secret_names, expected.required_secret_names)
  ) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].inputs`,
      reason: `inputs must mirror release-full step ${step.id}.`,
    });
  }
}

function validateMirrorTimeouts(
  actual: unknown,
  expected: CurrentJobMetadataTimeouts,
  step: CurrentVerificationCampaignStep,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (!isRecord(actual)) {
    return;
  }

  if (
    actual.local_seconds !== expected.local_seconds
    || actual.ci_seconds !== expected.ci_seconds
    || actual.source !== expected.source
  ) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].timeouts`,
      reason: `timeouts must mirror release-full step ${step.id}.`,
    });
  }
}

function validateRequiredString(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: `${field} must be a non-empty string.`,
    });
  }
}

function validateBoolean(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof value !== 'boolean') {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: `${field} must be a boolean.`,
    });
  }
}

function validatePositiveNumber(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: `${field} must be a positive number.`,
    });
  }
}

function validateEnum(
  value: unknown,
  values: ReadonlySet<string>,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof value !== 'string' || !values.has(value)) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: `${field} must be one of: ${[...values].join(', ')}.`,
    });
  }
}

function validateStringArray(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
  customReason?: string,
): readonly string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    failures.push({
      index,
      id,
      path: `jobs[${index}].${field}`,
      reason: customReason ?? `${field} must be a string array.`,
    });
    return null;
  }
  return value;
}

function validateSecretNames(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  const names = validateStringArray(value, 'inputs.required_secret_names', index, id, failures);
  if (!names) {
    return;
  }

  names.forEach((name, nameIndex) => {
    if (!SECRET_NAME_PATTERN.test(name)) {
      failures.push({
        index,
        id,
        path: `jobs[${index}].inputs.required_secret_names[${nameIndex}]`,
        reason: 'required_secret_names must contain secret names only.',
      });
    }
  });
}

function validateForbiddenRuntimeFields(
  value: unknown,
  path: string,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateForbiddenRuntimeFields(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_RUNTIME_FIELDS.has(key)) {
      failures.push({
        index: -1,
        path: nestedPath,
        reason: `forbidden runtime field "${key}".`,
      });
    }
    validateForbiddenRuntimeFields(nested, nestedPath, failures);
  }
}

function validateNoSecretLookingValues(
  value: unknown,
  path: string,
  failures: CurrentJobMetadataManifestFailure[],
): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      failures.push({
        index: -1,
        path,
        reason: `secret-looking value is not allowed at ${path}.`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoSecretLookingValues(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    validateNoSecretLookingValues(nested, `${path}.${key}`, failures);
  }
}

function stringArraysEqual(left: readonly unknown[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function stringArrayValueEquals(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && stringArraysEqual(value, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
