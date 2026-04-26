import {
  validateCurrentEvidenceClaim,
  type CurrentEvidenceClaimRecord,
  type CurrentEvidenceClaimValidationPurpose,
} from './current-evidence-claim-schema';
import type {
  CurrentGateResultFailureClass,
  CurrentGateResultStatus,
} from './current-gate-result-schema';
import type { GovernanceRunPlan } from './governance-run-plan';

export const GOVERNANCE_RUN_STATE_SCHEMA = 'governance-run-state.v1' as const;
export const GOVERNANCE_RUN_STATE_VERSION = 1 as const;
export const GOVERNANCE_RESUME_PLAN_SCHEMA = 'governance-resume-plan.v1' as const;
export const GOVERNANCE_RESUME_PLAN_VERSION = 1 as const;

export type GovernanceDigest = string;
export type GovernanceRunJobLifecycle = 'planned' | 'running' | 'completed' | 'failed' | 'skipped';
export type GovernanceRunAttemptLifecycle = 'running' | 'completed' | 'failed' | 'abandoned';
export type GovernanceRunLockLeaseMode = 'exclusive' | 'shared_read';
export type GovernanceResumeNextAction =
  | 'reuse_claim'
  | 'rerun_required'
  | 'blocked_by_upstream'
  | 'invalidated';

export interface GovernanceRunCampaignIdentity {
  campaign_id: string;
  campaign_root: string;
  run_id: string;
}

export interface GovernanceRunFingerprints {
  run_plan_digest: GovernanceDigest;
  manifest_digest: GovernanceDigest;
}

export interface GovernanceRunAttemptRef {
  attempt_id: string;
  lifecycle: GovernanceRunAttemptLifecycle;
  started_at: string;
  finished_at: string | null;
}

export interface GovernanceRunLockLease {
  lock_id: string;
  scope_key: string;
  owner_attempt_id: string;
  mode: GovernanceRunLockLeaseMode;
}

export interface GovernanceRunResultRef {
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  result_digest: GovernanceDigest | null;
}

export interface GovernanceRunEvidenceRef {
  evidence_dir: string;
  artifact_digest: GovernanceDigest | null;
}

export interface GovernanceRunClaimRef {
  claim_id: string;
  claim_digest: GovernanceDigest | null;
  evidence_dir: string;
  input_digest: GovernanceDigest | null;
  artifact_digest: GovernanceDigest | null;
  result_digest: GovernanceDigest | null;
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  secret_profile_digest: GovernanceDigest | null;
}

export interface GovernanceRunStateJob {
  job_id: string;
  gate_id: string;
  step_id: string | null;
  line_kind: string;
  lifecycle: GovernanceRunJobLifecycle;
  attempts: readonly GovernanceRunAttemptRef[];
  lock_leases: readonly GovernanceRunLockLease[];
  result_ref: GovernanceRunResultRef | null;
  evidence_ref: GovernanceRunEvidenceRef | null;
  claim_ref: GovernanceRunClaimRef | null;
}

export interface GovernanceRunState {
  schema: typeof GOVERNANCE_RUN_STATE_SCHEMA;
  version: typeof GOVERNANCE_RUN_STATE_VERSION;
  campaign: GovernanceRunCampaignIdentity;
  fingerprints: GovernanceRunFingerprints;
  jobs: readonly GovernanceRunStateJob[];
}

export interface GovernanceCurrentManifestJob {
  job_id: string;
  gate_id: string;
  step_id: string | null;
  line_kind: string;
  secret_profile_digest: GovernanceDigest | null;
}

export interface GovernanceCurrentManifestResumeInput {
  run_plan_digest: GovernanceDigest;
  manifest_digest: GovernanceDigest;
  jobs: readonly GovernanceCurrentManifestJob[];
}

export interface GovernanceEvidenceClaimValidationInput {
  job_id: string;
  claim_id: string;
  purpose: Extract<CurrentEvidenceClaimValidationPurpose, 'reuse'>;
  claim: unknown;
}

export interface GovernanceResumePlanInput {
  run_plan: GovernanceRunPlan;
  run_state: GovernanceRunState;
  current_manifests: GovernanceCurrentManifestResumeInput;
  claim_validation_inputs: readonly GovernanceEvidenceClaimValidationInput[];
}

export interface GovernanceResumePlanClaimRef {
  claim_id: string;
  claim_digest: GovernanceDigest | null;
  evidence_dir: string;
  input_digest: GovernanceDigest;
  artifact_digest: GovernanceDigest;
  result_digest: GovernanceDigest;
}

export interface GovernanceResumePlanJob {
  job_id: string;
  gate_id: string;
  step_id: string | null;
  line_kind: string;
  next_action: GovernanceResumeNextAction;
  reason_codes: readonly string[];
  upstream_job_ids: readonly string[];
  claim_ref: GovernanceResumePlanClaimRef | null;
}

export interface GovernanceResumePlan {
  schema: typeof GOVERNANCE_RESUME_PLAN_SCHEMA;
  version: typeof GOVERNANCE_RESUME_PLAN_VERSION;
  campaign: GovernanceRunCampaignIdentity;
  fingerprints: GovernanceRunFingerprints;
  jobs: readonly GovernanceResumePlanJob[];
}

export interface GovernanceRunModelValidationFailure {
  path: string;
  reason: string;
}

export type GovernanceRunStateValidationResult =
  | {
      ok: true;
      value: GovernanceRunState;
    }
  | {
      ok: false;
      failures: readonly GovernanceRunModelValidationFailure[];
    };

export type GovernanceResumePlanValidationResult =
  | {
      ok: true;
      value: GovernanceResumePlan;
    }
  | {
      ok: false;
      failures: readonly GovernanceRunModelValidationFailure[];
    };

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const FORBIDDEN_SECOND_TRUTH_FIELDS = new Set<string>([
  'verdict',
  'release_verdict',
  'automated_release_verdict',
  'release_decision',
  'commands_executed',
  'cache_hit',
  'claim_reuse',
]);

