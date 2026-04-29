import {
  buildCurrentArtifactTemplateIndex,
  CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
  CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
  type CurrentArtifactTemplateEntry,
} from './current-artifact-index-schema';
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
  findCurrentJobMetadataById,
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
  assertGovernanceRunGoal,
  isReleaseGovernanceRunGoal,
  selectGovernanceRunStandaloneJobIds,
  type GovernanceRunGoal,
} from './governance-run-goal-selector';
import {
  buildGovernanceDagSchedulerShadow,
  type GovernanceDagSchedulerShadow,
} from './governance-dag-scheduler';
export type { GovernanceRunGoal } from './governance-run-goal-selector';

export const GOVERNANCE_RUN_PLAN_SCHEMA = 'governance-runner-shell-plan.v1' as const;
export const GOVERNANCE_RUN_PLAN_VERSION = 1 as const;
export const GOVERNANCE_RUN_PLAN_FILE_NAME = 'governance-runner-shell-plan.json' as const;

export type GovernanceRunPlanMode = 'plan_only';
export type GovernanceRunAdapterScope = 'internal_adapter';

export interface GovernanceRunPlanInputCounts {
  path_glob_count: number;
  env_profile_count: number;
  required_secret_count: number;
}

export interface GovernanceRunPlanOutputCounts {
  expected_artifact_template_count: number;
}

export interface GovernanceRunPlanTimeouts {
  local_seconds: number;
  ci_seconds: number;
  source: string;
}

export interface GovernanceRunPlanJob {
  id: string;
  kind: CurrentJobMetadata['kind'];
  campaign_id: string | null;
  gate_id: string;
  step_id: string | null;
  npm_script: string;
  adapter_scope: GovernanceRunAdapterScope;
  aggregate_only: boolean;
  execution_mode: CurrentJobMetadata['execution_mode'];
  depends_on: readonly string[];
  lock_ids: readonly string[];
  timeouts: GovernanceRunPlanTimeouts;
  retry: CurrentJobMetadata['retry'];
  cache_policy: CurrentJobMetadata['cache'];
  required_secret_names: readonly string[];
  input_counts: GovernanceRunPlanInputCounts;
  output_counts: GovernanceRunPlanOutputCounts;
  expected_artifact_templates: readonly string[];
}

export interface GovernanceRunPlanEdge {
  from_job_id: string;
  to_job_id: string;
  relation: 'depends_on';
}

export interface GovernanceRunPlanLockOwnerCounts {
  gate_id_count: number;
  npm_script_count: number;
  command_surface_count: number;
}

export interface GovernanceRunPlanLockAppliesToCounts {
  gate_id_count: number;
  npm_script_count: number;
  runtime_line_count: number;
  path_count: number;
  port_count: number;
  provider_profile_count: number;
}

export interface GovernanceRunPlanLock {
  id: string;
  category: string;
  scope: CurrentResourceLockDefinition['scope'];
  mode: CurrentResourceLockDefinition['mode'];
  enforcement: CurrentResourceLockDefinition['enforcement'];
  owner_counts: GovernanceRunPlanLockOwnerCounts;
  applies_to_counts: GovernanceRunPlanLockAppliesToCounts;
}

export interface GovernanceRunPlanArtifactTemplate {
  template: string;
  kind: CurrentArtifactTemplateEntry['kind'];
  required_for: CurrentArtifactTemplateEntry['required_for'];
  producer_kind: CurrentArtifactTemplateEntry['producer']['kind'];
  producer_job_id: string;
  producer_gate_id: string;
  producer_step_id: string | null;
  producer_npm_script: string;
}

export interface GovernanceRunPlanInputManifests {
  current_job_metadata_manifest: {
    schema: typeof CURRENT_JOB_METADATA_MANIFEST_SCHEMA;
    version: typeof CURRENT_JOB_METADATA_MANIFEST_VERSION;
    job_count: number;
    selected_job_count: number;
  };
  current_resource_lock_manifest: {
    schema: typeof CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA;
    version: typeof CURRENT_RESOURCE_LOCK_MANIFEST_VERSION;
    lock_count: number;
    selected_lock_count: number;
  };
  current_evidence_claim_schema: {
    schema_version: typeof CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION;
    top_level_key_count: number;
    scope_count: number;
    validation_purpose_count: number;
    digest_format: (typeof CURRENT_EVIDENCE_CLAIM_SCHEMA)['digest_format'];
    claim_instances_included: false;
    claim_validation_executed: false;
    claims_created: false;
  };
  current_artifact_template_index: {
    schema: typeof CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA;
    version: typeof CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION;
    projection_kind: 'declared_template_index';
    artifact_directory_inspection: false;
    creates_evidence_claim: false;
    template_count: number;
    selected_template_count: number;
  };
}

