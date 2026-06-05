import { listCurrentRuntimeLines } from './current-runtime-line-manifest';
import {
  validateMinimalLeaseStatusShadow,
  type MinimalLeaseStatusShadow,
} from './lease-status-shadow';

export const CURRENT_STATUS_PROJECTION_SCHEMA = 'agentsmith_status_projection/v1' as const;
export const CURRENT_STATUS_PROJECTION_VERSION = 1 as const;

export type CurrentStatusProjectionGoal =
  | 'verify'
  | 'product-readiness'
  | 'local-real'
  | null;

export type CurrentStatusProjectionPhase =
  | 'reset'
  | 'up'
  | 'bootstrap'
  | 'verify'
  | 'report'
  | 'aggregate'
  | 'complete'
  | 'not-started'
  | 'running'
  | 'unknown';

export type CurrentStatusProjectionPresentationStatus =
  | 'passed'
  | 'failed'
  | 'not-started'
  | 'running'
  | 'unknown'
  | 'stale';

export type CurrentStatusProjectionManualSignoffStatus = 'covered' | 'not-covered' | 'required';

export interface CurrentStatusProjectionAggregateStatusRef {
  path: string;
  digest: string;
  gate_id: 'gate-release-full';
  line_kind: 'release_full_verdict';
}

export interface CurrentStatusProjectionReason {
  code: string;
  summary: string;
  source_path: string | null;
}

export interface CurrentStatusProjectionBlocker {
  owner: string;
  stage: string;
  path: string | null;
}

export interface CurrentStatusProjectionPathRef {
  path: string;
  digest: string | null;
}

export type CurrentStatusProjectionResumeRecommendationSource =
  | 'campaign_step_results'
  | 'terminal_aggregate'
  | 'not_available';

export type CurrentStatusProjectionResumeRecommendationAction =
  | 'none'
  | 'rerun_required'
  | 'blocked_by_upstream'
  | 'inspect_authority'
  | 'not_available';

export interface CurrentStatusProjectionResumeRecommendation {
  projection_kind: 'read_only';
  source: CurrentStatusProjectionResumeRecommendationSource;
  action: CurrentStatusProjectionResumeRecommendationAction;
  owner_job_id: string | null;
  owner_gate_id: string | null;
  producer_job_ids: readonly string[];
  downstream_aggregate_job_id: 'gate-release-full' | null;
  step_result_pointer: CurrentStatusProjectionPathRef | null;
  safe_next_command: string | null;
  reason_codes: readonly string[];
  automatic_rerun: false;
  automatic_skip: false;
}

export interface CurrentStatusProjectionLockOwnerRef {
  lock_id: string;
  scope_kind: string;
  scope_key: string;
  owner_group: string;
  owner_step_id: string;
  owner_attempt_id: string;
  pid: number | null;
}

export interface CurrentStatusProjectionLockOwner {
  active_run_id: string | null;
  active_lock_count: number;
  owners: readonly CurrentStatusProjectionLockOwnerRef[];
}

export interface CurrentStatusProjectionAuthorityPaths {
  aggregate: string | null;
  stage: string | null;
  evidence: readonly string[];
}

export interface CurrentStatusProjectionRunObservabilityCounts {
  real_service_start_count: number;
  api_web_start_count: number;
  backend_real_check_session_count: number;
  image_import_count: number;
}

export interface CurrentStatusProjectionSlowStage {
  id: string;
  label: string;
  duration_ms: number;
  status: string;
}

export type CurrentStatusProjectionDeployCheckSnapshotStatus =
  | 'passed'
  | 'failed'
  | 'not_available'
  | 'unknown';

export interface CurrentStatusProjectionDeployCheckSnapshotItem {
  id: string;
  label: string;
  status: CurrentStatusProjectionDeployCheckSnapshotStatus;
  evidence_path: string;
  result_path: string;
  result_digest: string | null;
}

export interface CurrentStatusProjectionDeployCheckSnapshot {
  schema: 'agentsmith_release_deploy_check_snapshot/v1';
  generated_at: string;
  items: readonly CurrentStatusProjectionDeployCheckSnapshotItem[];
}

