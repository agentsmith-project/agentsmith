import { createHash } from 'node:crypto';

import { listCurrentResourceLocks } from './current-resource-lock-manifest';
import type { GovernanceRuntimeLockLease } from './governance-lock-lease-manager';

export const MINIMAL_LEASE_STATUS_SHADOW_SCHEMA = 'agentsmith_lease_status_shadow/v1' as const;
export const MINIMAL_LEASE_STATUS_SHADOW_VERSION = 1 as const;

export interface MinimalLeaseOwnerRef {
  lease_id: string;
  lock_id: string;
  scope_kind: string;
  scope_key: string;
  owner_group: string;
  owner_attempt_id: string;
  owner_step_id: string;
  mode: string;
  campaign_id: string | null;
  run_id: string | null;
  campaign_root: string | null;
  acquired_at: string;
  pid: number | null;
}

export interface MinimalLeaseActiveRun {
  run_id: string;
  campaign_id: string | null;
  campaign_root: string | null;
  owner_group: string;
  owner_step_id: string;
  started_at: string;
}

export interface MinimalLeaseLockSection {
  present: boolean;
  lock_id: string | null;
  owners: readonly MinimalLeaseOwnerRef[];
}

export interface MinimalLeasePortFamily {
  name: string;
  ports: readonly number[];
}

export interface MinimalLeasePortFamilySection extends MinimalLeaseLockSection {
  families: readonly MinimalLeasePortFamily[];
}

export interface MinimalLeaseSecretProfile {
  name: string;
  present: boolean;
  digest: string | null;
}

export interface MinimalLeaseSecretProfileSection extends MinimalLeaseLockSection {
  profiles: readonly MinimalLeaseSecretProfile[];
}

export interface MinimalLeaseStatusShadow {
  schema: typeof MINIMAL_LEASE_STATUS_SHADOW_SCHEMA;
  version: typeof MINIMAL_LEASE_STATUS_SHADOW_VERSION;
  projection_kind: 'read_only_shadow';
  generated_at: string;
  leases_acquired: false;
  leases_released: false;
  active_run: MinimalLeaseActiveRun | null;
  destructive_command_lock: MinimalLeaseLockSection;
  port_family: MinimalLeasePortFamilySection;
  secret_profile_lock: MinimalLeaseSecretProfileSection;
  active_leases: readonly MinimalLeaseOwnerRef[];
}

export interface BuildMinimalLeaseStatusShadowInput {
  activeLeases: readonly GovernanceRuntimeLockLease[];
  requiredSecretNames?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  generatedAt?: string;
}

export interface MinimalLeaseStatusShadowValidationFailure {
  path: string;
  reason: string;
}