export interface GovernanceRunPlan {
  schema: typeof GOVERNANCE_RUN_PLAN_SCHEMA;
  version: typeof GOVERNANCE_RUN_PLAN_VERSION;
  mode: GovernanceRunPlanMode;
  goal: GovernanceRunGoal;
  report_root: string;
  release_decision_produced: false;
  evidence_claims_created: false;
  artifact_directory_inspection: false;
  commands_executed: false;
  input_manifests: GovernanceRunPlanInputManifests;
  jobs: readonly GovernanceRunPlanJob[];
  edges: readonly GovernanceRunPlanEdge[];
  locks: readonly GovernanceRunPlanLock[];
  artifact_templates: readonly GovernanceRunPlanArtifactTemplate[];
  scheduler_shadow: GovernanceDagSchedulerShadow;
}

export interface BuildGovernanceRunPlanInput {
  goal: string;
  reportRoot: string;
  jobId?: string;
}

export interface GovernanceRunPlanValidationFailure {
  path: string;
  reason: string;
}

export type GovernanceRunPlanValidationResult =
  | {
      ok: true;
      value: GovernanceRunPlan;
    }
  | {
      ok: false;
      failures: readonly GovernanceRunPlanValidationFailure[];
    };

const TOP_LEVEL_FIELDS = [
  'schema',
  'version',
  'mode',
  'goal',
  'report_root',
  'release_decision_produced',
  'evidence_claims_created',
  'artifact_directory_inspection',
  'commands_executed',
  'input_manifests',
  'jobs',
  'edges',
  'locks',
  'artifact_templates',
  'scheduler_shadow',
] as const;

const FORBIDDEN_RUNTIME_KEYS = [
  'status',
  'exists',
  'passed',
  'failed',
  'run_id',
  'exit_code',
  'verdict',
  'claim_id',
  'claim_reuse',
  'cache_hit',
  'reusable',
  'failure_class',
  'artifact_digest',
  'result_digest',
  'input_digest',
  'campaign_root',
  'cache',
] as const;

const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const FORBIDDEN_RUNTIME_KEY_SET = new Set<string>(FORBIDDEN_RUNTIME_KEYS);
const SNAKE_CASE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const NESTED_ALLOWED_FIELD_SETS = new Map<string, ReadonlySet<string>>([
  [
    'plan.input_manifests',
    new Set([
      'current_job_metadata_manifest',
      'current_resource_lock_manifest',
      'current_evidence_claim_schema',
      'current_artifact_template_index',
    ]),
  ],
  [
    'plan.input_manifests.current_job_metadata_manifest',
    new Set(['schema', 'version', 'job_count', 'selected_job_count']),
  ],
  [
    'plan.input_manifests.current_resource_lock_manifest',
    new Set(['schema', 'version', 'lock_count', 'selected_lock_count']),
  ],
  [
    'plan.input_manifests.current_evidence_claim_schema',
    new Set([
      'schema_version',
      'top_level_key_count',
      'scope_count',
      'validation_purpose_count',
      'digest_format',
      'claim_instances_included',
      'claim_validation_executed',
      'claims_created',
    ]),
  ],
  [
    'plan.input_manifests.current_artifact_template_index',
    new Set([
      'schema',
      'version',
      'projection_kind',
      'artifact_directory_inspection',
      'creates_evidence_claim',
      'template_count',
      'selected_template_count',
    ]),
  ],
  [
    'plan.jobs[]',
    new Set([
      'id',
      'kind',
      'campaign_id',
      'gate_id',
      'step_id',
      'npm_script',
      'adapter_scope',
      'aggregate_only',
      'execution_mode',
      'depends_on',
      'lock_ids',
      'timeouts',
      'retry',
      'cache_policy',
      'required_secret_names',
      'input_counts',
      'output_counts',
      'expected_artifact_templates',
    ]),
  ],
  [
    'plan.jobs[].timeouts',
    new Set(['local_seconds', 'ci_seconds', 'source']),
  ],
  [
    'plan.jobs[].input_counts',
    new Set(['path_glob_count', 'env_profile_count', 'required_secret_count']),
  ],
  [
    'plan.jobs[].output_counts',
    new Set(['expected_artifact_template_count']),
  ],
  [
    'plan.edges[]',
    new Set(['from_job_id', 'to_job_id', 'relation']),
  ],
  [
    'plan.locks[]',
    new Set(['id', 'category', 'scope', 'mode', 'enforcement', 'owner_counts', 'applies_to_counts']),
  ],
  [
    'plan.locks[].owner_counts',
    new Set(['gate_id_count', 'npm_script_count', 'command_surface_count']),
  ],
  [
    'plan.locks[].applies_to_counts',
    new Set(['gate_id_count', 'npm_script_count', 'runtime_line_count', 'path_count', 'port_count', 'provider_profile_count']),
  ],
  [
    'plan.artifact_templates[]',
    new Set([
      'template',
      'kind',
      'required_for',
      'producer_kind',
      'producer_job_id',
      'producer_gate_id',
      'producer_step_id',
      'producer_npm_script',
    ]),
  ],
  [
    'plan.scheduler_shadow',
    new Set([
      'execution_policy',
      'execution_enabled',
      'max_concurrency_effective',
      'topology_levels',
      'parallel_candidates',
      'terminal_aggregate',
    ]),
  ],
  [
    'plan.scheduler_shadow.topology_levels[]',
    new Set(['level_index', 'job_ids']),
  ],
  [
    'plan.scheduler_shadow.parallel_candidates[]',
    new Set([
      'level_index',
      'candidate_job_ids',
      'runnable_without_lock_conflicts',
      'reason',
      'blocked_by_lock',
    ]),
  ],
  [
    'plan.scheduler_shadow.parallel_candidates[].blocked_by_lock[]',
    new Set(['lock_id', 'job_ids', 'reason']),
  ],
  [
    'plan.scheduler_shadow.terminal_aggregate',
    new Set(['job_id', 'aggregate_only', 'waits_for_job_ids']),
  ],
]);