export interface CurrentStatusProjectionRunObservability {
  total_duration_ms: number | null;
  top_slow_stages: readonly CurrentStatusProjectionSlowStage[];
  counts_source: 'parent_flow';
  counts: CurrentStatusProjectionRunObservabilityCounts;
  poll_retry_coverage: 'not_covered' | 'runtime_pending_readiness_adaptive_wait';
  report_size_bytes: number;
}

export interface CurrentStatusProjection {
  schema: typeof CURRENT_STATUS_PROJECTION_SCHEMA;
  version: typeof CURRENT_STATUS_PROJECTION_VERSION;
  projection_kind: 'read_only';
  goal: CurrentStatusProjectionGoal;
  runtime_line: string | null;
  run_id: string | null;
  current_git_sha: string | null;
  evidence_git_sha: string | null;
  run_age_seconds: number | null;
  phase: CurrentStatusProjectionPhase;
  aggregate_status_ref: CurrentStatusProjectionAggregateStatusRef | null;
  presentation_status: CurrentStatusProjectionPresentationStatus;
  primary_blocker: CurrentStatusProjectionBlocker | null;
  downstream_skipped: readonly string[];
  deepest_reason: CurrentStatusProjectionReason | null;
  safe_next_command: string | null;
  resume_recommendation: CurrentStatusProjectionResumeRecommendation;
  destructive_recovery_command: string | null;
  lock_owner: CurrentStatusProjectionLockOwner | null;
  lease_status_shadow: MinimalLeaseStatusShadow | null;
  run_observability?: CurrentStatusProjectionRunObservability | null;
  deploy_check_snapshot?: CurrentStatusProjectionDeployCheckSnapshot | null;
  manual_signoff_status: CurrentStatusProjectionManualSignoffStatus;
  evidence_paths: readonly CurrentStatusProjectionPathRef[];
  authority_paths: CurrentStatusProjectionAuthorityPaths;
  generated_at: string;
  release_decision_produced: false;
  commands_executed: false;
  leases_acquired: false;
  leases_released: false;
}

export interface CurrentStatusProjectionValidationFailure {
  path: string;
  reason: string;
}

export type CurrentStatusProjectionValidationResult =
  | {
      ok: true;
      value: CurrentStatusProjection;
    }
  | {
      ok: false;
      failures: readonly CurrentStatusProjectionValidationFailure[];
    };

const STATUS_PROJECTION_TOP_LEVEL_FIELDS = new Set<string>([
  'schema',
  'version',
  'projection_kind',
  'goal',
  'runtime_line',
  'run_id',
  'current_git_sha',
  'evidence_git_sha',
  'run_age_seconds',
  'phase',
  'aggregate_status_ref',
  'presentation_status',
  'primary_blocker',
  'downstream_skipped',
  'deepest_reason',
  'safe_next_command',
  'resume_recommendation',
  'destructive_recovery_command',
  'lock_owner',
  'lease_status_shadow',
  'run_observability',
  'deploy_check_snapshot',
  'manual_signoff_status',
  'evidence_paths',
  'authority_paths',
  'generated_at',
  'release_decision_produced',
  'commands_executed',
  'leases_acquired',
  'leases_released',
]);

const STATUS_PROJECTION_REQUIRED_TOP_LEVEL_FIELDS = new Set<string>(
  [...STATUS_PROJECTION_TOP_LEVEL_FIELDS].filter((field) => field !== 'run_observability' && field !== 'deploy_check_snapshot'),
);

const GOALS = new Set<Exclude<CurrentStatusProjectionGoal, null>>([
  'verify',
  'product-readiness',
  'local-real',
]);

const PHASES = new Set<string>([
  'reset',
  'up',
  'bootstrap',
  'verify',
  'report',
  'aggregate',
  'complete',
  'not-started',
  'running',
  'unknown',
]);

const PRESENTATION_STATUSES = new Set<string>([
  'passed',
  'failed',
  'not-started',
  'running',
  'unknown',
  'stale',
]);

const RESUME_RECOMMENDATION_SOURCES = new Set<string>([
  'campaign_step_results',
  'terminal_aggregate',
  'not_available',
]);

const RESUME_RECOMMENDATION_ACTIONS = new Set<string>([
  'none',
  'rerun_required',
  'blocked_by_upstream',
  'inspect_authority',
  'not_available',
]);