export type MinimalLeaseStatusShadowValidationResult =
  | {
      ok: true;
      value: MinimalLeaseStatusShadow;
    }
  | {
      ok: false;
      failures: readonly MinimalLeaseStatusShadowValidationFailure[];
    };

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHADOW_TOP_LEVEL_FIELDS = new Set<string>([
  'schema',
  'version',
  'projection_kind',
  'generated_at',
  'leases_acquired',
  'leases_released',
  'active_run',
  'destructive_command_lock',
  'port_family',
  'secret_profile_lock',
  'active_leases',
]);
const OWNER_FIELDS = new Set<string>([
  'lease_id',
  'lock_id',
  'scope_kind',
  'scope_key',
  'owner_group',
  'owner_attempt_id',
  'owner_step_id',
  'mode',
  'campaign_id',
  'run_id',
  'campaign_root',
  'acquired_at',
  'pid',
]);
const ACTIVE_RUN_FIELDS = new Set<string>([
  'run_id',
  'campaign_id',
  'campaign_root',
  'owner_group',
  'owner_step_id',
  'started_at',
]);
const LOCK_SECTION_FIELDS = new Set<string>(['present', 'lock_id', 'owners']);
const PORT_SECTION_FIELDS = new Set<string>(['present', 'lock_id', 'owners', 'families']);
const PORT_FAMILY_FIELDS = new Set<string>(['name', 'ports']);
const SECRET_SECTION_FIELDS = new Set<string>(['present', 'lock_id', 'owners', 'profiles']);
const SECRET_PROFILE_FIELDS = new Set<string>(['name', 'present', 'digest']);
const FORBIDDEN_SECRET_VALUE_FIELDS = new Set<string>([
  'value',
  'raw_value',
  'secret_value',
  'raw_secret',
  'token_value',
  'password_value',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pushFailure(
  failures: MinimalLeaseStatusShadowValidationFailure[],
  path: string,
  reason: string,
): void {
  failures.push({ path, reason });
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function ownerRef(lease: GovernanceRuntimeLockLease): MinimalLeaseOwnerRef {
  return {
    lease_id: lease.leaseId,
    lock_id: lease.lockId,
    scope_kind: lease.scopeKind,
    scope_key: lease.scopeKey,
    owner_group: lease.ownerGroup,
    owner_attempt_id: lease.ownerAttemptId,
    owner_step_id: lease.ownerStepId,
    mode: lease.mode,
    campaign_id: lease.campaignId,
    run_id: lease.runId,
    campaign_root: lease.campaignRoot,
    acquired_at: lease.acquiredAt,
    pid: null,
  };
}

function activeRunFromLeases(leases: readonly MinimalLeaseOwnerRef[]): MinimalLeaseActiveRun | null {
  const owner = leases.find((lease) => lease.run_id !== null);
  if (!owner || owner.run_id === null) {
    return null;
  }

  return {
    run_id: owner.run_id,
    campaign_id: owner.campaign_id,
    campaign_root: owner.campaign_root,
    owner_group: owner.owner_group,
    owner_step_id: owner.owner_step_id,
    started_at: owner.acquired_at,
  };
}

function portFamiliesFromManifest(): readonly MinimalLeasePortFamily[] {
  const fixedLocalPorts = listCurrentResourceLocks().find((lock) => lock.id === 'fixed-local-ports');
  const ports = fixedLocalPorts?.appliesTo.ports ?? [];
  return ports
    .filter((port) => port.kind === 'family')
    .map((port) => ({
      name: port.name,
      ports: port.values ? [...port.values] : [],
    }));
}

function secretProfiles(
  requiredSecretNames: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): readonly MinimalLeaseSecretProfile[] {
  return requiredSecretNames.map((name) => {
    const value = env[name];
    const present = typeof value === 'string' && value.length > 0;
    return {
      name,
      present,
      digest: present ? sha256(value) : null,
    };
  });
}

export function buildMinimalLeaseStatusShadow(
  input: BuildMinimalLeaseStatusShadowInput,
): MinimalLeaseStatusShadow {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const activeLeases = input.activeLeases.map(ownerRef);
  const destructiveOwners = activeLeases.filter((lease) => lease.lock_id === 'destructive-lifecycle');
  const portOwners = activeLeases.filter((lease) => lease.lock_id === 'fixed-local-ports');
  const secretOwners = activeLeases.filter((lease) => (
    lease.lock_id === 'provider-secret-profile'
    || lease.lock_id === 'backend-real-provider-quota'
  ));
  const providerSecretOwner = secretOwners.find((lease) => lease.lock_id === 'provider-secret-profile');

  return {
    schema: MINIMAL_LEASE_STATUS_SHADOW_SCHEMA,
    version: MINIMAL_LEASE_STATUS_SHADOW_VERSION,
    projection_kind: 'read_only_shadow',
    generated_at: generatedAt,
    leases_acquired: false,
    leases_released: false,
    active_run: activeRunFromLeases(activeLeases),
    destructive_command_lock: {
      present: destructiveOwners.length > 0,
      lock_id: destructiveOwners.length > 0 ? 'destructive-lifecycle' : null,
      owners: destructiveOwners,
    },
    port_family: {
      present: portOwners.length > 0,
      lock_id: portOwners.length > 0 ? 'fixed-local-ports' : null,
      owners: portOwners,
      families: portFamiliesFromManifest(),
    },
    secret_profile_lock: {
      present: secretOwners.length > 0,
      lock_id: providerSecretOwner ? 'provider-secret-profile' : secretOwners[0]?.lock_id ?? null,
      owners: secretOwners,
      profiles: secretProfiles(input.requiredSecretNames ?? [], input.env ?? {}),
    },
    active_leases: activeLeases,
  };
}

function validateForbiddenSecretValueFields(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateForbiddenSecretValueFields(entry, `${path}[${index}]`, failures);
    });
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_VALUE_FIELDS.has(key)) {
      pushFailure(failures, `${path}.${key}`, 'secret shadow may only expose presence and digest, not raw values.');
    }
    validateForbiddenSecretValueFields(nested, `${path}.${key}`, failures);
  }
}