function inputCounts(job: CurrentJobMetadata): GovernanceRunPlanInputCounts {
  return {
    path_glob_count: job.inputs.path_globs.length,
    env_profile_count: job.inputs.env_profiles.length,
    required_secret_count: job.inputs.required_secret_names.length,
  };
}

function outputCounts(job: CurrentJobMetadata): GovernanceRunPlanOutputCounts {
  return {
    expected_artifact_template_count: job.outputs.expected_artifact_path_templates.length,
  };
}

function projectJob(job: CurrentJobMetadata): GovernanceRunPlanJob {
  return {
    id: job.id,
    kind: job.kind,
    campaign_id: job.campaign_id ?? null,
    gate_id: job.gate_id,
    step_id: job.step_id ?? null,
    npm_script: job.npm_script,
    adapter_scope: 'internal_adapter',
    aggregate_only: job.execution_mode === 'aggregate_only',
    execution_mode: job.execution_mode,
    depends_on: [...job.depends_on],
    lock_ids: [...job.locks],
    timeouts: {
      local_seconds: job.timeouts.local_seconds,
      ci_seconds: job.timeouts.ci_seconds,
      source: job.timeouts.source,
    },
    retry: job.retry,
    cache_policy: job.cache,
    required_secret_names: [...job.inputs.required_secret_names],
    input_counts: inputCounts(job),
    output_counts: outputCounts(job),
    expected_artifact_templates: [...job.outputs.expected_artifact_path_templates],
  };
}

function projectEdges(jobs: readonly CurrentJobMetadata[]): readonly GovernanceRunPlanEdge[] {
  return jobs.flatMap((job) => job.depends_on.map((dependency) => ({
    from_job_id: dependency,
    to_job_id: job.id,
    relation: 'depends_on' as const,
  })));
}

function lockOwnerCounts(lock: CurrentResourceLockDefinition): GovernanceRunPlanLockOwnerCounts {
  return {
    gate_id_count: lock.owners.gateIds?.length ?? 0,
    npm_script_count: lock.owners.npmScripts?.length ?? 0,
    command_surface_count: lock.owners.commandSurfaces?.length ?? 0,
  };
}

function lockAppliesToCounts(lock: CurrentResourceLockDefinition): GovernanceRunPlanLockAppliesToCounts {
  return {
    gate_id_count: lock.appliesTo.gateIds?.length ?? 0,
    npm_script_count: lock.appliesTo.npmScripts?.length ?? 0,
    runtime_line_count: lock.appliesTo.runtimeLines?.length ?? 0,
    path_count: lock.appliesTo.paths?.length ?? 0,
    port_count: lock.appliesTo.ports?.length ?? 0,
    provider_profile_count: lock.appliesTo.providerProfiles?.length ?? 0,
  };
}