const MANUAL_SIGNOFF_STATUSES = new Set<string>(['covered', 'not-covered', 'required']);
const DEPLOY_CHECK_SNAPSHOT_STATUSES = new Set<string>(['passed', 'failed', 'not_available', 'unknown']);
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const FORBIDDEN_RELEASE_TRUTH_FIELDS = new Set<string>([
  'release_verdict',
  'automated_release_verdict',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pushFailure(
  failures: CurrentStatusProjectionValidationFailure[],
  path: string,
  reason: string,
): void {
  failures.push({ path, reason });
}

function validateForbiddenReleaseTruthFields(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateForbiddenReleaseTruthFields(entry, `${path}[${index}]`, failures);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RELEASE_TRUTH_FIELDS.has(key)) {
      pushFailure(
        failures,
        `${path}.${key}`,
        `${key} is forbidden in read-only status projection output.`,
      );
    }
    validateForbiddenReleaseTruthFields(nested, `${path}.${key}`, failures);
  }
}

function validateRequiredFields(
  record: Record<string, unknown>,
  path: string,
  fields: readonly string[],
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  for (const field of fields) {
    if (!hasOwn(record, field)) {
      pushFailure(failures, `${path}.${field}`, `${field} is required.`);
    }
  }
}

function validateNoUnknownFields(
  record: Record<string, unknown>,
  path: string,
  allowedFields: ReadonlySet<string>,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      pushFailure(failures, `${path}.${key}`, `unknown field "${key}".`);
    }
  }
}

function validateString(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
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
  failures: CurrentStatusProjectionValidationFailure[],
): string | null | undefined {
  if (value === null) {
    return null;
  }
  return validateString(value, path, failures);
}

function validateBooleanFalse(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value !== false) {
    pushFailure(failures, path, `${path} must be false for read-only status projection.`);
  }
}

function validateNullableNumber(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    pushFailure(failures, path, `${path} must be a non-negative number or null.`);
    return undefined;
  }
  return value;
}

function validateEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): string | undefined {
  const stringValue = validateString(value, path, failures);
  if (stringValue !== undefined && !allowed.has(stringValue)) {
    pushFailure(failures, path, `${path} is not a supported value.`);
  }
  return stringValue;
}

function validateDigest(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): string | undefined {
  const digest = validateString(value, path, failures);
  if (digest !== undefined && !SHA256_DIGEST_PATTERN.test(digest)) {
    pushFailure(failures, path, `${path} must use sha256:<64 lowercase hex>.`);
  }
  return digest;
}

function validateNullableDigest(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): string | null | undefined {
  if (value === null) {
    return null;
  }
  return validateDigest(value, path, failures);
}

function validateIsoTimestamp(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  const timestamp = validateString(value, path, failures);
  if (timestamp === undefined) {
    return;
  }
  const parsed = new Date(timestamp);
  if (
    !ISO_TIMESTAMP_PATTERN.test(timestamp)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== timestamp
  ) {
    pushFailure(failures, path, `${path} must be a canonical ISO timestamp.`);
  }
}

function validateNullableGitSha(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  const gitSha = validateString(value, path, failures);
  if (gitSha !== undefined && !GIT_SHA_PATTERN.test(gitSha)) {
    pushFailure(failures, path, `${path} must be a 40 or 64 character git sha.`);
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    pushFailure(failures, path, `${path} must be an array.`);
    return undefined;
  }

  const strings: string[] = [];
  value.forEach((entry, index) => {
    const stringValue = validateString(entry, `${path}[${index}]`, failures);
    if (stringValue !== undefined) {
      strings.push(stringValue);
    }
  });
  return strings;
}

function validatePathRef(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, new Set(['path', 'digest']), failures);
  validateRequiredFields(value, path, ['path', 'digest'], failures);
  validateString(value.path, `${path}.path`, failures);
  validateNullableDigest(value.digest, `${path}.digest`, failures);
}

