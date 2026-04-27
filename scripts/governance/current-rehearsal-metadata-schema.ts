export const CURRENT_REHEARSAL_METADATA_SCHEMA = 'agentsmith_rehearsal_metadata/v1' as const;
export const CURRENT_REHEARSAL_METADATA_VERSION = 1 as const;

export const CURRENT_REHEARSAL_MODES = [
  'fast',
  'release-fidelity',
  'offline-package',
] as const;

export const CURRENT_REHEARSAL_RESET_LEVELS = [
  'none',
  'soft',
  'data',
  'substrate',
  'world',
] as const;

export const CURRENT_REHEARSAL_RUNTIME_LINES = [
  'demo-rehearsal',
  'cluster-rehearsal',
] as const;

export const CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS = [
  'passed',
  'reusable',
  'verdict',
  'claim_id',
  'failure_class',
  'result_status',
  'release_verdict',
  'automated_release_verdict',
] as const;

export const CURRENT_REHEARSAL_METADATA_RAW_SECRET_FIELDS = [
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

export type CurrentRehearsalMode = (typeof CURRENT_REHEARSAL_MODES)[number];
export type CurrentRehearsalResetLevel = (typeof CURRENT_REHEARSAL_RESET_LEVELS)[number];
export type CurrentRehearsalRuntimeLine = (typeof CURRENT_REHEARSAL_RUNTIME_LINES)[number];
export type CurrentRehearsalMetadataForbiddenField =
  (typeof CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS)[number];
export type CurrentRehearsalMetadataRawSecretField =
  (typeof CURRENT_REHEARSAL_METADATA_RAW_SECRET_FIELDS)[number];

export interface CurrentRehearsalWorldIdentity {
  runtime_line: CurrentRehearsalRuntimeLine;
  world_root: string;
  world_id?: string;
  cluster_name?: string;
  kind_cluster_name?: string;
  registry_name?: string;
  public_base_origin?: string;
  port_family?: string;
  service_ports: Readonly<Record<string, number | null>>;
  kind_config_digest?: string;
  registry_env_digest?: string;
  image_manifest_digest?: string;
  deploy_scripts_digest?: string;
  health_check_ref?: string;
}

export interface CurrentRehearsalSkipInvalidation {
  target: string;
  operation: string;
  input_digest: string;
  existing_artifact_digest: string;
  skip_reason: string;
  validator: string;
}

export interface CurrentRehearsalMetadata {
  schema: typeof CURRENT_REHEARSAL_METADATA_SCHEMA;
  version: typeof CURRENT_REHEARSAL_METADATA_VERSION;
  projection_kind: 'read_only_rehearsal_metadata';
  generated_at: string;
  rehearsal_mode: CurrentRehearsalMode;
  reset_level: CurrentRehearsalResetLevel;
  world_identity: CurrentRehearsalWorldIdentity;
  skip_invalidation: CurrentRehearsalSkipInvalidation;
  writes_canonical_result: false;
  produces_release_verdict: false;
  participates_in_evidence_completeness: false;
}

export interface BuildCurrentRehearsalMetadataInput {
  rehearsalMode: CurrentRehearsalMode;
  resetLevel: CurrentRehearsalResetLevel;
  worldIdentity: CurrentRehearsalWorldIdentity;
  skipInvalidation: CurrentRehearsalSkipInvalidation;
  generatedAt?: string;
}

export interface CurrentRehearsalMetadataValidationFailure {
  path: string;
  reason: string;
}

export type CurrentRehearsalMetadataValidationResult =
  | {
      ok: true;
      value: CurrentRehearsalMetadata;
    }
  | {
      ok: false;
      failures: readonly CurrentRehearsalMetadataValidationFailure[];
    };

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_SERVICE_PORT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const MODE_SET = new Set<string>(CURRENT_REHEARSAL_MODES);
const RESET_LEVEL_SET = new Set<string>(CURRENT_REHEARSAL_RESET_LEVELS);
const RUNTIME_LINE_SET = new Set<string>(CURRENT_REHEARSAL_RUNTIME_LINES);
const FORBIDDEN_FIELD_SET = new Set<string>([
  ...CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS,
  ...CURRENT_REHEARSAL_METADATA_RAW_SECRET_FIELDS,
]);
const RAW_SECRET_VALUE_PATTERNS = [
  /\bBearer\s+\S+/i,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/,
  /\b(?:access_token|refresh_token|id_token|api_key|client_secret|password|ticket)=\S+/i,
  /(?:^|[{\[,\s;])["']?(?:managed[_-]?credentials|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|password|ticket|secret[_-]?value|raw[_-]?secret|token[_-]?value|password[_-]?value|value)["']?\s*[:=]/i,
] as const;

const METADATA_FIELDS = new Set<string>([
  'schema',
  'version',
  'projection_kind',
  'generated_at',
  'rehearsal_mode',
  'reset_level',
  'world_identity',
  'skip_invalidation',
  'writes_canonical_result',
  'produces_release_verdict',
  'participates_in_evidence_completeness',
]);
const WORLD_IDENTITY_FIELDS = new Set<string>([
  'runtime_line',
  'world_root',
  'world_id',
  'cluster_name',
  'kind_cluster_name',
  'registry_name',
  'public_base_origin',
  'port_family',
  'service_ports',
  'kind_config_digest',
  'registry_env_digest',
  'image_manifest_digest',
  'deploy_scripts_digest',
  'health_check_ref',
]);
const SKIP_INVALIDATION_FIELDS = new Set<string>([
  'target',
  'operation',
  'input_digest',
  'existing_artifact_digest',
  'skip_reason',
  'validator',
]);
const WORLD_IDENTITY_DIGEST_FIELDS = [
  'kind_config_digest',
  'registry_env_digest',
  'image_manifest_digest',
  'deploy_scripts_digest',
] as const;

export function buildCurrentRehearsalMetadata(
  input: BuildCurrentRehearsalMetadataInput,
): CurrentRehearsalMetadata {
  const metadata: CurrentRehearsalMetadata = {
    schema: CURRENT_REHEARSAL_METADATA_SCHEMA,
    version: CURRENT_REHEARSAL_METADATA_VERSION,
    projection_kind: 'read_only_rehearsal_metadata',
    generated_at: input.generatedAt ?? new Date().toISOString(),
    rehearsal_mode: input.rehearsalMode,
    reset_level: input.resetLevel,
    world_identity: buildWorldIdentity(input.worldIdentity),
    skip_invalidation: {
      target: input.skipInvalidation.target,
      operation: input.skipInvalidation.operation,
      input_digest: input.skipInvalidation.input_digest,
      existing_artifact_digest: input.skipInvalidation.existing_artifact_digest,
      skip_reason: input.skipInvalidation.skip_reason,
      validator: input.skipInvalidation.validator,
    },
    writes_canonical_result: false,
    produces_release_verdict: false,
    participates_in_evidence_completeness: false,
  };
  const validation = validateCurrentRehearsalMetadata(metadata);
  if (!validation.ok) {
    const reasons = validation.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('; ');
    throw new Error(`invalid current rehearsal metadata input: ${reasons}`);
  }

  return metadata;
}

export function validateCurrentRehearsalMetadata(
  metadata: unknown,
): CurrentRehearsalMetadataValidationResult {
  const failures: CurrentRehearsalMetadataValidationFailure[] = [];

  validateForbiddenFields(metadata, 'metadata', failures);

  if (!isRecord(metadata)) {
    return {
      ok: false,
      failures: [
        ...failures,
        { path: 'metadata', reason: 'rehearsal metadata must be an object.' },
      ],
    };
  }

  validateAllowedFields(metadata, METADATA_FIELDS, 'rehearsal metadata', 'metadata', failures);
  validateLiteral(metadata.schema, CURRENT_REHEARSAL_METADATA_SCHEMA, 'metadata.schema', failures);
  validateLiteral(metadata.version, CURRENT_REHEARSAL_METADATA_VERSION, 'metadata.version', failures);
  validateLiteral(
    metadata.projection_kind,
    'read_only_rehearsal_metadata',
    'metadata.projection_kind',
    failures,
  );
  validateIsoTimestamp(metadata.generated_at, 'metadata.generated_at', failures);
  validateEnum(metadata.rehearsal_mode, MODE_SET, 'metadata.rehearsal_mode', failures);
  validateEnum(metadata.reset_level, RESET_LEVEL_SET, 'metadata.reset_level', failures);
  validateWorldIdentity(metadata.world_identity, failures);
  validateSkipInvalidation(metadata.skip_invalidation, failures);
  validateLiteral(metadata.writes_canonical_result, false, 'metadata.writes_canonical_result', failures);
  validateLiteral(metadata.produces_release_verdict, false, 'metadata.produces_release_verdict', failures);
  validateLiteral(
    metadata.participates_in_evidence_completeness,
    false,
    'metadata.participates_in_evidence_completeness',
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
    value: metadata as CurrentRehearsalMetadata,
  };
}

function validateWorldIdentity(
  value: unknown,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  const path = 'metadata.world_identity';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'world_identity must be an object.' });
    return;
  }

  validateAllowedFields(value, WORLD_IDENTITY_FIELDS, 'world identity', path, failures);
  validateEnum(value.runtime_line, RUNTIME_LINE_SET, `${path}.runtime_line`, failures);
  validateString(value.world_root, `${path}.world_root`, failures);
  validateOptionalString(value.world_id, `${path}.world_id`, failures);
  validateOptionalString(value.cluster_name, `${path}.cluster_name`, failures);
  validateOptionalString(value.kind_cluster_name, `${path}.kind_cluster_name`, failures);
  validateOptionalString(value.registry_name, `${path}.registry_name`, failures);
  validateOptionalString(value.port_family, `${path}.port_family`, failures);
  validateOptionalString(value.health_check_ref, `${path}.health_check_ref`, failures);
  validateOptionalOrigin(value.public_base_origin, `${path}.public_base_origin`, failures);
  validateServicePorts(value.service_ports, `${path}.service_ports`, failures);

  for (const field of WORLD_IDENTITY_DIGEST_FIELDS) {
    validateOptionalDigest(value[field], `${path}.${field}`, failures);
  }
}

function validateSkipInvalidation(
  value: unknown,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  const path = 'metadata.skip_invalidation';
  if (!isRecord(value)) {
    failures.push({ path, reason: 'skip_invalidation must be an object.' });
    return;
  }

  validateAllowedFields(value, SKIP_INVALIDATION_FIELDS, 'skip invalidation', path, failures);
  validateString(value.target, `${path}.target`, failures);
  validateString(value.operation, `${path}.operation`, failures);
  validateDigest(value.input_digest, `${path}.input_digest`, failures);
  validateDigest(value.existing_artifact_digest, `${path}.existing_artifact_digest`, failures);
  validateString(value.skip_reason, `${path}.skip_reason`, failures);
  validateString(value.validator, `${path}.validator`, failures);
}

function buildWorldIdentity(input: CurrentRehearsalWorldIdentity): CurrentRehearsalWorldIdentity {
  const worldIdentity: CurrentRehearsalWorldIdentity = {
    runtime_line: input.runtime_line,
    world_root: input.world_root,
    service_ports: { ...input.service_ports },
  };

  if (input.world_id !== undefined) {
    worldIdentity.world_id = input.world_id;
  }
  if (input.cluster_name !== undefined) {
    worldIdentity.cluster_name = input.cluster_name;
  }
  if (input.kind_cluster_name !== undefined) {
    worldIdentity.kind_cluster_name = input.kind_cluster_name;
  }
  if (input.registry_name !== undefined) {
    worldIdentity.registry_name = input.registry_name;
  }
  if (input.public_base_origin !== undefined) {
    worldIdentity.public_base_origin = input.public_base_origin;
  }
  if (input.port_family !== undefined) {
    worldIdentity.port_family = input.port_family;
  }
  if (input.kind_config_digest !== undefined) {
    worldIdentity.kind_config_digest = input.kind_config_digest;
  }
  if (input.registry_env_digest !== undefined) {
    worldIdentity.registry_env_digest = input.registry_env_digest;
  }
  if (input.image_manifest_digest !== undefined) {
    worldIdentity.image_manifest_digest = input.image_manifest_digest;
  }
  if (input.deploy_scripts_digest !== undefined) {
    worldIdentity.deploy_scripts_digest = input.deploy_scripts_digest;
  }
  if (input.health_check_ref !== undefined) {
    worldIdentity.health_check_ref = input.health_check_ref;
  }

  return worldIdentity;
}

function validateServicePorts(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({ path, reason: 'service_ports must be an object.' });
    return;
  }

  for (const [key, port] of Object.entries(value)) {
    if (!SAFE_SERVICE_PORT_KEY_PATTERN.test(key)) {
      failures.push({ path: `${path}.${key}`, reason: 'service port name must be a safe identifier.' });
    }
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      failures.push({ path: `${path}.${key}`, reason: 'service port must be null or an integer from 1 to 65535.' });
    }
  }
}