function projectLock(lock: CurrentResourceLockDefinition): GovernanceRunPlanLock {
  return {
    id: lock.id,
    category: lock.category,
    scope: lock.scope,
    mode: lock.mode,
    enforcement: lock.enforcement,
    owner_counts: lockOwnerCounts(lock),
    applies_to_counts: lockAppliesToCounts(lock),
  };
}

function projectArtifactTemplate(template: CurrentArtifactTemplateEntry): GovernanceRunPlanArtifactTemplate {
  return {
    template: template.template,
    kind: template.kind,
    required_for: [...template.required_for],
    producer_kind: template.producer.kind,
    producer_job_id: template.producer.job_id,
    producer_gate_id: template.producer.gate_id,
    producer_step_id: template.producer.step_id,
    producer_npm_script: template.producer.npm_script,
  };
}

function buildSchedulerShadow(
  jobs: readonly CurrentJobMetadata[],
  locks: readonly CurrentResourceLockDefinition[],
): GovernanceDagSchedulerShadow {
  const selectedJobIds = new Set(jobs.map((job) => job.id));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const selectedDependencyClosureCache = new Map<string, boolean>();
  // Partial plans cannot assume omitted upstream jobs are already satisfied.
  const shadowJobs = jobs
    .filter((job) => jobHasSelectedDependencyClosure({
      jobId: job.id,
      jobsById,
      selectedJobIds,
      cache: selectedDependencyClosureCache,
      visiting: new Set<string>(),
    }))
    .map((job) => ({
      id: job.id,
      dependsOn: [...job.depends_on],
      executionMode: job.execution_mode,
      lockIds: [...job.locks],
    }));

  return buildGovernanceDagSchedulerShadow({
    jobs: shadowJobs,
    locks: locks.map((lock) => ({
      id: lock.id,
      mode: lock.mode,
      reason: lock.reason,
    })),
    maxConcurrencyEffective: 1,
  });
}

function jobHasSelectedDependencyClosure(input: {
  jobId: string;
  jobsById: ReadonlyMap<string, CurrentJobMetadata>;
  selectedJobIds: ReadonlySet<string>;
  cache: Map<string, boolean>;
  visiting: Set<string>;
}): boolean {
  const cached = input.cache.get(input.jobId);
  if (cached !== undefined) {
    return cached;
  }

  const job = input.jobsById.get(input.jobId);
  if (!job) {
    return false;
  }

  if (input.visiting.has(input.jobId)) {
    return true;
  }

  input.visiting.add(input.jobId);
  const hasSelectedClosure = job.depends_on.every((dependencyId) => {
    if (!input.selectedJobIds.has(dependencyId)) {
      return false;
    }

    return jobHasSelectedDependencyClosure({
      ...input,
      jobId: dependencyId,
    });
  });
  input.visiting.delete(input.jobId);
  input.cache.set(input.jobId, hasSelectedClosure);

  return hasSelectedClosure;
}

function selectJobs(goal: GovernanceRunGoal, jobId: string | undefined): readonly CurrentJobMetadata[] {
  const selectedJobIds = isReleaseGovernanceRunGoal(goal)
    ? listCurrentJobMetadata()
      .filter((job) => job.kind === 'campaign_step' && job.campaign_id === 'release-full')
      .map((job) => job.id)
    : selectGovernanceRunStandaloneJobIds(goal);
  const selectedJobIdSet = new Set(selectedJobIds);

  if (!jobId) {
    return selectedJobIds.map((id) => {
      const job = findCurrentJobMetadataById(id);
      if (!job) {
        throw new Error(`current job metadata is missing selected job id: ${id}`);
      }
      return job;
    });
  }

  const job = findCurrentJobMetadataById(jobId);
  if (!job) {
    throw new Error(`unknown current job id: ${jobId}`);
  }
  if (!selectedJobIdSet.has(job.id)) {
    throw new Error(`current job id ${jobId} is not selectable for governance run goal ${goal}.`);
  }
  return [job];
}

function selectedLocks(jobs: readonly CurrentJobMetadata[]): readonly CurrentResourceLockDefinition[] {
  const selectedLockIds = new Set(jobs.flatMap((job) => job.locks));

  return listCurrentResourceLocks().filter((lock) => selectedLockIds.has(lock.id));
}