function validateRequiredFields(
  record: Record<string, unknown>,
  path: string,
  fields: readonly string[],
  failures: MinimalLeaseStatusShadowValidationFailure[],
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
  failures: MinimalLeaseStatusShadowValidationFailure[],
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
  failures: MinimalLeaseStatusShadowValidationFailure[],
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
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  validateString(value, path, failures);
}

function validateBoolean(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (typeof value !== 'boolean') {
    pushFailure(failures, path, `${path} must be boolean.`);
  }
}

function validateBooleanFalse(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (value !== false) {
    pushFailure(failures, path, `${path} must be false for read-only lease shadow.`);
  }
}

function validateIsoTimestamp(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
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

function validateNullableDigest(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  const digest = validateString(value, path, failures);
  if (digest !== undefined && !SHA256_DIGEST_PATTERN.test(digest)) {
    pushFailure(failures, path, `${path} must use sha256:<64 lowercase hex>.`);
  }
}

function validateOwner(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, OWNER_FIELDS, failures);
  validateRequiredFields(value, path, [...OWNER_FIELDS], failures);
  validateString(value.lease_id, `${path}.lease_id`, failures);
  validateString(value.lock_id, `${path}.lock_id`, failures);
  validateString(value.scope_kind, `${path}.scope_kind`, failures);
  validateString(value.scope_key, `${path}.scope_key`, failures);
  validateString(value.owner_group, `${path}.owner_group`, failures);
  validateString(value.owner_attempt_id, `${path}.owner_attempt_id`, failures);
  validateString(value.owner_step_id, `${path}.owner_step_id`, failures);
  validateString(value.mode, `${path}.mode`, failures);
  validateNullableString(value.campaign_id, `${path}.campaign_id`, failures);
  validateNullableString(value.run_id, `${path}.run_id`, failures);
  validateNullableString(value.campaign_root, `${path}.campaign_root`, failures);
  validateIsoTimestamp(value.acquired_at, `${path}.acquired_at`, failures);
  if (value.pid !== null && (typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0)) {
    pushFailure(failures, `${path}.pid`, `${path}.pid must be a positive integer or null.`);
  }
}

function validateOwners(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    pushFailure(failures, path, `${path} must be an array.`);
    return;
  }
  value.forEach((entry, index) => {
    validateOwner(entry, `${path}[${index}]`, failures);
  });
}