const STATE_ALLOWED_FIELD_SETS = new Map<string, ReadonlySet<string>>([
  ['state', new Set(['schema', 'version', 'campaign', 'fingerprints', 'jobs'])],
  ['state.campaign', new Set(['campaign_id', 'campaign_root', 'run_id'])],
  ['state.fingerprints', new Set(['run_plan_digest', 'manifest_digest'])],
  [
    'state.jobs[]',
    new Set([
      'job_id',
      'gate_id',
      'step_id',
      'line_kind',
      'lifecycle',
      'attempts',
      'lock_leases',
      'result_ref',
      'evidence_ref',
      'claim_ref',
    ]),
  ],
  ['state.jobs[].attempts[]', new Set(['attempt_id', 'lifecycle', 'started_at', 'finished_at'])],
  ['state.jobs[].lock_leases[]', new Set(['lock_id', 'scope_key', 'owner_attempt_id', 'mode'])],
  ['state.jobs[].result_ref', new Set(['result_status', 'failure_class', 'result_digest'])],
  ['state.jobs[].evidence_ref', new Set(['evidence_dir', 'artifact_digest'])],
  [
    'state.jobs[].claim_ref',
    new Set([
      'claim_id',
      'claim_digest',
      'evidence_dir',
      'input_digest',
      'artifact_digest',
      'result_digest',
      'result_status',
      'failure_class',
      'secret_profile_digest',
    ]),
  ],
]);

const RESUME_ALLOWED_FIELD_SETS = new Map<string, ReadonlySet<string>>([
  ['resume_plan', new Set(['schema', 'version', 'campaign', 'fingerprints', 'jobs'])],
  ['resume_plan.campaign', new Set(['campaign_id', 'campaign_root', 'run_id'])],
  ['resume_plan.fingerprints', new Set(['run_plan_digest', 'manifest_digest'])],
  [
    'resume_plan.jobs[]',
    new Set([
      'job_id',
      'gate_id',
      'step_id',
      'line_kind',
      'next_action',
      'reason_codes',
      'upstream_job_ids',
      'claim_ref',
    ]),
  ],
  [
    'resume_plan.jobs[].claim_ref',
    new Set([
      'claim_id',
      'claim_digest',
      'evidence_dir',
      'input_digest',
      'artifact_digest',
      'result_digest',
    ]),
  ],
]);

const RUN_JOB_LIFECYCLES = new Set<string>(['planned', 'running', 'completed', 'failed', 'skipped']);
const ATTEMPT_LIFECYCLES = new Set<string>(['running', 'completed', 'failed', 'abandoned']);
const LOCK_LEASE_MODES = new Set<string>(['exclusive', 'shared_read']);
const RESULT_STATUSES = new Set<string>(['passed', 'failed']);
const FAILURE_CLASSES = new Set<string>([
  'none',
  'product_regression',
  'infra_setup_failure',
  'environment_conflict',
  'contract_drift',
  'evidence_missing',
]);
const RESUME_ACTIONS = new Set<string>([
  'reuse_claim',
  'rerun_required',
  'blocked_by_upstream',
  'invalidated',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeSchemaPath(path: string): string {
  return path.replaceAll(/\[\d+\]/g, '[]');
}

function pushFailure(
  failures: GovernanceRunModelValidationFailure[],
  path: string,
  reason: string,
): void {
  failures.push({ path, reason });
}

function validateForbiddenFields(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateForbiddenFields(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SECOND_TRUTH_FIELDS.has(key)) {
      pushFailure(
        failures,
        `${path}.${key}`,
        `forbidden field "${key}" would create a second release truth or execution/cache decision.`,
      );
    }
    validateForbiddenFields(nested, `${path}.${key}`, failures);
  }
}

function validateKnownFields(
  value: unknown,
  path: string,
  allowedFieldSets: ReadonlyMap<string, ReadonlySet<string>>,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateKnownFields(entry, `${path}[${index}]`, allowedFieldSets, failures);
    });
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const normalizedPath = normalizeSchemaPath(path);
  const allowedFields = allowedFieldSets.get(normalizedPath);
  if (!allowedFields) {
    pushFailure(failures, path, 'unexpected nested object.');
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (!allowedFields.has(key)) {
      pushFailure(failures, `${path}.${key}`, `unknown field "${key}".`);
    }
    validateKnownFields(nested, `${path}.${key}`, allowedFieldSets, failures);
  }
}

function validateRequiredFields(
  record: Record<string, unknown>,
  path: string,
  requiredFields: readonly string[],
  failures: GovernanceRunModelValidationFailure[],
): void {
  for (const field of requiredFields) {
    if (!hasOwn(record, field)) {
      pushFailure(failures, `${path}.${field}`, `${field} is required.`);
    }
  }
}