export function buildGovernanceRunPlan(input: BuildGovernanceRunPlanInput): GovernanceRunPlan {
  assertGovernanceRunGoal(input.goal);
  const allJobs = listCurrentJobMetadata();
  const jobs = selectJobs(input.goal, input.jobId);
  const locks = selectedLocks(jobs);
  const artifactTemplateIndex = buildCurrentArtifactTemplateIndex({ jobs });
  const fullArtifactTemplateIndex = buildCurrentArtifactTemplateIndex({ jobs: allJobs });

  return {
    schema: GOVERNANCE_RUN_PLAN_SCHEMA,
    version: GOVERNANCE_RUN_PLAN_VERSION,
    mode: 'plan_only',
    goal: input.goal,
    report_root: input.reportRoot,
    release_decision_produced: false,
    evidence_claims_created: false,
    artifact_directory_inspection: false,
    commands_executed: false,
    input_manifests: {
      current_job_metadata_manifest: {
        schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
        version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
        job_count: allJobs.length,
        selected_job_count: jobs.length,
      },
      current_resource_lock_manifest: {
        schema: CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA,
        version: CURRENT_RESOURCE_LOCK_MANIFEST_VERSION,
        lock_count: listCurrentResourceLocks().length,
        selected_lock_count: locks.length,
      },
      current_evidence_claim_schema: {
        schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
        top_level_key_count: CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS.length,
        scope_count: CURRENT_EVIDENCE_CLAIM_SCOPES.length,
        validation_purpose_count: CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES.length,
        digest_format: CURRENT_EVIDENCE_CLAIM_SCHEMA.digest_format,
        claim_instances_included: false,
        claim_validation_executed: false,
        claims_created: false,
      },
      current_artifact_template_index: {
        schema: CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
        version: CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
        projection_kind: 'declared_template_index',
        artifact_directory_inspection: false,
        creates_evidence_claim: false,
        template_count: fullArtifactTemplateIndex.summary.template_count,
        selected_template_count: artifactTemplateIndex.summary.template_count,
      },
    },
    jobs: jobs.map(projectJob),
    edges: projectEdges(jobs),
    locks: locks.map(projectLock),
    artifact_templates: artifactTemplateIndex.templates.map(projectArtifactTemplate),
    scheduler_shadow: buildSchedulerShadow(jobs, locks),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePlanPath(path: string): string {
  return path.replaceAll(/\[\d+\]/g, '[]');
}

function validateNoForbiddenRuntimeKeys(
  value: unknown,
  path: string,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoForbiddenRuntimeKeys(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RUNTIME_KEY_SET.has(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `forbidden runtime key "${key}" is not allowed in a shell plan.`,
      });
    }
    validateNoForbiddenRuntimeKeys(nested, `${path}.${key}`, failures);
  }
}

function validateSnakeCaseKeys(
  value: unknown,
  path: string,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSnakeCaseKeys(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (!SNAKE_CASE_KEY_PATTERN.test(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: 'plan keys must be snake_case.',
      });
    }
    validateSnakeCaseKeys(nested, `${path}.${key}`, failures);
  }
}

function validateTopLevelFields(
  plan: Record<string, unknown>,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in plan)) {
      failures.push({
        path: `plan.${field}`,
        reason: `${field} is required.`,
      });
    }
  }

  for (const field of Object.keys(plan)) {
    if (!TOP_LEVEL_FIELD_SET.has(field)) {
      failures.push({
        path: `plan.${field}`,
        reason: `unknown top-level field "${field}".`,
      });
    }
  }
}

