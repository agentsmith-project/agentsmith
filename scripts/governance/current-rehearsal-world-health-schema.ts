export const CURRENT_REHEARSAL_WORLD_HEALTH_SCHEMA = 'agentsmith_rehearsal_world_health_snapshot/v1' as const;
export const CURRENT_REHEARSAL_WORLD_HEALTH_VERSION = 1 as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_RUNTIME_LINES = [
  'demo-rehearsal',
  'cluster-rehearsal',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_MODES = [
  'fast',
  'release-fidelity',
  'offline-package',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_STATUSES = [
  'healthy',
  'degraded',
  'missing',
  'unknown',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_RESET_LEVELS = [
  'none',
  'soft',
  'data',
  'substrate',
  'world',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_PRESENCE = [
  'present',
  'absent',
  'unknown',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_COMPONENT_STATUSES = [
  'healthy',
  'unhealthy',
  'missing',
  'inactive',
  'skipped',
  'unknown',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_FORBIDDEN_FIELDS = [
  'passed',
  'reusable',
  'verdict',
  'claim_id',
  'failure_class',
  'result_status',
  'release_verdict',
  'automated_release_verdict',
  'release_decision',
  'skip_invalidation',
  'cache_hit',
  'claim_reuse',
] as const;

export const CURRENT_REHEARSAL_WORLD_HEALTH_RAW_SECRET_FIELDS = [
  'value',
  'raw_value',
  'secret_value',
  'raw_secret',
  'token_value',
  'password_value',
  'authorization',
  'cookie',
  'api_key',
  'access_token',
  'refresh_token',
  'oauth_token',
  'client_secret',
  'password',
  'ticket',
  'managed_credentials',
] as const;

export type CurrentRehearsalWorldHealthRuntimeLine =
  (typeof CURRENT_REHEARSAL_WORLD_HEALTH_RUNTIME_LINES)[number];
export type CurrentRehearsalWorldHealthMode =
  (typeof CURRENT_REHEARSAL_WORLD_HEALTH_MODES)[number];
export type CurrentRehearsalWorldHealthStatus =
  (typeof CURRENT_REHEARSAL_WORLD_HEALTH_STATUSES)[number];
export type CurrentRehearsalWorldHealthResetLevel =
  (typeof CURRENT_REHEARSAL_WORLD_HEALTH_RESET_LEVELS)[number];
export type CurrentRehearsalWorldHealthPresence =
  (typeof CURRENT_REHEARSAL_WORLD_HEALTH_PRESENCE)[number];
export type CurrentRehearsalWorldHealthComponentStatus =
  (typeof CURRENT_REHEARSAL_WORLD_HEALTH_COMPONENT_STATUSES)[number];

export interface CurrentRehearsalWorldHealthServiceHealth {
  status: CurrentRehearsalWorldHealthComponentStatus;
  observed: string | null;
}

export interface CurrentRehearsalWorldHealthPublicBases {
  web: string | null;
  api: string | null;
  keycloak: string | null;
  sandbox: string | null;
}

export interface CurrentRehearsalWorldHealthPorts {
  web: number | null;
  api: number | null;
  keycloak: number | null;
  sandbox: number | null;
  registry: number | null;
}

export interface CurrentRehearsalWorldHealthKindCluster {
  name: string;
  present: CurrentRehearsalWorldHealthPresence;
}

export interface CurrentRehearsalWorldHealthRegistry {
  name: string;
  host: string;
  host_port: number | null;
  present: CurrentRehearsalWorldHealthPresence;
}

export interface CurrentRehearsalWorldIdentity {
  runtime_line: CurrentRehearsalWorldHealthRuntimeLine;
  world_root: string;
  world_id: string;
  active_scenario: string | null;
  phase: string | null;
  release_id: string | null;
  public_bases: CurrentRehearsalWorldHealthPublicBases;
  ports: CurrentRehearsalWorldHealthPorts;
  kind_cluster: CurrentRehearsalWorldHealthKindCluster;
  registry: CurrentRehearsalWorldHealthRegistry;
}

export interface CurrentRehearsalWorldComponentHealth {
  world_root: CurrentRehearsalWorldHealthPresence;
  state_file: CurrentRehearsalWorldHealthPresence;
  current_release: CurrentRehearsalWorldHealthPresence;
  web: CurrentRehearsalWorldHealthServiceHealth;
  api: CurrentRehearsalWorldHealthServiceHealth;
  keycloak: CurrentRehearsalWorldHealthServiceHealth;
  sandbox: CurrentRehearsalWorldHealthServiceHealth;
}

export interface CurrentRehearsalWorldHealthAuthorityPaths {
  world_root: string;
  active_scenario_lock: string;
  active_scenario_state: string;
  state_file: string;
  site_env: string;
  registry_env: string;
  current_release: string;
  reports: string;
}

export interface CurrentRehearsalWorldHealthSnapshot {
  schema: typeof CURRENT_REHEARSAL_WORLD_HEALTH_SCHEMA;
  version: typeof CURRENT_REHEARSAL_WORLD_HEALTH_VERSION;
  projection_kind: 'read_only_rehearsal_world_health_snapshot';
  generated_at: string;
  runtime_line: CurrentRehearsalWorldHealthRuntimeLine;
  rehearsal_mode: CurrentRehearsalWorldHealthMode;
  health_status: CurrentRehearsalWorldHealthStatus;
  world_identity: CurrentRehearsalWorldIdentity;
  component_health: CurrentRehearsalWorldComponentHealth;
  safe_reset_level: CurrentRehearsalWorldHealthResetLevel;
  safe_next_command: string;
  safe_reset_reason: string;
  authority_paths: CurrentRehearsalWorldHealthAuthorityPaths;
  notes: readonly string[];
  diagnostic_only: true;
  mutates_world: false;
  writes_canonical_result: false;
  participates_in_evidence_completeness: false;
}

export interface BuildCurrentRehearsalWorldHealthSnapshotInput {
  generatedAt?: string;
  runtimeLine: CurrentRehearsalWorldHealthRuntimeLine;
  rehearsalMode: CurrentRehearsalWorldHealthMode;
  healthStatus: CurrentRehearsalWorldHealthStatus;
  worldIdentity: CurrentRehearsalWorldIdentity;
  componentHealth: CurrentRehearsalWorldComponentHealth;
  safeResetLevel: CurrentRehearsalWorldHealthResetLevel;
  safeNextCommand: string;
  safeResetReason: string;
  authorityPaths: CurrentRehearsalWorldHealthAuthorityPaths;
  notes?: readonly string[];
}

export interface CurrentRehearsalWorldHealthValidationFailure {
  path: string;
  reason: string;
}

export type CurrentRehearsalWorldHealthValidationResult =
  | {
      ok: true;
      value: CurrentRehearsalWorldHealthSnapshot;
    }
  | {
      ok: false;
      failures: readonly CurrentRehearsalWorldHealthValidationFailure[];
    };

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_WORLD_ID_PATTERN = /^[a-z0-9][a-z0-9:._/-]*$/;
const RUNTIME_LINE_SET = new Set<string>(CURRENT_REHEARSAL_WORLD_HEALTH_RUNTIME_LINES);
const MODE_SET = new Set<string>(CURRENT_REHEARSAL_WORLD_HEALTH_MODES);
const HEALTH_STATUS_SET = new Set<string>(CURRENT_REHEARSAL_WORLD_HEALTH_STATUSES);
const RESET_LEVEL_SET = new Set<string>(CURRENT_REHEARSAL_WORLD_HEALTH_RESET_LEVELS);
const PRESENCE_SET = new Set<string>(CURRENT_REHEARSAL_WORLD_HEALTH_PRESENCE);
const COMPONENT_STATUS_SET = new Set<string>(CURRENT_REHEARSAL_WORLD_HEALTH_COMPONENT_STATUSES);
const FORBIDDEN_FIELD_SET = new Set<string>([
  ...CURRENT_REHEARSAL_WORLD_HEALTH_FORBIDDEN_FIELDS,
  ...CURRENT_REHEARSAL_WORLD_HEALTH_RAW_SECRET_FIELDS,
]);
const RAW_SECRET_VALUE_PATTERNS = [
  /\bBearer\s+\S+/i,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/,
  /\b(?:access_token|refresh_token|id_token|api_key|client_secret|password|ticket)=\S+/i,
  /(?:^|[/?&#{\[,\s;])["']?(?:managed[_-]?credentials|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|password|ticket|secret[_-]?value|raw[_-]?secret|token[_-]?value|password[_-]?value|value)["']?\s*[:=]/i,
] as const;

const SNAPSHOT_FIELDS = new Set<string>([
  'schema',
  'version',
  'projection_kind',
  'generated_at',
  'runtime_line',
  'rehearsal_mode',
  'health_status',
  'world_identity',
  'component_health',
  'safe_reset_level',
  'safe_next_command',
  'safe_reset_reason',
  'authority_paths',
  'notes',
  'diagnostic_only',
  'mutates_world',
  'writes_canonical_result',
  'participates_in_evidence_completeness',
]);
const WORLD_IDENTITY_FIELDS = new Set<string>([
  'runtime_line',
  'world_root',
  'world_id',
  'active_scenario',
  'phase',
  'release_id',
  'public_bases',
  'ports',
  'kind_cluster',
  'registry',
]);
const PUBLIC_BASE_FIELDS = new Set<string>(['web', 'api', 'keycloak', 'sandbox']);
const PORT_FIELDS = new Set<string>(['web', 'api', 'keycloak', 'sandbox', 'registry']);
const KIND_CLUSTER_FIELDS = new Set<string>(['name', 'present']);
const REGISTRY_FIELDS = new Set<string>(['name', 'host', 'host_port', 'present']);
const COMPONENT_HEALTH_FIELDS = new Set<string>([
  'world_root',
  'state_file',
  'current_release',
  'web',
  'api',
  'keycloak',
  'sandbox',
]);
const SERVICE_HEALTH_FIELDS = new Set<string>(['status', 'observed']);
const AUTHORITY_PATH_FIELDS = new Set<string>([
  'world_root',
  'active_scenario_lock',
  'active_scenario_state',
  'state_file',
  'site_env',
  'registry_env',
  'current_release',
  'reports',
]);

export function buildCurrentRehearsalWorldHealthSnapshot(
  input: BuildCurrentRehearsalWorldHealthSnapshotInput,
): CurrentRehearsalWorldHealthSnapshot {
  const snapshot: CurrentRehearsalWorldHealthSnapshot = {
    schema: CURRENT_REHEARSAL_WORLD_HEALTH_SCHEMA,
    version: CURRENT_REHEARSAL_WORLD_HEALTH_VERSION,
    projection_kind: 'read_only_rehearsal_world_health_snapshot',
    generated_at: input.generatedAt ?? new Date().toISOString(),
    runtime_line: input.runtimeLine,
    rehearsal_mode: input.rehearsalMode,
    health_status: input.healthStatus,
    world_identity: buildWorldIdentity(input.worldIdentity),
    component_health: buildComponentHealth(input.componentHealth),
    safe_reset_level: input.safeResetLevel,
    safe_next_command: input.safeNextCommand,
    safe_reset_reason: input.safeResetReason,
    authority_paths: { ...input.authorityPaths },
    notes: [...(input.notes ?? [])],
    diagnostic_only: true,
    mutates_world: false,
    writes_canonical_result: false,
    participates_in_evidence_completeness: false,
  };
  const validation = validateCurrentRehearsalWorldHealthSnapshot(snapshot);
  if (!validation.ok) {
    const reasons = validation.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('; ');
    throw new Error(`invalid current rehearsal world health snapshot input: ${reasons}`);
  }
  return snapshot;
}

export function validateCurrentRehearsalWorldHealthSnapshot(
  snapshot: unknown,
): CurrentRehearsalWorldHealthValidationResult {
  const failures: CurrentRehearsalWorldHealthValidationFailure[] = [];

  validateForbiddenFields(snapshot, 'snapshot', failures);

  if (!isRecord(snapshot)) {
    return {
      ok: false,
      failures: [
        ...failures,
        { path: 'snapshot', reason: 'world health snapshot must be an object.' },
      ],
    };
  }

  validateAllowedFields(snapshot, SNAPSHOT_FIELDS, 'snapshot', 'snapshot', failures);
  validateRequiredFields(snapshot, SNAPSHOT_FIELDS, 'snapshot', failures);
  validateLiteral(snapshot.schema, CURRENT_REHEARSAL_WORLD_HEALTH_SCHEMA, 'snapshot.schema', failures);
  validateLiteral(snapshot.version, CURRENT_REHEARSAL_WORLD_HEALTH_VERSION, 'snapshot.version', failures);
  validateLiteral(
    snapshot.projection_kind,
    'read_only_rehearsal_world_health_snapshot',
    'snapshot.projection_kind',
    failures,
  );
  validateIsoTimestamp(snapshot.generated_at, 'snapshot.generated_at', failures);
  validateEnum(snapshot.runtime_line, RUNTIME_LINE_SET, 'snapshot.runtime_line', failures);
  validateEnum(snapshot.rehearsal_mode, MODE_SET, 'snapshot.rehearsal_mode', failures);
  validateEnum(snapshot.health_status, HEALTH_STATUS_SET, 'snapshot.health_status', failures);
  validateWorldIdentity(snapshot.world_identity, failures);
  validateComponentHealth(snapshot.component_health, failures);
  validateEnum(snapshot.safe_reset_level, RESET_LEVEL_SET, 'snapshot.safe_reset_level', failures);
  validateString(snapshot.safe_next_command, 'snapshot.safe_next_command', failures);
  validateString(snapshot.safe_reset_reason, 'snapshot.safe_reset_reason', failures);
  validateAuthorityPaths(snapshot.authority_paths, failures);
  validateStringArray(snapshot.notes, 'snapshot.notes', failures);
  validateLiteral(snapshot.diagnostic_only, true, 'snapshot.diagnostic_only', failures);
  validateLiteral(snapshot.mutates_world, false, 'snapshot.mutates_world', failures);
  validateLiteral(snapshot.writes_canonical_result, false, 'snapshot.writes_canonical_result', failures);
  validateLiteral(
    snapshot.participates_in_evidence_completeness,
    false,
    'snapshot.participates_in_evidence_completeness',
    failures,
  );

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: snapshot as CurrentRehearsalWorldHealthSnapshot,
  };
}

function buildWorldIdentity(input: CurrentRehearsalWorldIdentity): CurrentRehearsalWorldIdentity {
  return {
    runtime_line: input.runtime_line,
    world_root: input.world_root,
    world_id: input.world_id,
    active_scenario: input.active_scenario,
    phase: input.phase,
    release_id: input.release_id,
    public_bases: { ...input.public_bases },
    ports: { ...input.ports },
    kind_cluster: { ...input.kind_cluster },
    registry: { ...input.registry },
  };
}

function buildComponentHealth(
  input: CurrentRehearsalWorldComponentHealth,
): CurrentRehearsalWorldComponentHealth {
  return {
    world_root: input.world_root,
    state_file: input.state_file,
    current_release: input.current_release,
    web: { ...input.web },
    api: { ...input.api },
    keycloak: { ...input.keycloak },
    sandbox: { ...input.sandbox },
  };
}

function validateWorldIdentity(
  value: unknown,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  const path = 'snapshot.world_identity';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'world_identity must be an object.' });
    return;
  }

  validateAllowedFields(value, WORLD_IDENTITY_FIELDS, 'world identity', path, failures);
  validateRequiredFields(value, WORLD_IDENTITY_FIELDS, path, failures);
  validateEnum(value.runtime_line, RUNTIME_LINE_SET, `${path}.runtime_line`, failures);
  validateString(value.world_root, `${path}.world_root`, failures);
  validateWorldId(value.world_id, `${path}.world_id`, failures);
  validateNullableString(value.active_scenario, `${path}.active_scenario`, failures);
  validateNullableString(value.phase, `${path}.phase`, failures);
  validateNullableString(value.release_id, `${path}.release_id`, failures);
  validatePublicBases(value.public_bases, failures);
  validatePorts(value.ports, `${path}.ports`, failures);
  validateKindCluster(value.kind_cluster, failures);
  validateRegistry(value.registry, failures);
}

function validatePublicBases(
  value: unknown,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  const path = 'snapshot.world_identity.public_bases';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'public_bases must be an object.' });
    return;
  }
  validateAllowedFields(value, PUBLIC_BASE_FIELDS, 'public base', path, failures);
  validateRequiredFields(value, PUBLIC_BASE_FIELDS, path, failures);
  for (const field of PUBLIC_BASE_FIELDS) {
    validateNullableUrl(value[field], `${path}.${field}`, failures);
  }
}

function validatePorts(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({ path, reason: 'ports must be an object.' });
    return;
  }
  validateAllowedFields(value, PORT_FIELDS, 'port', path, failures);
  validateRequiredFields(value, PORT_FIELDS, path, failures);
  for (const field of PORT_FIELDS) {
    validateNullablePort(value[field], `${path}.${field}`, failures);
  }
}

