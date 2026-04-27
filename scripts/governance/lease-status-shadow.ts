import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { listCurrentResourceLocks } from './current-resource-lock-manifest';
import type {
  GovernanceRuntimeLockLease,
  GovernanceRuntimeLockMode,
  GovernanceRuntimeLockScopeKind,
} from './governance-lock-lease-manager';
import { redactSensitiveText } from './redaction';

export const MINIMAL_LEASE_STATUS_SHADOW_SCHEMA = 'agentsmith_lease_status_shadow/v1' as const;
export const MINIMAL_LEASE_STATUS_SHADOW_VERSION = 1 as const;
export const GOVERNANCE_LEASE_SNAPSHOT_PATH_ENV = 'AGENTSMITH_GOVERNANCE_LEASE_SNAPSHOT_PATH' as const;
export const GOVERNANCE_LEASE_SNAPSHOT_JSON_ENV = 'AGENTSMITH_GOVERNANCE_LEASE_SNAPSHOT_JSON' as const;
export const DEFAULT_LEASE_STATUS_SHADOW_SECRET_NAMES = ['BACKEND_REAL_API_KEY'] as const;

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

export interface MinimalLeaseSecretProfileSummary {
  present: boolean;
  digest: string | null;
}

export interface MinimalLeaseSecretProfileSection extends MinimalLeaseLockSection {
  profile: MinimalLeaseSecretProfileSummary;
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

export interface ResolveMinimalLeaseStatusShadowInput {
  env?: Readonly<Record<string, string | undefined>>;
  snapshotPath?: string | null;
  snapshotJson?: string | null;
  requiredSecretNames?: readonly string[];
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
const SECRET_SECTION_FIELDS = new Set<string>(['present', 'lock_id', 'owners', 'profile']);
const SECRET_PROFILE_FIELDS = new Set<string>(['present', 'digest']);
const FORBIDDEN_SECRET_VALUE_FIELDS = new Set<string>([
  'value',
  'value_digest',
  'raw_value',
  'secret_value',
  'raw_secret',
  'token_value',
  'password_value',
]);
const RUNTIME_LOCK_SCOPE_KINDS = new Set<GovernanceRuntimeLockScopeKind>([
  'campaign_root',
  'step_output',
  'local_host',
  'provider_profile',
  'visual_baseline',
  'release_latest',
]);
const RUNTIME_LOCK_MODES = new Set<GovernanceRuntimeLockMode>(['exclusive']);

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
    lease_id: safeLeaseText(lease.leaseId),
    lock_id: safeLeaseText(lease.lockId),
    scope_kind: safeLeaseText(lease.scopeKind),
    scope_key: safeLeaseText(lease.scopeKey),
    owner_group: safeLeaseText(lease.ownerGroup),
    owner_attempt_id: safeLeaseText(lease.ownerAttemptId),
    owner_step_id: safeLeaseText(lease.ownerStepId),
    mode: safeLeaseText(lease.mode),
    campaign_id: safeNullableLeaseText(lease.campaignId),
    run_id: safeNullableLeaseText(lease.runId),
    campaign_root: safeNullableLeaseText(lease.campaignRoot),
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

function secretProfile(
  requiredSecretNames: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): MinimalLeaseSecretProfileSummary {
  const names = [...new Set(requiredSecretNames)].sort((left, right) => left.localeCompare(right));
  const presence = names.map((name) => {
    const value = env[name];
    return typeof value === 'string' && value.length > 0;
  });
  const present = presence.some(Boolean);
  return {
    present,
    digest: present ? sha256(JSON.stringify({ presence })) : null,
  };
}

function safeLeaseText(value: string): string {
  const redacted = redactSensitiveText(value);
  return redacted.trim().length > 0 ? redacted : '[redacted]';
}

function safeNullableLeaseText(value: string | null): string | null {
  return value === null ? null : safeLeaseText(value);
}

function safeLockId(value: string | null): string | null {
  return value === null ? null : safeLeaseText(value);
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return (
    ISO_TIMESTAMP_PATTERN.test(value)
    && !Number.isNaN(parsed.getTime())
    && parsed.toISOString() === value
  );
}

function sanitizeOwnerRef(owner: MinimalLeaseOwnerRef): MinimalLeaseOwnerRef {
  return {
    lease_id: safeLeaseText(owner.lease_id),
    lock_id: safeLeaseText(owner.lock_id),
    scope_kind: safeLeaseText(owner.scope_kind),
    scope_key: safeLeaseText(owner.scope_key),
    owner_group: safeLeaseText(owner.owner_group),
    owner_attempt_id: safeLeaseText(owner.owner_attempt_id),
    owner_step_id: safeLeaseText(owner.owner_step_id),
    mode: safeLeaseText(owner.mode),
    campaign_id: safeNullableLeaseText(owner.campaign_id),
    run_id: safeNullableLeaseText(owner.run_id),
    campaign_root: safeNullableLeaseText(owner.campaign_root),
    acquired_at: owner.acquired_at,
    pid: owner.pid,
  };
}

function sanitizeLockSection(section: MinimalLeaseLockSection): MinimalLeaseLockSection {
  return {
    present: section.present,
    lock_id: safeLockId(section.lock_id),
    owners: section.owners.map(sanitizeOwnerRef),
  };
}

function sanitizePortFamilySection(section: MinimalLeasePortFamilySection): MinimalLeasePortFamilySection {
  return {
    ...sanitizeLockSection(section),
    families: section.families.map((family) => ({
      name: safeLeaseText(family.name),
      ports: [...family.ports],
    })),
  };
}

function sanitizeSecretProfileSection(section: MinimalLeaseSecretProfileSection): MinimalLeaseSecretProfileSection {
  return {
    ...sanitizeLockSection(section),
    profile: {
      present: section.profile.present,
      digest: section.profile.digest,
    },
  };
}

function sanitizeActiveRun(activeRun: MinimalLeaseActiveRun | null): MinimalLeaseActiveRun | null {
  if (!activeRun) {
    return null;
  }
  return {
    run_id: safeLeaseText(activeRun.run_id),
    campaign_id: safeNullableLeaseText(activeRun.campaign_id),
    campaign_root: safeNullableLeaseText(activeRun.campaign_root),
    owner_group: safeLeaseText(activeRun.owner_group),
    owner_step_id: safeLeaseText(activeRun.owner_step_id),
    started_at: activeRun.started_at,
  };
}

function sanitizeMinimalLeaseStatusShadow(shadow: MinimalLeaseStatusShadow): MinimalLeaseStatusShadow {
  return {
    schema: shadow.schema,
    version: shadow.version,
    projection_kind: shadow.projection_kind,
    generated_at: shadow.generated_at,
    leases_acquired: false,
    leases_released: false,
    active_run: sanitizeActiveRun(shadow.active_run),
    destructive_command_lock: sanitizeLockSection(shadow.destructive_command_lock),
    port_family: sanitizePortFamilySection(shadow.port_family),
    secret_profile_lock: sanitizeSecretProfileSection(shadow.secret_profile_lock),
    active_leases: shadow.active_leases.map(sanitizeOwnerRef),
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (nonEmptyString(value)) {
    return value;
  }
  return undefined;
}

function isRuntimeLockScopeKind(value: unknown): value is GovernanceRuntimeLockScopeKind {
  return typeof value === 'string' && RUNTIME_LOCK_SCOPE_KINDS.has(value as GovernanceRuntimeLockScopeKind);
}

function isRuntimeLockMode(value: unknown): value is GovernanceRuntimeLockMode {
  return typeof value === 'string' && RUNTIME_LOCK_MODES.has(value as GovernanceRuntimeLockMode);
}

function parseRuntimeLease(value: unknown): GovernanceRuntimeLockLease | null {
  if (!isRecord(value)) {
    return null;
  }

  const leaseId = value.leaseId;
  const lockId = value.lockId;
  const scopeKind = value.scopeKind;
  const scopeKey = value.scopeKey;
  const ownerGroup = value.ownerGroup;
  const ownerAttemptId = value.ownerAttemptId;
  const ownerStepId = value.ownerStepId;
  const mode = value.mode;
  const campaignId = nullableString(value.campaignId);
  const runId = nullableString(value.runId);
  const campaignRoot = nullableString(value.campaignRoot);
  const acquiredAt = value.acquiredAt;

  if (
    !nonEmptyString(leaseId)
    || !nonEmptyString(lockId)
    || !isRuntimeLockScopeKind(scopeKind)
    || !nonEmptyString(scopeKey)
    || !nonEmptyString(ownerGroup)
    || !nonEmptyString(ownerAttemptId)
    || !nonEmptyString(ownerStepId)
    || !isRuntimeLockMode(mode)
    || campaignId === undefined
    || runId === undefined
    || campaignRoot === undefined
    || !nonEmptyString(acquiredAt)
    || !isCanonicalIsoTimestamp(acquiredAt)
  ) {
    return null;
  }

  return {
    leaseId,
    lockId,
    scopeKind,
    scopeKey,
    ownerGroup,
    ownerAttemptId,
    ownerStepId,
    mode,
    campaignId,
    runId,
    campaignRoot,
    acquiredAt,
  };
}

function parseRuntimeLeases(value: unknown): readonly GovernanceRuntimeLockLease[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const leases: GovernanceRuntimeLockLease[] = [];
  for (const entry of value) {
    const lease = parseRuntimeLease(entry);
    if (!lease) {
      return null;
    }
    leases.push(lease);
  }
  return leases;
}

function runtimeLeasesFromSnapshotPayload(value: unknown): readonly GovernanceRuntimeLockLease[] | null {
  if (Array.isArray(value)) {
    return parseRuntimeLeases(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  if (hasOwn(value, 'activeLeases')) {
    return parseRuntimeLeases(value.activeLeases);
  }
  return null;
}

function readSnapshotPayload(input: ResolveMinimalLeaseStatusShadowInput): unknown | null {
  const env = input.env ?? process.env;
  const rawJson = input.snapshotJson ?? env[GOVERNANCE_LEASE_SNAPSHOT_JSON_ENV] ?? null;
  const snapshotPath = input.snapshotPath ?? env[GOVERNANCE_LEASE_SNAPSHOT_PATH_ENV] ?? null;

  try {
    if (rawJson && rawJson.trim().length > 0) {
      return JSON.parse(rawJson) as unknown;
    }
    if (snapshotPath && snapshotPath.trim().length > 0) {
      return JSON.parse(readFileSync(snapshotPath, 'utf8')) as unknown;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveMinimalLeaseStatusShadow(
  input: ResolveMinimalLeaseStatusShadowInput = {},
): MinimalLeaseStatusShadow | null {
  const payload = readSnapshotPayload(input);
  if (payload === null) {
    return null;
  }

  const existingShadow = validateMinimalLeaseStatusShadow(payload);
  if (existingShadow.ok) {
    const sanitized = sanitizeMinimalLeaseStatusShadow(existingShadow.value);
    return validateMinimalLeaseStatusShadow(sanitized).ok ? sanitized : null;
  }

  const activeLeases = runtimeLeasesFromSnapshotPayload(payload);
  if (!activeLeases) {
    return null;
  }

  const shadow = buildMinimalLeaseStatusShadow({
    activeLeases,
    requiredSecretNames: input.requiredSecretNames ?? DEFAULT_LEASE_STATUS_SHADOW_SECRET_NAMES,
    env: input.env ?? process.env,
    generatedAt: input.generatedAt,
  });
  return validateMinimalLeaseStatusShadow(shadow).ok ? shadow : null;
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
      profile: secretProfile(input.requiredSecretNames ?? [], input.env ?? {}),
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

function validateSecretProfileSummary(
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
  validateBoolean(value.present, `${path}.present`, failures);
  validateNullableDigest(value.digest, `${path}.digest`, failures);
  if (value.present === false && value.digest !== null) {
    pushFailure(failures, `${path}.digest`, 'absent secret profile must use digest null.');
  }
  if (value.present === true && value.digest === null) {
    pushFailure(failures, `${path}.digest`, 'present secret profile must use a profile digest.');
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
  validateSecretProfileSummary(value.profile, `${path}.profile`, failures);
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