function validateString(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushFailure(failures, path, `${path} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function validateNullableString(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): string | null | undefined {
  if (value === null) {
    return null;
  }
  return validateString(value, path, failures);
}

function validateDigest(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
  options: { nullable: boolean },
): string | null | undefined {
  if (value === null && options.nullable) {
    return null;
  }
  const digest = validateString(value, path, failures);
  if (digest !== undefined && !SHA256_DIGEST_PATTERN.test(digest)) {
    pushFailure(failures, path, `${path} must use sha256:<64 lowercase hex>.`);
  }
  return digest;
}

function validateLiteral(
  actual: unknown,
  expected: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (actual !== expected) {
    pushFailure(failures, path, `${path} must be ${String(expected)}.`);
  }
}

function validateEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): string | undefined {
  const stringValue = validateString(value, path, failures);
  if (stringValue !== undefined && !allowed.has(stringValue)) {
    pushFailure(failures, path, `${path} is not a supported value.`);
  }
  return stringValue;
}

function validateResultFailureBinding(
  resultStatus: string | undefined,
  failureClass: string | undefined,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (resultStatus === 'passed' && failureClass !== undefined && failureClass !== 'none') {
    pushFailure(failures, `${path}.failure_class`, 'passed result must use failure_class none.');
  }
  if (resultStatus === 'failed' && failureClass === 'none') {
    pushFailure(failures, `${path}.failure_class`, 'failed result must use a non-none failure_class.');
  }
}

function validateArray(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    pushFailure(failures, path, `${path} must be an array.`);
    return undefined;
  }
  return value;
}

function normalizePathSegments(value: string): { absolute: boolean; path: string } {
  const normalizedSlashes = value.replaceAll('\\', '/');
  const absolute = normalizedSlashes.startsWith('/');
  const segments: string[] = [];

  for (const segment of normalizedSlashes.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      const previous = segments.at(-1);
      if (previous && previous !== '..') {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  return {
    absolute,
    path: `${absolute ? '/' : ''}${segments.join('/')}`.replace(/\/$/, ''),
  };
}

function pathIsInsideRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePathSegments(candidate);
  const normalizedRoot = normalizePathSegments(root);
  const candidatePath = normalizedCandidate.path;
  const rootPath = normalizedRoot.path;

  if (
    candidatePath.length === 0
    || rootPath.length === 0
    || normalizedCandidate.absolute !== normalizedRoot.absolute
  ) {
    return false;
  }

  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function pathsEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizePathSegments(left);
  const normalizedRight = normalizePathSegments(right);

  return normalizedLeft.absolute === normalizedRight.absolute
    && normalizedLeft.path === normalizedRight.path
    && normalizedLeft.path.length > 0;
}

function validateCampaignIdentity(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): GovernanceRunCampaignIdentity | undefined {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return undefined;
  }

  validateRequiredFields(value, path, ['campaign_id', 'campaign_root', 'run_id'], failures);
  const campaignId = validateString(value.campaign_id, `${path}.campaign_id`, failures);
  const campaignRoot = validateString(value.campaign_root, `${path}.campaign_root`, failures);
  const runId = validateString(value.run_id, `${path}.run_id`, failures);

  if (campaignId === undefined || campaignRoot === undefined || runId === undefined) {
    return undefined;
  }

  return {
    campaign_id: campaignId,
    campaign_root: campaignRoot,
    run_id: runId,
  };
}

function validateFingerprints(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): GovernanceRunFingerprints | undefined {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return undefined;
  }

  validateRequiredFields(value, path, ['run_plan_digest', 'manifest_digest'], failures);
  const runPlanDigest = validateDigest(value.run_plan_digest, `${path}.run_plan_digest`, failures, {
    nullable: false,
  });
  const manifestDigest = validateDigest(value.manifest_digest, `${path}.manifest_digest`, failures, {
    nullable: false,
  });

  if (runPlanDigest === undefined || manifestDigest === undefined) {
    return undefined;
  }

  return {
    run_plan_digest: runPlanDigest,
    manifest_digest: manifestDigest,
  };
}

function validateAttempts(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): void {
  const attempts = validateArray(value, path, failures);
  if (!attempts) {
    return;
  }

  attempts.forEach((attempt, index) => {
    const attemptPath = `${path}[${index}]`;
    if (!isRecord(attempt)) {
      pushFailure(failures, attemptPath, `${attemptPath} must be an object.`);
      return;
    }
    validateRequiredFields(attempt, attemptPath, ['attempt_id', 'lifecycle', 'started_at', 'finished_at'], failures);
    validateString(attempt.attempt_id, `${attemptPath}.attempt_id`, failures);
    validateEnum(attempt.lifecycle, ATTEMPT_LIFECYCLES, `${attemptPath}.lifecycle`, failures);
    validateString(attempt.started_at, `${attemptPath}.started_at`, failures);
    validateNullableString(attempt.finished_at, `${attemptPath}.finished_at`, failures);
  });
}

function validateLockLeases(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): void {
  const leases = validateArray(value, path, failures);
  if (!leases) {
    return;
  }

  leases.forEach((lease, index) => {
    const leasePath = `${path}[${index}]`;
    if (!isRecord(lease)) {
      pushFailure(failures, leasePath, `${leasePath} must be an object.`);
      return;
    }
    validateRequiredFields(lease, leasePath, ['lock_id', 'scope_key', 'owner_attempt_id', 'mode'], failures);
    validateString(lease.lock_id, `${leasePath}.lock_id`, failures);
    validateString(lease.scope_key, `${leasePath}.scope_key`, failures);
    validateString(lease.owner_attempt_id, `${leasePath}.owner_attempt_id`, failures);
    validateEnum(lease.mode, LOCK_LEASE_MODES, `${leasePath}.mode`, failures);
  });
}

function validateResultRef(
  value: unknown,
  path: string,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be null or an object.`);
    return;
  }

  validateRequiredFields(value, path, ['result_status', 'failure_class', 'result_digest'], failures);
  const resultStatus = validateEnum(value.result_status, RESULT_STATUSES, `${path}.result_status`, failures);
  const failureClass = validateEnum(value.failure_class, FAILURE_CLASSES, `${path}.failure_class`, failures);
  validateResultFailureBinding(resultStatus, failureClass, path, failures);
  validateDigest(value.result_digest, `${path}.result_digest`, failures, { nullable: true });
}