function validateKindCluster(
  value: unknown,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  const path = 'snapshot.world_identity.kind_cluster';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'kind_cluster must be an object.' });
    return;
  }
  validateAllowedFields(value, KIND_CLUSTER_FIELDS, 'kind cluster', path, failures);
  validateRequiredFields(value, KIND_CLUSTER_FIELDS, path, failures);
  validateString(value.name, `${path}.name`, failures);
  validateEnum(value.present, PRESENCE_SET, `${path}.present`, failures);
}

function validateRegistry(
  value: unknown,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  const path = 'snapshot.world_identity.registry';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'registry must be an object.' });
    return;
  }
  validateAllowedFields(value, REGISTRY_FIELDS, 'registry', path, failures);
  validateRequiredFields(value, REGISTRY_FIELDS, path, failures);
  validateString(value.name, `${path}.name`, failures);
  validateString(value.host, `${path}.host`, failures);
  validateNullablePort(value.host_port, `${path}.host_port`, failures);
  validateEnum(value.present, PRESENCE_SET, `${path}.present`, failures);
}

function validateComponentHealth(
  value: unknown,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  const path = 'snapshot.component_health';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'component_health must be an object.' });
    return;
  }
  validateAllowedFields(value, COMPONENT_HEALTH_FIELDS, 'component health', path, failures);
  validateRequiredFields(value, COMPONENT_HEALTH_FIELDS, path, failures);
  validateEnum(value.world_root, PRESENCE_SET, `${path}.world_root`, failures);
  validateEnum(value.state_file, PRESENCE_SET, `${path}.state_file`, failures);
  validateEnum(value.current_release, PRESENCE_SET, `${path}.current_release`, failures);
  validateServiceHealth(value.web, `${path}.web`, failures);
  validateServiceHealth(value.api, `${path}.api`, failures);
  validateServiceHealth(value.keycloak, `${path}.keycloak`, failures);
  validateServiceHealth(value.sandbox, `${path}.sandbox`, failures);
}