function validateForbiddenFields(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (typeof value === 'string') {
    if (RAW_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      failures.push({ path, reason: 'raw secret-looking values are not allowed in rehearsal metadata.' });
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
      failures.push({ path: childPath, reason: `field "${key}" is forbidden in rehearsal metadata.` });
    }
    validateForbiddenFields(entry, childPath, failures);
  }
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({ path: `${path}.${key}`, reason: `unknown ${label} field "${key}".` });
    }
  }
}

function validateString(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({ path, reason: 'value must be a non-empty string.' });
  }
}

function validateOptionalString(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (value !== undefined) {
    validateString(value, path, failures);
  }
}

function validateIsoTimestamp(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    failures.push({ path, reason: 'value must be an ISO-8601 UTC timestamp.' });
  }
}

function validateDigest(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (typeof value !== 'string' || !SHA256_DIGEST_PATTERN.test(value)) {
    failures.push({ path, reason: 'value must be a sha256 digest.' });
  }
}

function validateOptionalDigest(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (value !== undefined) {
    validateDigest(value, path, failures);
  }
}

function validateOptionalOrigin(
  value: unknown,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (value === undefined) {
    return;
  }
  validateString(value, path, failures);
  if (typeof value !== 'string') {
    return;
  }

  try {
    const url = new URL(value);
    if (url.origin !== value) {
      failures.push({ path, reason: 'public_base_origin must be an origin without path, query, or credentials.' });
    }
    if (url.username || url.password) {
      failures.push({ path, reason: 'public_base_origin must not include credentials.' });
    }
  } catch {
    failures.push({ path, reason: 'public_base_origin must be a valid URL origin.' });
  }
}

function validateEnum(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    failures.push({ path, reason: 'value is not in the current rehearsal metadata enum.' });
  }
}

function validateLiteral(
  value: unknown,
  expected: string | number | boolean,
  path: string,
  failures: CurrentRehearsalMetadataValidationFailure[],
): void {
  if (value !== expected) {
    failures.push({ path, reason: `value must be ${String(expected)}.` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