function validateEvidenceRef(
  value: unknown,
  path: string,
  campaignRoot: string | undefined,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be null or an object.`);
    return;
  }

  validateRequiredFields(value, path, ['evidence_dir', 'artifact_digest'], failures);
  const evidenceDir = validateString(value.evidence_dir, `${path}.evidence_dir`, failures);
  validateDigest(value.artifact_digest, `${path}.artifact_digest`, failures, { nullable: true });
  if (
    campaignRoot !== undefined
    && evidenceDir !== undefined
    && !pathIsInsideRoot(evidenceDir, campaignRoot)
  ) {
    pushFailure(failures, `${path}.evidence_dir`, 'evidence_dir must stay within campaign_root.');
  }
}

function validateClaimRef(
  value: unknown,
  path: string,
  campaignRoot: string | undefined,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be null or an object.`);
    return;
  }

  validateRequiredFields(
    value,
    path,
    [
      'claim_id',
      'claim_digest',
      'evidence_dir',
      'input_digest',
      'artifact_digest',
      'result_digest',
      'result_status',
      'failure_class',
      'secret_profile_digest',
    ],
    failures,
  );
  validateString(value.claim_id, `${path}.claim_id`, failures);
  validateDigest(value.claim_digest, `${path}.claim_digest`, failures, { nullable: true });
  const evidenceDir = validateString(value.evidence_dir, `${path}.evidence_dir`, failures);
  validateDigest(value.input_digest, `${path}.input_digest`, failures, { nullable: true });
  validateDigest(value.artifact_digest, `${path}.artifact_digest`, failures, { nullable: true });
  validateDigest(value.result_digest, `${path}.result_digest`, failures, { nullable: true });
  const resultStatus = validateEnum(value.result_status, RESULT_STATUSES, `${path}.result_status`, failures);
  const failureClass = validateEnum(value.failure_class, FAILURE_CLASSES, `${path}.failure_class`, failures);
  validateResultFailureBinding(resultStatus, failureClass, path, failures);
  validateDigest(value.secret_profile_digest, `${path}.secret_profile_digest`, failures, { nullable: true });
  if (
    campaignRoot !== undefined
    && evidenceDir !== undefined
    && !pathIsInsideRoot(evidenceDir, campaignRoot)
  ) {
    pushFailure(failures, `${path}.evidence_dir`, 'claim evidence_dir must stay within campaign_root.');
  }
}

function validateStateJobs(
  value: unknown,
  campaignRoot: string | undefined,
  failures: GovernanceRunModelValidationFailure[],
): void {
  const jobs = validateArray(value, 'state.jobs', failures);
  if (!jobs) {
    return;
  }

  const seenJobIds = new Set<string>();
  jobs.forEach((job, index) => {
    const path = `state.jobs[${index}]`;
    if (!isRecord(job)) {
      pushFailure(failures, path, `${path} must be an object.`);
      return;
    }
    validateRequiredFields(
      job,
      path,
      [
        'job_id',
        'gate_id',
        'step_id',
        'line_kind',
        'lifecycle',
        'attempts',
        'lock_leases',
        'result_ref',
        'evidence_ref',
        'claim_ref',
      ],
      failures,
    );
    const jobId = validateString(job.job_id, `${path}.job_id`, failures);
    if (jobId !== undefined) {
      if (seenJobIds.has(jobId)) {
        pushFailure(failures, `${path}.job_id`, `duplicate state job id "${jobId}".`);
      }
      seenJobIds.add(jobId);
    }
    validateString(job.gate_id, `${path}.gate_id`, failures);
    validateNullableString(job.step_id, `${path}.step_id`, failures);
    validateString(job.line_kind, `${path}.line_kind`, failures);
    validateEnum(job.lifecycle, RUN_JOB_LIFECYCLES, `${path}.lifecycle`, failures);
    validateAttempts(job.attempts, `${path}.attempts`, failures);
    validateLockLeases(job.lock_leases, `${path}.lock_leases`, failures);
    validateResultRef(job.result_ref, `${path}.result_ref`, failures);
    validateEvidenceRef(job.evidence_ref, `${path}.evidence_ref`, campaignRoot, failures);
    validateClaimRef(job.claim_ref, `${path}.claim_ref`, campaignRoot, failures);

    const attemptIds = new Set<string>();
    if (Array.isArray(job.attempts)) {
      job.attempts.forEach((attempt) => {
        if (isRecord(attempt) && typeof attempt.attempt_id === 'string') {
          attemptIds.add(attempt.attempt_id);
        }
      });
    }
    if (Array.isArray(job.lock_leases)) {
      job.lock_leases.forEach((lease, leaseIndex) => {
        if (
          isRecord(lease)
          && typeof lease.owner_attempt_id === 'string'
          && !attemptIds.has(lease.owner_attempt_id)
        ) {
          pushFailure(
            failures,
            `${path}.lock_leases[${leaseIndex}].owner_attempt_id`,
            'lock lease owner_attempt_id must reference a job attempt.',
          );
        }
      });
    }
  });
}

function jobIdsWithStateFailures(
  state: GovernanceRunState,
  failures: readonly GovernanceRunModelValidationFailure[],
): { invalidJobIds: ReadonlySet<string>; globalInvalid: boolean } {
  const invalidJobIds = new Set<string>();
  let globalInvalid = false;

  for (const failure of failures) {
    const match = /^state\.jobs\[(\d+)\]/.exec(failure.path);
    if (!match) {
      globalInvalid = true;
      continue;
    }
    const index = Number(match[1]);
    const job = state.jobs[index];
    if (job) {
      invalidJobIds.add(job.job_id);
    }
  }

  return { invalidJobIds, globalInvalid };
}