function validateNestedAllowedFields(
  value: unknown,
  path: string,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  const normalizedPath = normalizePlanPath(path);
  const allowedFields = NESTED_ALLOWED_FIELD_SETS.get(normalizedPath);
  if (normalizedPath === 'plan.scheduler_shadow.terminal_aggregate' && value === null) {
    return;
  }
  if (allowedFields && !isRecord(value)) {
    failures.push({
      path,
      reason: `${path} must be an object.`,
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNestedAllowedFields(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  if (!allowedFields) {
    failures.push({
      path,
      reason: 'unexpected nested object in shell plan.',
    });
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (!allowedFields.has(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `unknown nested field "${key}" is not allowed in a shell plan.`,
      });
    }
    validateNestedAllowedFields(nested, `${path}.${key}`, failures);
  }
}

function validateLiteral(
  actual: unknown,
  expected: unknown,
  path: string,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  if (actual !== expected) {
    failures.push({
      path,
      reason: `${path} must be ${String(expected)}.`,
    });
  }
}

function validateArray(
  value: unknown,
  path: string,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    failures.push({
      path,
      reason: `${path} must be an array.`,
    });
  }
}

function validateEvidenceClaimSchemaBoundary(
  value: unknown,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  if (!isRecord(value)) {
    return;
  }

  validateLiteral(
    value.claim_instances_included,
    false,
    'plan.input_manifests.current_evidence_claim_schema.claim_instances_included',
    failures,
  );
  validateLiteral(
    value.claim_validation_executed,
    false,
    'plan.input_manifests.current_evidence_claim_schema.claim_validation_executed',
    failures,
  );
  validateLiteral(
    value.claims_created,
    false,
    'plan.input_manifests.current_evidence_claim_schema.claims_created',
    failures,
  );
}

function validateSchedulerShadowBoundary(
  value: unknown,
  failures: GovernanceRunPlanValidationFailure[],
): void {
  if (!isRecord(value)) {
    return;
  }

  validateLiteral(
    value.execution_policy,
    'plan_only_shadow',
    'plan.scheduler_shadow.execution_policy',
    failures,
  );
  validateLiteral(
    value.execution_enabled,
    false,
    'plan.scheduler_shadow.execution_enabled',
    failures,
  );
  validateLiteral(
    value.max_concurrency_effective,
    1,
    'plan.scheduler_shadow.max_concurrency_effective',
    failures,
  );
}

export function validateGovernanceRunPlan(plan: unknown): GovernanceRunPlanValidationResult {
  const failures: GovernanceRunPlanValidationFailure[] = [];

  validateNoForbiddenRuntimeKeys(plan, 'plan', failures);
  validateSnakeCaseKeys(plan, 'plan', failures);

  if (!isRecord(plan)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          path: 'plan',
          reason: 'plan must be an object.',
        },
      ],
    };
  }

  validateTopLevelFields(plan, failures);
  validateNestedAllowedFields(plan.input_manifests, 'plan.input_manifests', failures);
  validateNestedAllowedFields(plan.jobs, 'plan.jobs', failures);
  validateNestedAllowedFields(plan.edges, 'plan.edges', failures);
  validateNestedAllowedFields(plan.locks, 'plan.locks', failures);
  validateNestedAllowedFields(plan.artifact_templates, 'plan.artifact_templates', failures);
  validateNestedAllowedFields(plan.scheduler_shadow, 'plan.scheduler_shadow', failures);
  validateEvidenceClaimSchemaBoundary(
    isRecord(plan.input_manifests)
      ? plan.input_manifests.current_evidence_claim_schema
      : undefined,
    failures,
  );
  validateSchedulerShadowBoundary(plan.scheduler_shadow, failures);
  validateLiteral(plan.schema, GOVERNANCE_RUN_PLAN_SCHEMA, 'plan.schema', failures);
  validateLiteral(plan.version, GOVERNANCE_RUN_PLAN_VERSION, 'plan.version', failures);
  validateLiteral(plan.mode, 'plan_only', 'plan.mode', failures);
  if (typeof plan.goal !== 'string') {
    failures.push({
      path: 'plan.goal',
      reason: 'plan.goal must be a current governance run goal.',
    });
  } else {
    try {
      assertGovernanceRunGoal(plan.goal);
    } catch {
      failures.push({
        path: 'plan.goal',
        reason: 'plan.goal must be a current governance run goal.',
      });
    }
  }
  validateLiteral(plan.release_decision_produced, false, 'plan.release_decision_produced', failures);
  validateLiteral(plan.evidence_claims_created, false, 'plan.evidence_claims_created', failures);
  validateLiteral(plan.artifact_directory_inspection, false, 'plan.artifact_directory_inspection', failures);
  validateLiteral(plan.commands_executed, false, 'plan.commands_executed', failures);
  validateArray(plan.jobs, 'plan.jobs', failures);
  validateArray(plan.edges, 'plan.edges', failures);
  validateArray(plan.locks, 'plan.locks', failures);
  validateArray(plan.artifact_templates, 'plan.artifact_templates', failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: plan as GovernanceRunPlan,
  };
}

export function renderGovernanceRunPlanSummary(plan: GovernanceRunPlan, outputPath: string): string {
  return [
    'Governance runner shell plan',
    `Goal: ${plan.goal}`,
    `Mode: ${plan.mode}`,
    `Report root: ${plan.report_root}`,
    `Jobs: ${plan.jobs.length}`,
    `Commands executed: ${String(plan.commands_executed)}`,
    `Release decision produced: ${String(plan.release_decision_produced)}`,
    `Plan file: ${outputPath}`,
    '',
  ].join('\n');
}