function validateAggregateStatusRef(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object or null.`);
    return;
  }

  validateNoUnknownFields(value, path, new Set(['path', 'digest', 'gate_id', 'line_kind']), failures);
  validateRequiredFields(value, path, ['path', 'digest', 'gate_id', 'line_kind'], failures);
  const refPath = validateString(value.path, `${path}.path`, failures);
  validateDigest(value.digest, `${path}.digest`, failures);

  if (value.gate_id !== 'gate-release-full') {
    pushFailure(failures, `${path}.gate_id`, 'aggregate_status_ref must reference gate-release-full only.');
  }
  if (value.line_kind !== 'release_full_verdict') {
    pushFailure(
      failures,
      `${path}.line_kind`,
      'aggregate_status_ref must reference release_full_verdict only.',
    );
  }
  if (refPath !== undefined && !refPath.replaceAll('\\', '/').endsWith('/gate-release-full/result.json')) {
    pushFailure(failures, `${path}.path`, 'aggregate_status_ref path must end with gate-release-full/result.json.');
  }
}

function validateBlocker(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object or null.`);
    return;
  }
  validateNoUnknownFields(value, path, new Set(['owner', 'stage', 'path']), failures);
  validateRequiredFields(value, path, ['owner', 'stage', 'path'], failures);
  validateString(value.owner, `${path}.owner`, failures);
  validateString(value.stage, `${path}.stage`, failures);
  validateNullableString(value.path, `${path}.path`, failures);
}

function validateReason(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object or null.`);
    return;
  }
  validateNoUnknownFields(value, path, new Set(['code', 'summary', 'source_path']), failures);
  validateRequiredFields(value, path, ['code', 'summary', 'source_path'], failures);
  validateString(value.code, `${path}.code`, failures);
  validateString(value.summary, `${path}.summary`, failures);
  validateNullableString(value.source_path, `${path}.source_path`, failures);
}

function validateResumeRecommendation(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }

  validateNoUnknownFields(value, path, new Set([
    'projection_kind',
    'source',
    'action',
    'owner_job_id',
    'owner_gate_id',
    'producer_job_ids',
    'downstream_aggregate_job_id',
    'step_result_pointer',
    'safe_next_command',
    'reason_codes',
    'automatic_rerun',
    'automatic_skip',
  ]), failures);
  validateRequiredFields(value, path, [
    'projection_kind',
    'source',
    'action',
    'owner_job_id',
    'owner_gate_id',
    'producer_job_ids',
    'downstream_aggregate_job_id',
    'step_result_pointer',
    'safe_next_command',
    'reason_codes',
    'automatic_rerun',
    'automatic_skip',
  ], failures);
  if (value.projection_kind !== 'read_only') {
    pushFailure(failures, `${path}.projection_kind`, 'resume recommendation projection_kind must be read_only.');
  }
  validateEnum(value.source, RESUME_RECOMMENDATION_SOURCES, `${path}.source`, failures);
  validateEnum(value.action, RESUME_RECOMMENDATION_ACTIONS, `${path}.action`, failures);
  validateNullableString(value.owner_job_id, `${path}.owner_job_id`, failures);
  validateNullableString(value.owner_gate_id, `${path}.owner_gate_id`, failures);
  validateStringArray(value.producer_job_ids, `${path}.producer_job_ids`, failures);
  const downstreamAggregate = validateNullableString(
    value.downstream_aggregate_job_id,
    `${path}.downstream_aggregate_job_id`,
    failures,
  );
  if (downstreamAggregate !== undefined && downstreamAggregate !== null && downstreamAggregate !== 'gate-release-full') {
    pushFailure(
      failures,
      `${path}.downstream_aggregate_job_id`,
      'release resume recommendation may only point to gate-release-full as downstream aggregate.',
    );
  }
  if (value.step_result_pointer === null) {
    // Explicit null keeps the recommendation read-only when no producer pointer is available.
  } else {
    validatePathRef(value.step_result_pointer, `${path}.step_result_pointer`, failures);
  }
  validateNullableString(value.safe_next_command, `${path}.safe_next_command`, failures);
  validateStringArray(value.reason_codes, `${path}.reason_codes`, failures);
  validateBooleanFalse(value.automatic_rerun, `${path}.automatic_rerun`, failures);
  validateBooleanFalse(value.automatic_skip, `${path}.automatic_skip`, failures);
}

function validateLockOwnerRef(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }

  validateNoUnknownFields(value, path, new Set([
    'lock_id',
    'scope_kind',
    'scope_key',
    'owner_group',
    'owner_step_id',
    'owner_attempt_id',
    'pid',
  ]), failures);
  validateRequiredFields(value, path, [
    'lock_id',
    'scope_kind',
    'scope_key',
    'owner_group',
    'owner_step_id',
    'owner_attempt_id',
    'pid',
  ], failures);
  validateString(value.lock_id, `${path}.lock_id`, failures);
  validateString(value.scope_kind, `${path}.scope_kind`, failures);
  validateString(value.scope_key, `${path}.scope_key`, failures);
  validateString(value.owner_group, `${path}.owner_group`, failures);
  validateString(value.owner_step_id, `${path}.owner_step_id`, failures);
  validateString(value.owner_attempt_id, `${path}.owner_attempt_id`, failures);
  if (value.pid !== null && (typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0)) {
    pushFailure(failures, `${path}.pid`, `${path}.pid must be a positive integer or null.`);
  }
}

function validateLockOwner(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object or null.`);
    return;
  }

  validateNoUnknownFields(value, path, new Set(['active_run_id', 'active_lock_count', 'owners']), failures);
  validateRequiredFields(value, path, ['active_run_id', 'active_lock_count', 'owners'], failures);
  validateNullableString(value.active_run_id, `${path}.active_run_id`, failures);
  if (
    typeof value.active_lock_count !== 'number'
    || !Number.isInteger(value.active_lock_count)
    || value.active_lock_count < 0
  ) {
    pushFailure(failures, `${path}.active_lock_count`, `${path}.active_lock_count must be a non-negative integer.`);
  }
  if (!Array.isArray(value.owners)) {
    pushFailure(failures, `${path}.owners`, `${path}.owners must be an array.`);
    return;
  }
  value.owners.forEach((entry, index) => {
    validateLockOwnerRef(entry, `${path}.owners[${index}]`, failures);
  });
}