function compareNullableString(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function allDigestRefsComplete(claimRef: GovernanceRunClaimRef): claimRef is GovernanceRunClaimRef & {
  input_digest: string;
  artifact_digest: string;
  result_digest: string;
} {
  return typeof claimRef.input_digest === 'string'
    && SHA256_DIGEST_PATTERN.test(claimRef.input_digest)
    && typeof claimRef.artifact_digest === 'string'
    && SHA256_DIGEST_PATTERN.test(claimRef.artifact_digest)
    && typeof claimRef.result_digest === 'string'
    && SHA256_DIGEST_PATTERN.test(claimRef.result_digest);
}

function pushReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function pushJobReason(
  reasonCodesByJobId: Map<string, string[]>,
  jobId: string,
  reason: string,
): void {
  const reasons = reasonCodesByJobId.get(jobId) ?? [];
  pushReason(reasons, reason);
  reasonCodesByJobId.set(jobId, reasons);
}

function validatePlanGraph(
  jobs: readonly GovernanceRunPlan['jobs'][number][],
): { globalReasonCodes: readonly string[]; jobReasonCodesById: ReadonlyMap<string, readonly string[]> } {
  const globalReasonCodes: string[] = [];
  const jobReasonCodesById = new Map<string, string[]>();
  const planJobIds = new Set<string>();
  const duplicateJobIds = new Set<string>();

  for (const job of jobs) {
    if (planJobIds.has(job.id)) {
      duplicateJobIds.add(job.id);
      continue;
    }
    planJobIds.add(job.id);
  }

  if (duplicateJobIds.size > 0) {
    pushReason(globalReasonCodes, 'duplicate_plan_job_id');
  }

  for (const job of jobs) {
    for (const dependencyId of job.depends_on) {
      if (!planJobIds.has(dependencyId)) {
        pushJobReason(jobReasonCodesById, job.id, 'unknown_dependency');
      }
    }
  }

  if (duplicateJobIds.size === 0) {
    const planJobsById = new Map(jobs.map((job) => [job.id, job]));
    const visitStates = new Map<string, 'visiting' | 'visited'>();
    const stack: string[] = [];
    const cycleJobIds = new Set<string>();

    const visit = (jobId: string): void => {
      const visitState = visitStates.get(jobId);
      if (visitState === 'visited') {
        return;
      }
      if (visitState === 'visiting') {
        const cycleStart = stack.indexOf(jobId);
        const cycleMembers = cycleStart >= 0 ? stack.slice(cycleStart) : [jobId];
        cycleMembers.forEach((cycleJobId) => cycleJobIds.add(cycleJobId));
        return;
      }

      const job = planJobsById.get(jobId);
      if (!job) {
        return;
      }

      visitStates.set(jobId, 'visiting');
      stack.push(jobId);
      for (const dependencyId of job.depends_on) {
        if (planJobIds.has(dependencyId)) {
          visit(dependencyId);
        }
      }
      stack.pop();
      visitStates.set(jobId, 'visited');
    };

    for (const jobId of planJobIds) {
      visit(jobId);
    }

    for (const jobId of cycleJobIds) {
      pushJobReason(jobReasonCodesById, jobId, 'dependency_cycle');
    }
  }

  return { globalReasonCodes, jobReasonCodesById };
}

function planGraphHasFailures(
  validation: ReturnType<typeof validatePlanGraph>,
): boolean {
  return validation.globalReasonCodes.length > 0 || validation.jobReasonCodesById.size > 0;
}

function validateResumeClaimRef(
  value: unknown,
  path: string,
  campaignRoot: string | undefined,
  failures: GovernanceRunModelValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be null or an object.`);
    return;
  }

  validateRequiredFields(
    value,
    path,
    [
      'claim_id',
      'claim_digest',
      'evidence_dir',
      'input_digest',
      'artifact_digest',
      'result_digest',
    ],
    failures,
  );
  validateString(value.claim_id, `${path}.claim_id`, failures);
  validateDigest(value.claim_digest, `${path}.claim_digest`, failures, { nullable: true });
  const evidenceDir = validateString(value.evidence_dir, `${path}.evidence_dir`, failures);
  validateDigest(value.input_digest, `${path}.input_digest`, failures, { nullable: false });
  validateDigest(value.artifact_digest, `${path}.artifact_digest`, failures, { nullable: false });
  validateDigest(value.result_digest, `${path}.result_digest`, failures, { nullable: false });
  if (
    campaignRoot !== undefined
    && evidenceDir !== undefined
    && !pathIsInsideRoot(evidenceDir, campaignRoot)
  ) {
    pushFailure(failures, `${path}.evidence_dir`, 'claim evidence_dir must stay within campaign_root.');
  }
}

function validateResumeJobs(
  value: unknown,
  campaignRoot: string | undefined,
  failures: GovernanceRunModelValidationFailure[],
): void {
  const jobs = validateArray(value, 'resume_plan.jobs', failures);
  if (!jobs) {
    return;
  }

  jobs.forEach((job, index) => {
    const path = `resume_plan.jobs[${index}]`;
    if (!isRecord(job)) {
      pushFailure(failures, path, `${path} must be an object.`);
      return;
    }
    validateRequiredFields(
      job,
      path,
      [
        'job_id',
        'gate_id',
        'step_id',
        'line_kind',
        'next_action',
        'reason_codes',
        'upstream_job_ids',
        'claim_ref',
      ],
      failures,
    );
    validateString(job.job_id, `${path}.job_id`, failures);
    validateString(job.gate_id, `${path}.gate_id`, failures);
    validateNullableString(job.step_id, `${path}.step_id`, failures);
    validateString(job.line_kind, `${path}.line_kind`, failures);
    const nextAction = validateEnum(job.next_action, RESUME_ACTIONS, `${path}.next_action`, failures);
    const reasonCodes = validateArray(job.reason_codes, `${path}.reason_codes`, failures);
    reasonCodes?.forEach((reason, reasonIndex) => {
      validateString(reason, `${path}.reason_codes[${reasonIndex}]`, failures);
    });
    const upstreamJobIds = validateArray(job.upstream_job_ids, `${path}.upstream_job_ids`, failures);
    upstreamJobIds?.forEach((upstreamJobId, upstreamIndex) => {
      validateString(upstreamJobId, `${path}.upstream_job_ids[${upstreamIndex}]`, failures);
    });
    validateResumeClaimRef(job.claim_ref, `${path}.claim_ref`, campaignRoot, failures);
    if (nextAction === 'reuse_claim' && (job.claim_ref === null || job.claim_ref === undefined)) {
      pushFailure(failures, `${path}.claim_ref`, 'reuse_claim resume jobs must include claim_ref.');
    }
    if (
      nextAction !== undefined
      && nextAction !== 'reuse_claim'
      && job.claim_ref !== null
      && job.claim_ref !== undefined
    ) {
      pushFailure(failures, `${path}.claim_ref`, 'non-reuse resume jobs must not include claim_ref.');
    }
  });
}

export function validateGovernanceRunState(state: unknown): GovernanceRunStateValidationResult {
  const failures: GovernanceRunModelValidationFailure[] = [];

  validateForbiddenFields(state, 'state', failures);
  validateKnownFields(state, 'state', STATE_ALLOWED_FIELD_SETS, failures);

  if (!isRecord(state)) {
    pushFailure(failures, 'state', 'state must be an object.');
    return { ok: false, failures };
  }

  validateRequiredFields(state, 'state', ['schema', 'version', 'campaign', 'fingerprints', 'jobs'], failures);
  validateLiteral(state.schema, GOVERNANCE_RUN_STATE_SCHEMA, 'state.schema', failures);
  validateLiteral(state.version, GOVERNANCE_RUN_STATE_VERSION, 'state.version', failures);
  const campaign = validateCampaignIdentity(state.campaign, 'state.campaign', failures);
  validateFingerprints(state.fingerprints, 'state.fingerprints', failures);
  validateStateJobs(state.jobs, campaign?.campaign_root, failures);

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return {
    ok: true,
    value: state as GovernanceRunState,
  };
}

export function validateGovernanceResumePlan(plan: unknown): GovernanceResumePlanValidationResult {
  const failures: GovernanceRunModelValidationFailure[] = [];

  validateForbiddenFields(plan, 'resume_plan', failures);
  validateKnownFields(plan, 'resume_plan', RESUME_ALLOWED_FIELD_SETS, failures);

  if (!isRecord(plan)) {
    pushFailure(failures, 'resume_plan', 'resume_plan must be an object.');
    return { ok: false, failures };
  }

  validateRequiredFields(plan, 'resume_plan', ['schema', 'version', 'campaign', 'fingerprints', 'jobs'], failures);
  validateLiteral(plan.schema, GOVERNANCE_RESUME_PLAN_SCHEMA, 'resume_plan.schema', failures);
  validateLiteral(plan.version, GOVERNANCE_RESUME_PLAN_VERSION, 'resume_plan.version', failures);
  const campaign = validateCampaignIdentity(plan.campaign, 'resume_plan.campaign', failures);
  validateFingerprints(plan.fingerprints, 'resume_plan.fingerprints', failures);
  validateResumeJobs(plan.jobs, campaign?.campaign_root, failures);

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return {
    ok: true,
    value: plan as GovernanceResumePlan,
  };
}

function makeResumeJob(
  args: {
    stateJob: GovernanceRunStateJob | undefined;
    planJob: GovernanceRunPlan['jobs'][number];
    currentJob: GovernanceCurrentManifestJob | undefined;
    nextAction: GovernanceResumeNextAction;
    reasonCodes: readonly string[];
    upstreamJobIds: readonly string[];
    claimRef: GovernanceResumePlanClaimRef | null;
  },
): GovernanceResumePlanJob {
  return {
    job_id: args.planJob.id,
    gate_id: args.currentJob?.gate_id ?? args.stateJob?.gate_id ?? args.planJob.gate_id,
    step_id: args.currentJob?.step_id ?? args.stateJob?.step_id ?? args.planJob.step_id,
    line_kind: args.currentJob?.line_kind ?? args.stateJob?.line_kind ?? '',
    next_action: args.nextAction,
    reason_codes: args.reasonCodes,
    upstream_job_ids: args.upstreamJobIds,
    claim_ref: args.claimRef,
  };
}

function reusableClaimRef(
  claimRef: GovernanceRunClaimRef,
  claim: CurrentEvidenceClaimRecord,
): GovernanceResumePlanClaimRef {
  return {
    claim_id: claimRef.claim_id,
    claim_digest: claimRef.claim_digest,
    evidence_dir: claim.evidence_dir,
    input_digest: claim.input_digest.value,
    artifact_digest: claim.artifact_digest.value,
    result_digest: claim.result_digest,
  };
}

function claimBindingMatches(
  args: {
    claim: CurrentEvidenceClaimRecord;
    claimRef: GovernanceRunClaimRef;
    state: GovernanceRunState;
    stateJob: GovernanceRunStateJob;
    planJob: GovernanceRunPlan['jobs'][number];
    currentJob: GovernanceCurrentManifestJob;
  },
): string[] {
  const reasons: string[] = [];
  const claim = args.claim;

  if (claim.campaign_id !== args.state.campaign.campaign_id) {
    pushReason(reasons, 'campaign_id_mismatch');
  }
  if (claim.campaign_root !== args.state.campaign.campaign_root) {
    pushReason(reasons, 'campaign_root_mismatch');
  }
  if (claim.run_id !== args.state.campaign.run_id) {
    pushReason(reasons, 'run_id_mismatch');
  }
  if (!compareNullableString(claim.step_id, args.stateJob.step_id)) {
    pushReason(reasons, 'state_step_mismatch');
  }
  if (!compareNullableString(claim.step_id, args.planJob.step_id)) {
    pushReason(reasons, 'plan_step_mismatch');
  }
  if (!compareNullableString(claim.step_id, args.currentJob.step_id)) {
    pushReason(reasons, 'manifest_step_mismatch');
  }
  if (claim.gate_id !== args.stateJob.gate_id || claim.gate_id !== args.planJob.gate_id) {
    pushReason(reasons, 'gate_mismatch');
  }
  if (claim.gate_id !== args.currentJob.gate_id) {
    pushReason(reasons, 'manifest_gate_mismatch');
  }
  if (claim.line_kind !== args.stateJob.line_kind || claim.line_kind !== args.currentJob.line_kind) {
    pushReason(reasons, 'line_kind_mismatch');
  }
  if (!pathIsInsideRoot(claim.evidence_dir, args.state.campaign.campaign_root)) {
    pushReason(reasons, 'evidence_dir_outside_campaign_root');
  }
  if (claim.evidence_dir !== args.claimRef.evidence_dir) {
    pushReason(reasons, 'claim_ref_evidence_dir_mismatch');
  }
  if (claim.input_digest.value !== args.claimRef.input_digest) {
    pushReason(reasons, 'input_digest_mismatch');
  }
  if (claim.artifact_digest.value !== args.claimRef.artifact_digest) {
    pushReason(reasons, 'artifact_digest_mismatch');
  }
  if (claim.result_digest !== args.claimRef.result_digest) {
    pushReason(reasons, 'result_digest_mismatch');
  }
  if (!compareNullableString(claim.freshness.secret_profile_digest, args.currentJob.secret_profile_digest)) {
    pushReason(reasons, 'secret_profile_mismatch');
  }
  if (!compareNullableString(args.claimRef.secret_profile_digest, args.currentJob.secret_profile_digest)) {
    pushReason(reasons, 'state_secret_profile_mismatch');
  }

  return reasons;
}

export function deriveGovernanceResumePlan(input: GovernanceResumePlanInput): GovernanceResumePlan {
  const stateValidation = validateGovernanceRunState(input.run_state);
  const stateFailureProjection = stateValidation.ok
    ? { invalidJobIds: new Set<string>(), globalInvalid: false }
    : jobIdsWithStateFailures(input.run_state, stateValidation.failures);
  const graphValidation = validatePlanGraph(input.run_plan.jobs);
  const planJobsById = new Map(input.run_plan.jobs.map((job) => [job.id, job]));
  const stateJobsById = new Map(input.run_state.jobs.map((job) => [job.job_id, job]));
  const currentJobsById = new Map(input.current_manifests.jobs.map((job) => [job.job_id, job]));
  const claimInputsByJobId = new Map(input.claim_validation_inputs.map((entry) => [entry.job_id, entry]));
  const memo = new Map<string, GovernanceResumePlanJob>();

  const fingerprintMismatch = input.run_state.fingerprints.run_plan_digest !== input.current_manifests.run_plan_digest
    || input.run_state.fingerprints.manifest_digest !== input.current_manifests.manifest_digest;

  const planGraphInvalid = planGraphHasFailures(graphValidation);
  const rootBindingMismatch = !pathsEquivalent(
    input.run_state.campaign.campaign_root,
    input.run_plan.report_root,
  );

  if (planGraphInvalid || rootBindingMismatch) {
    const jobs = input.run_plan.jobs.map((planJob) => {
      const reasonCodes: string[] = [];
      if (planGraphInvalid) {
        pushReason(reasonCodes, 'plan_graph_invalid');
        graphValidation.globalReasonCodes.forEach((reason) => pushReason(reasonCodes, reason));
        graphValidation.jobReasonCodesById.get(planJob.id)?.forEach((reason) => {
          pushReason(reasonCodes, reason);
        });
      }
      if (rootBindingMismatch) {
        pushReason(reasonCodes, 'campaign_root_report_root_mismatch');
      }

      return makeResumeJob({
        stateJob: stateJobsById.get(planJob.id),
        planJob,
        currentJob: currentJobsById.get(planJob.id),
        nextAction: 'invalidated',
        reasonCodes,
        upstreamJobIds: planJob.depends_on,
        claimRef: null,
      });
    });

    return {
      schema: GOVERNANCE_RESUME_PLAN_SCHEMA,
      version: GOVERNANCE_RESUME_PLAN_VERSION,
      campaign: {
        campaign_id: input.run_state.campaign.campaign_id,
        campaign_root: input.run_state.campaign.campaign_root,
        run_id: input.run_state.campaign.run_id,
      },
      fingerprints: {
        run_plan_digest: input.current_manifests.run_plan_digest,
        manifest_digest: input.current_manifests.manifest_digest,
      },
      jobs,
    };
  }

  const decide = (jobId: string): GovernanceResumePlanJob => {
    const existing = memo.get(jobId);
    if (existing) {
      return existing;
    }

    const planJob = planJobsById.get(jobId);
    if (!planJob) {
      throw new Error(`resume plan cannot decide unknown plan job: ${jobId}`);
    }
    const stateJob = stateJobsById.get(jobId);
    const currentJob = currentJobsById.get(jobId);
    const upstreamJobIds = [...planJob.depends_on];
    const upstreamDecisions = upstreamJobIds.map((dependencyId) => decide(dependencyId));
    const blockedUpstreamJobIds = upstreamDecisions
      .filter((decision) => decision.next_action !== 'reuse_claim')
      .map((decision) => decision.job_id);

    if (blockedUpstreamJobIds.length > 0) {
      const blocked = makeResumeJob({
        stateJob,
        planJob,
        currentJob,
        nextAction: 'blocked_by_upstream',
        reasonCodes: ['upstream_not_reusable'],
        upstreamJobIds: blockedUpstreamJobIds,
        claimRef: null,
      });
      memo.set(jobId, blocked);
      return blocked;
    }

    const invalidReasons: string[] = [];
    if (stateFailureProjection.globalInvalid || stateFailureProjection.invalidJobIds.has(jobId)) {
      pushReason(invalidReasons, 'run_state_invalid');
    }
    if (fingerprintMismatch) {
      pushReason(invalidReasons, 'fingerprint_mismatch');
    }
    if (!stateJob) {
      pushReason(invalidReasons, 'missing_state_job');
    }
    if (!currentJob) {
      pushReason(invalidReasons, 'missing_manifest_job');
    }
    if (stateJob && currentJob) {
      if (stateJob.gate_id !== planJob.gate_id || stateJob.gate_id !== currentJob.gate_id) {
        pushReason(invalidReasons, 'job_gate_mismatch');
      }
      if (!compareNullableString(stateJob.step_id, planJob.step_id) || !compareNullableString(stateJob.step_id, currentJob.step_id)) {
        pushReason(invalidReasons, 'job_step_mismatch');
      }
      if (stateJob.line_kind !== currentJob.line_kind) {
        pushReason(invalidReasons, 'job_line_kind_mismatch');
      }
    }

    if (invalidReasons.length > 0) {
      const invalidated = makeResumeJob({
        stateJob,
        planJob,
        currentJob,
        nextAction: 'invalidated',
        reasonCodes: invalidReasons,
        upstreamJobIds,
        claimRef: null,
      });
      memo.set(jobId, invalidated);
      return invalidated;
    }

    if (!stateJob || !currentJob) {
      throw new Error(`resume plan invariant failed for job: ${jobId}`);
    }

    const rerunReasons: string[] = [];
    if (stateJob.lifecycle !== 'completed') {
      pushReason(rerunReasons, 'job_not_completed');
    }
    if (!stateJob.result_ref) {
      pushReason(rerunReasons, 'missing_result_ref');
    } else {
      if (stateJob.result_ref.result_status !== 'passed') {
        pushReason(rerunReasons, 'result_not_passed');
      }
      if (stateJob.result_ref.failure_class !== 'none') {
        pushReason(rerunReasons, 'failure_class_not_none');
      }
      if (stateJob.result_ref.result_digest === null) {
        pushReason(rerunReasons, 'missing_result_digest');
      }
    }
    if (!stateJob.claim_ref) {
      pushReason(rerunReasons, 'missing_claim_ref');
    } else {
      if (stateJob.claim_ref.result_status !== 'passed') {
        pushReason(rerunReasons, 'claim_result_not_passed');
      }
      if (stateJob.claim_ref.failure_class !== 'none') {
        pushReason(rerunReasons, 'claim_failure_class_not_none');
      }
      if (!allDigestRefsComplete(stateJob.claim_ref)) {
        pushReason(rerunReasons, 'claim_digest_incomplete');
      }
    }

    const claimInput = claimInputsByJobId.get(jobId);
    if (!claimInput) {
      pushReason(rerunReasons, 'missing_claim_validation_input');
    } else if (!stateJob.claim_ref || claimInput.claim_id !== stateJob.claim_ref.claim_id) {
      pushReason(rerunReasons, 'claim_id_mismatch');
    } else if (claimInput.purpose !== 'reuse') {
      pushReason(rerunReasons, 'claim_validation_purpose_not_reuse');
    } else {
      const claimValidation = validateCurrentEvidenceClaim(claimInput.claim, { purpose: 'reuse' });
      if (!claimValidation.ok) {
        pushReason(rerunReasons, 'claim_validation_failed');
      } else {
        rerunReasons.push(...claimBindingMatches({
          claim: claimValidation.value,
          claimRef: stateJob.claim_ref,
          state: input.run_state,
          stateJob,
          planJob,
          currentJob,
        }));
      }
    }

    if (rerunReasons.length > 0 || !stateJob.claim_ref || !allDigestRefsComplete(stateJob.claim_ref)) {
      const rerun = makeResumeJob({
        stateJob,
        planJob,
        currentJob,
        nextAction: 'rerun_required',
        reasonCodes: [...new Set(rerunReasons)],
        upstreamJobIds,
        claimRef: null,
      });
      memo.set(jobId, rerun);
      return rerun;
    }

    const validClaim = claimInputsByJobId.get(jobId);
    const claimValidation = validClaim
      ? validateCurrentEvidenceClaim(validClaim.claim, { purpose: 'reuse' })
      : { ok: false as const, failures: [] };
    if (!claimValidation.ok) {
      const rerun = makeResumeJob({
        stateJob,
        planJob,
        currentJob,
        nextAction: 'rerun_required',
        reasonCodes: ['claim_validation_failed'],
        upstreamJobIds,
        claimRef: null,
      });
      memo.set(jobId, rerun);
      return rerun;
    }

    const reuse = makeResumeJob({
      stateJob,
      planJob,
      currentJob,
      nextAction: 'reuse_claim',
      reasonCodes: ['claim_valid_for_reuse'],
      upstreamJobIds,
      claimRef: reusableClaimRef(stateJob.claim_ref, claimValidation.value),
    });
    memo.set(jobId, reuse);
    return reuse;
  };

  const jobs = input.run_plan.jobs.map((job) => decide(job.id));

  return {
    schema: GOVERNANCE_RESUME_PLAN_SCHEMA,
    version: GOVERNANCE_RESUME_PLAN_VERSION,
    campaign: {
      campaign_id: input.run_state.campaign.campaign_id,
      campaign_root: input.run_state.campaign.campaign_root,
      run_id: input.run_state.campaign.run_id,
    },
    fingerprints: {
      run_plan_digest: input.current_manifests.run_plan_digest,
      manifest_digest: input.current_manifests.manifest_digest,
    },
    jobs,
  };
}