function validateServiceHealth(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({ path, reason: 'service health must be an object.' });
    return;
  }
  validateAllowedFields(value, SERVICE_HEALTH_FIELDS, 'service health', path, failures);
  validateRequiredFields(value, SERVICE_HEALTH_FIELDS, path, failures);
  validateEnum(value.status, COMPONENT_STATUS_SET, `${path}.status`, failures);
  validateNullableString(value.observed, `${path}.observed`, failures);
}

function validateAuthorityPaths(
  value: unknown,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  const path = 'snapshot.authority_paths';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'authority_paths must be an object.' });
    return;
  }
  validateAllowedFields(value, AUTHORITY_PATH_FIELDS, 'authority path', path, failures);
  validateRequiredFields(value, AUTHORITY_PATH_FIELDS, path, failures);
  for (const field of AUTHORITY_PATH_FIELDS) {
    validateString(value[field], `${path}.${field}`, failures);
  }
}

function validateForbiddenFields(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (typeof value === 'string') {
    if (RAW_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      failures.push({ path, reason: 'raw secret-looking values are not allowed in rehearsal world health snapshots.' });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateForbiddenFields(entry, `${path}[${index}]`, failures);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_FIELD_SET.has(key.toLowerCase())) {
      failures.push({ path: childPath, reason: `field "${key}" is forbidden in rehearsal world health snapshots.` });
    }
    validateForbiddenFields(entry, childPath, failures);
  }
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({ path: `${path}.${key}`, reason: `unknown ${label} field "${key}".` });
    }
  }
}

function validateRequiredFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      failures.push({ path: `${path}.${field}`, reason: `${field} is required.` });
    }
  }
}

function validateString(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({ path, reason: 'value must be a non-empty string.' });
  }
}

function validateNullableString(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  validateString(value, path, failures);
}

function validateStringArray(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    failures.push({ path, reason: 'value must be an array.' });
    return;
  }
  value.forEach((entry, index) => {
    validateString(entry, `${path}[${index}]`, failures);
  });
}

function validateIsoTimestamp(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    failures.push({ path, reason: 'value must be an ISO-8601 UTC timestamp.' });
    return;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    failures.push({ path, reason: 'value must be a canonical ISO-8601 UTC timestamp.' });
  }
}

function validateWorldId(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  validateString(value, path, failures);
  if (typeof value === 'string' && !SAFE_WORLD_ID_PATTERN.test(value)) {
    failures.push({ path, reason: 'world_id must be a safe lowercase identifier.' });
  }
}

function validateNullableUrl(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  validateString(value, path, failures);
  if (typeof value !== 'string') {
    return;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      failures.push({ path, reason: 'public URL must not include credentials.' });
    }
    if (url.search || url.hash) {
      failures.push({ path, reason: 'public URL must not include query or fragment values.' });
    }
  } catch {
    failures.push({ path, reason: 'public URL must be a valid URL.' });
  }
}

function validateNullablePort(
  value: unknown,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    failures.push({ path, reason: 'port must be null or an integer from 1 to 65535.' });
  }
}

function validateEnum(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    failures.push({ path, reason: 'value is not in the current rehearsal world health enum.' });
  }
}

function validateLiteral(
  value: unknown,
  expected: string | number | boolean,
  path: string,
  failures: CurrentRehearsalWorldHealthValidationFailure[],
): void {
  if (value !== expected) {
    failures.push({ path, reason: `value must be ${String(expected)}.` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