function validateLeaseStatusShadow(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }

  const result = validateMinimalLeaseStatusShadow(value);
  if (result.ok) {
    return;
  }

  for (const failure of result.failures) {
    pushFailure(
      failures,
      failure.path.replace(/^shadow/, path),
      failure.reason,
    );
  }
}

function validateNonNegativeInteger(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    pushFailure(failures, path, `${path} must be a non-negative integer.`);
  }
}

function validateDeployCheckSnapshot(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, new Set(['schema', 'generated_at', 'items']), failures);
  validateRequiredFields(value, path, ['schema', 'generated_at', 'items'], failures);
  if (value.schema !== 'agentsmith_release_deploy_check_snapshot/v1') {
    pushFailure(failures, `${path}.schema`, 'deploy_check_snapshot schema is invalid.');
  }
  validateIsoTimestamp(value.generated_at, `${path}.generated_at`, failures);
  if (!Array.isArray(value.items)) {
    pushFailure(failures, `${path}.items`, `${path}.items must be an array.`);
    return;
  }
  value.items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isRecord(item)) {
      pushFailure(failures, itemPath, `${itemPath} must be an object.`);
      return;
    }
    validateNoUnknownFields(item, itemPath, new Set([
      'id',
      'label',
      'status',
      'evidence_path',
      'result_path',
      'result_digest',
    ]), failures);
    validateRequiredFields(item, itemPath, [
      'id',
      'label',
      'status',
      'evidence_path',
      'result_path',
      'result_digest',
    ], failures);
    validateString(item.id, `${itemPath}.id`, failures);
    validateString(item.label, `${itemPath}.label`, failures);
    validateEnum(item.status, DEPLOY_CHECK_SNAPSHOT_STATUSES, `${itemPath}.status`, failures);
    validateString(item.evidence_path, `${itemPath}.evidence_path`, failures);
    validateString(item.result_path, `${itemPath}.result_path`, failures);
    validateNullableDigest(item.result_digest, `${itemPath}.result_digest`, failures);
  });
}