function validateActiveRun(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object or null.`);
    return;
  }
  validateNoUnknownFields(value, path, ACTIVE_RUN_FIELDS, failures);
  validateRequiredFields(value, path, [...ACTIVE_RUN_FIELDS], failures);
  validateString(value.run_id, `${path}.run_id`, failures);
  validateNullableString(value.campaign_id, `${path}.campaign_id`, failures);
  validateNullableString(value.campaign_root, `${path}.campaign_root`, failures);
  validateString(value.owner_group, `${path}.owner_group`, failures);
  validateString(value.owner_step_id, `${path}.owner_step_id`, failures);
  validateIsoTimestamp(value.started_at, `${path}.started_at`, failures);
}

function validateLockSection(
  value: unknown,
  path: string,
  allowedFields: ReadonlySet<string>,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, allowedFields, failures);
  validateRequiredFields(value, path, [...allowedFields], failures);
  validateBoolean(value.present, `${path}.present`, failures);
  validateNullableString(value.lock_id, `${path}.lock_id`, failures);
  validateOwners(value.owners, `${path}.owners`, failures);
}

function validatePortFamily(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, PORT_FAMILY_FIELDS, failures);
  validateRequiredFields(value, path, [...PORT_FAMILY_FIELDS], failures);
  validateString(value.name, `${path}.name`, failures);
  if (!Array.isArray(value.ports)) {
    pushFailure(failures, `${path}.ports`, `${path}.ports must be an array.`);
    return;
  }
  value.ports.forEach((port, index) => {
    if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
      pushFailure(failures, `${path}.ports[${index}]`, `${path}.ports[${index}] must be a positive integer.`);
    }
  });
}

function validatePortFamilySection(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  validateLockSection(value, path, PORT_SECTION_FIELDS, failures);
  if (!isRecord(value)) {
    return;
  }
  if (!Array.isArray(value.families)) {
    pushFailure(failures, `${path}.families`, `${path}.families must be an array.`);
    return;
  }
  value.families.forEach((family, index) => {
    validatePortFamily(family, `${path}.families[${index}]`, failures);
  });
}

function validateSecretProfile(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  if (!isRecord(value)) {
    pushFailure(failures, path, `${path} must be an object.`);
    return;
  }
  validateNoUnknownFields(value, path, SECRET_PROFILE_FIELDS, failures);
  validateRequiredFields(value, path, [...SECRET_PROFILE_FIELDS], failures);
  validateString(value.name, `${path}.name`, failures);
  validateBoolean(value.present, `${path}.present`, failures);
  validateNullableDigest(value.digest, `${path}.digest`, failures);
  if (value.present === false && value.digest !== null) {
    pushFailure(failures, `${path}.digest`, 'absent secret profile must use digest null.');
  }
}

function validateSecretProfileSection(
  value: unknown,
  path: string,
  failures: MinimalLeaseStatusShadowValidationFailure[],
): void {
  validateLockSection(value, path, SECRET_SECTION_FIELDS, failures);
  if (!isRecord(value)) {
    return;
  }
  if (!Array.isArray(value.profiles)) {
    pushFailure(failures, `${path}.profiles`, `${path}.profiles must be an array.`);
    return;
  }
  value.profiles.forEach((profile, index) => {
    validateSecretProfile(profile, `${path}.profiles[${index}]`, failures);
  });
}

export function validateMinimalLeaseStatusShadow(value: unknown): MinimalLeaseStatusShadowValidationResult {
  const failures: MinimalLeaseStatusShadowValidationFailure[] = [];
  validateForbiddenSecretValueFields(value, 'shadow', failures);

  if (!isRecord(value)) {
    return {
      ok: false,
      failures: [{ path: 'shadow', reason: 'shadow must be a JSON object.' }],
    };
  }

  validateNoUnknownFields(value, 'shadow', SHADOW_TOP_LEVEL_FIELDS, failures);
  validateRequiredFields(value, 'shadow', [...SHADOW_TOP_LEVEL_FIELDS], failures);
  if (value.schema !== MINIMAL_LEASE_STATUS_SHADOW_SCHEMA) {
    pushFailure(failures, 'shadow.schema', `schema must be ${MINIMAL_LEASE_STATUS_SHADOW_SCHEMA}.`);
  }
  if (value.version !== MINIMAL_LEASE_STATUS_SHADOW_VERSION) {
    pushFailure(failures, 'shadow.version', `version must be ${String(MINIMAL_LEASE_STATUS_SHADOW_VERSION)}.`);
  }
  if (value.projection_kind !== 'read_only_shadow') {
    pushFailure(failures, 'shadow.projection_kind', 'projection_kind must be read_only_shadow.');
  }
  validateIsoTimestamp(value.generated_at, 'shadow.generated_at', failures);
  validateBooleanFalse(value.leases_acquired, 'shadow.leases_acquired', failures);
  validateBooleanFalse(value.leases_released, 'shadow.leases_released', failures);
  validateActiveRun(value.active_run, 'shadow.active_run', failures);
  validateLockSection(value.destructive_command_lock, 'shadow.destructive_command_lock', LOCK_SECTION_FIELDS, failures);
  validatePortFamilySection(value.port_family, 'shadow.port_family', failures);
  validateSecretProfileSection(value.secret_profile_lock, 'shadow.secret_profile_lock', failures);
  validateOwners(value.active_leases, 'shadow.active_leases', failures);

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return { ok: true, value: value as unknown as MinimalLeaseStatusShadow };
}
