import { listCurrentRuntimeLines } from './current-runtime-line-manifest';

export const CURRENT_STATUS_PROJECTION_SCHEMA = 'agentsmith_status_projection/v1' as const;
export const CURRENT_STATUS_PROJECTION_VERSION = 1 as const;

export type CurrentStatusProjectionGoal =
  | 'verify'
  | 'release-ready'
  | 'demo-rehearsal'
  | 'cluster-rehearsal'
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
  destructive_recovery_command: string | null;
  lock_owner: CurrentStatusProjectionLockOwner | null;
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
  'destructive_recovery_command',
  'lock_owner',
  'manual_signoff_status',
  'evidence_paths',
  'authority_paths',
  'generated_at',
  'release_decision_produced',
  'commands_executed',
  'leases_acquired',
  'leases_released',
]);

const GOALS = new Set<Exclude<CurrentStatusProjectionGoal, null>>([
  'verify',
  'release-ready',
  'demo-rehearsal',
  'cluster-rehearsal',
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

const MANUAL_SIGNOFF_STATUSES = new Set<string>(['covered', 'not-covered', 'required']);
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
  validateRequiredFields(value, 'projection', [...STATUS_PROJECTION_TOP_LEVEL_FIELDS], failures);

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
  validateNullableString(value.destructive_recovery_command, 'projection.destructive_recovery_command', failures);
  validateLockOwner(value.lock_owner, 'projection.lock_owner', failures);
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