function validateRunObservability(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object or null.`);
    return;
  }
  validateNoUnknownFields(value, path, new Set([
    'total_duration_ms',
    'top_slow_stages',
    'counts_source',
    'counts',
    'poll_retry_coverage',
    'report_size_bytes',
  ]), failures);
  validateRequiredFields(value, path, [
    'total_duration_ms',
    'top_slow_stages',
    'counts_source',
    'counts',
    'poll_retry_coverage',
    'report_size_bytes',
  ], failures);
  if (value.total_duration_ms !== null) {
    validateNonNegativeInteger(value.total_duration_ms, `${path}.total_duration_ms`, failures);
  }
  if (value.counts_source !== 'parent_flow') {
    pushFailure(failures, `${path}.counts_source`, 'counts_source must be parent_flow.');
  }
  if (
    value.poll_retry_coverage !== 'not_covered'
    && value.poll_retry_coverage !== 'runtime_pending_readiness_adaptive_wait'
  ) {
    pushFailure(failures, `${path}.poll_retry_coverage`, 'poll_retry_coverage is invalid.');
  }
  if (!Array.isArray(value.top_slow_stages)) {
    pushFailure(failures, `${path}.top_slow_stages`, `${path}.top_slow_stages must be an array.`);
  } else {
    value.top_slow_stages.forEach((stage, index) => {
      const stagePath = `${path}.top_slow_stages[${index}]`;
      if (!isRecord(stage)) {
        pushFailure(failures, stagePath, `${stagePath} must be an object.`);
        return;
      }
      validateNoUnknownFields(stage, stagePath, new Set(['id', 'label', 'duration_ms', 'status']), failures);
      validateRequiredFields(stage, stagePath, ['id', 'label', 'duration_ms', 'status'], failures);
      validateString(stage.id, `${stagePath}.id`, failures);
      validateString(stage.label, `${stagePath}.label`, failures);
      validateNonNegativeInteger(stage.duration_ms, `${stagePath}.duration_ms`, failures);
      validateString(stage.status, `${stagePath}.status`, failures);
    });
  }
  if (!isRecord(value.counts)) {
    pushFailure(failures, `${path}.counts`, `${path}.counts must be an object.`);
  } else {
    const countFields = [
      'real_service_start_count',
      'api_web_start_count',
      'backend_real_check_session_count',
      'image_import_count',
    ] as const;
    validateNoUnknownFields(value.counts, `${path}.counts`, new Set(countFields), failures);
    validateRequiredFields(value.counts, `${path}.counts`, countFields, failures);
    for (const field of countFields) {
      validateNonNegativeInteger(value.counts[field], `${path}.counts.${field}`, failures);
    }
  }
  validateNonNegativeInteger(value.report_size_bytes, `${path}.report_size_bytes`, failures);
}

function validateAuthorityPaths(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, new Set(['aggregate', 'stage', 'evidence']), failures);
  validateRequiredFields(value, path, ['aggregate', 'stage', 'evidence'], failures);
  validateNullableString(value.aggregate, `${path}.aggregate`, failures);
  validateNullableString(value.stage, `${path}.stage`, failures);
  validateStringArray(value.evidence, `${path}.evidence`, failures);
}

function validateEvidencePaths(
  value: unknown,
  path: string,
  failures: CurrentStatusProjectionValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    pushFailure(failures, path, `${path} must be an array.`);
    return;
  }
  value.forEach((entry, index) => {
    validatePathRef(entry, `${path}[${index}]`, failures);
  });
}

function registeredRuntimeLineIds(): ReadonlySet<string> {
  return new Set(listCurrentRuntimeLines().map((line) => line.id));
}

export function normalizeStatusProjectionRuntimeLine(input: {
  goal: CurrentStatusProjectionGoal;
  runtimeLine?: string | null;
}): string | null {
  if (input.goal === 'local-real') {
    return 'local-manual';
  }
  if (input.runtimeLine === 'local-real') {
    return 'local-manual';
  }
  return input.runtimeLine ?? null;
}

export function validateCurrentStatusProjection(value: unknown): CurrentStatusProjectionValidationResult {
  const failures: CurrentStatusProjectionValidationFailure[] = [];
  validateForbiddenReleaseTruthFields(value, 'projection', failures);

  if (!isRecord(value)) {
    return {
      ok: false,
      failures: [{ path: 'projection', reason: 'projection must be a JSON object.' }],
    };
  }

  validateNoUnknownFields(value, 'projection', STATUS_PROJECTION_TOP_LEVEL_FIELDS, failures);
  validateRequiredFields(value, 'projection', [...STATUS_PROJECTION_REQUIRED_TOP_LEVEL_FIELDS], failures);

  if (value.schema !== CURRENT_STATUS_PROJECTION_SCHEMA) {
    pushFailure(failures, 'projection.schema', `schema must be ${CURRENT_STATUS_PROJECTION_SCHEMA}.`);
  }
  if (value.version !== CURRENT_STATUS_PROJECTION_VERSION) {
    pushFailure(failures, 'projection.version', `version must be ${String(CURRENT_STATUS_PROJECTION_VERSION)}.`);
  }
  if (value.projection_kind !== 'read_only') {
    pushFailure(failures, 'projection.projection_kind', 'projection_kind must be read_only.');
  }

  if (value.goal !== null && (typeof value.goal !== 'string' || !GOALS.has(value.goal as never))) {
    pushFailure(failures, 'projection.goal', 'projection.goal is not a supported value.');
  }
  const runtimeLine = validateNullableString(value.runtime_line, 'projection.runtime_line', failures);
  if (runtimeLine !== undefined && runtimeLine !== null && !registeredRuntimeLineIds().has(runtimeLine)) {
    pushFailure(failures, 'projection.runtime_line', 'runtime_line must be registered in current runtime line manifest.');
  }
  if (value.goal === 'local-real' && runtimeLine !== 'local-manual') {
    pushFailure(failures, 'projection.runtime_line', 'local-real goal must map to local-manual runtime_line.');
  }

  validateNullableString(value.run_id, 'projection.run_id', failures);
  validateNullableGitSha(value.current_git_sha, 'projection.current_git_sha', failures);
  validateNullableGitSha(value.evidence_git_sha, 'projection.evidence_git_sha', failures);
  validateNullableNumber(value.run_age_seconds, 'projection.run_age_seconds', failures);
  validateEnum(value.phase, PHASES, 'projection.phase', failures);
  validateAggregateStatusRef(value.aggregate_status_ref, 'projection.aggregate_status_ref', failures);
  validateEnum(value.presentation_status, PRESENTATION_STATUSES, 'projection.presentation_status', failures);
  validateBlocker(value.primary_blocker, 'projection.primary_blocker', failures);
  validateStringArray(value.downstream_skipped, 'projection.downstream_skipped', failures);
  validateReason(value.deepest_reason, 'projection.deepest_reason', failures);
  validateNullableString(value.safe_next_command, 'projection.safe_next_command', failures);
  validateResumeRecommendation(value.resume_recommendation, 'projection.resume_recommendation', failures);
  validateNullableString(value.destructive_recovery_command, 'projection.destructive_recovery_command', failures);
  validateLockOwner(value.lock_owner, 'projection.lock_owner', failures);
  validateLeaseStatusShadow(value.lease_status_shadow, 'projection.lease_status_shadow', failures);
  if ('run_observability' in value) {
    validateRunObservability(value.run_observability, 'projection.run_observability', failures);
  }
  if ('deploy_check_snapshot' in value && value.deploy_check_snapshot !== null) {
    validateDeployCheckSnapshot(value.deploy_check_snapshot, 'projection.deploy_check_snapshot', failures);
  }
  validateEnum(value.manual_signoff_status, MANUAL_SIGNOFF_STATUSES, 'projection.manual_signoff_status', failures);
  validateEvidencePaths(value.evidence_paths, 'projection.evidence_paths', failures);
  validateAuthorityPaths(value.authority_paths, 'projection.authority_paths', failures);
  validateIsoTimestamp(value.generated_at, 'projection.generated_at', failures);
  validateBooleanFalse(value.release_decision_produced, 'projection.release_decision_produced', failures);
  validateBooleanFalse(value.commands_executed, 'projection.commands_executed', failures);
  validateBooleanFalse(value.leases_acquired, 'projection.leases_acquired', failures);
  validateBooleanFalse(value.leases_released, 'projection.leases_released', failures);

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return { ok: true, value: value as unknown as CurrentStatusProjection };
}
