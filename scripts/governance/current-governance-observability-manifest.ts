import {
  CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES,
  CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS,
  CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
} from './current-run-diagnostics-schema';
import {
  CURRENT_STATUS_PROJECTION_SCHEMA,
  CURRENT_STATUS_PROJECTION_VERSION,
} from './current-status-projection-schema';
import {
  MINIMAL_LEASE_STATUS_SHADOW_SCHEMA,
  MINIMAL_LEASE_STATUS_SHADOW_VERSION,
} from './lease-status-shadow';
import {
  CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS,
  CURRENT_REHEARSAL_METADATA_SCHEMA,
  CURRENT_REHEARSAL_METADATA_VERSION,
} from './current-rehearsal-metadata-schema';
import { ORDERED_SENTINEL_PROBES } from './sentinel-preflight';

export const CURRENT_GOVERNANCE_OBSERVABILITY_MANIFEST_SCHEMA =
  'current-governance-observability-manifest.v1' as const;
export const CURRENT_GOVERNANCE_OBSERVABILITY_MANIFEST_VERSION = 1 as const;

export const CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS = [
  'status_projection_schema',
  'run_diagnostics_artifacts',
  'sentinel_preflight',
  'lease_status_shadow',
  'rehearsal_metadata_schema',
  'redaction_boundary',
] as const;

export type CurrentGovernanceObservabilityObjectId =
  (typeof CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS)[number];

export type CurrentGovernanceObservabilityObjectKind =
  | 'read_only_projection'
  | 'diagnostic_artifact_family'
  | 'preflight_diagnostic'
  | 'read_only_shadow'
  | 'read_only_metadata_schema'
  | 'redaction_boundary';

export interface CurrentGovernanceObservabilityAuthority {
  read_only: boolean;
  diagnostic_audit: boolean;
  non_verdict: true;
  non_evidence_truth: true;
  writes_canonical_result: false;
  produces_release_verdict: false;
  participates_in_evidence_completeness: false;
}

export interface CurrentGovernanceObservabilitySafetyBoundary {
  forbidden_fields: readonly string[];
  allowed_output_fields?: readonly string[];
  redaction_required: boolean;
  raw_secret_output_allowed: false;
}

export interface CurrentGovernanceObservabilityObjectDefinition {
  id: CurrentGovernanceObservabilityObjectId;
  kind: CurrentGovernanceObservabilityObjectKind;
  schema_ref: string | null;
  schema_version: string | number | null;
  implementation_refs: readonly string[];
  contract_refs: readonly string[];
  docs_refs: readonly string[];
  authority: CurrentGovernanceObservabilityAuthority;
  safety_boundary: CurrentGovernanceObservabilitySafetyBoundary;
  artifact_files?: readonly string[];
  sentinel_probes?: readonly string[];
}

export interface CurrentGovernanceObservabilityManifest {
  objects: readonly CurrentGovernanceObservabilityObjectDefinition[];
}

export interface CurrentGovernanceObservabilityManifestFailure {
  path: string;
  reason: string;
}

export type CurrentGovernanceObservabilityManifestValidationResult =
  | {
      ok: true;
      value: CurrentGovernanceObservabilityManifest;
    }
  | {
      ok: false;
      failures: readonly CurrentGovernanceObservabilityManifestFailure[];
    };

const CONTRACT_DOC = 'docs/contracts/current-governance-observability-contract.md';
const SAFE_REDACTED_DIAGNOSTIC_FIELDS = [
  'presence',
  'profile_digest',
  'public_endpoint',
  'port_family',
] as const;
const SECRET_VALUE_FORBIDDEN_FIELDS = [
  'secret_value',
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

const NON_VERDICT_AUTHORITY = {
  non_verdict: true,
  non_evidence_truth: true,
  writes_canonical_result: false,
  produces_release_verdict: false,
  participates_in_evidence_completeness: false,
} as const;

export const CURRENT_GOVERNANCE_OBSERVABILITY_OBJECTS = [
  {
    id: 'status_projection_schema',
    kind: 'read_only_projection',
    schema_ref: CURRENT_STATUS_PROJECTION_SCHEMA,
    schema_version: CURRENT_STATUS_PROJECTION_VERSION,
    implementation_refs: [
      'scripts/governance/current-status-projection-schema.ts',
      'scripts/governance/status-projection.ts',
      'scripts/governance/release-status.ts',
      'scripts/governance/rehearsal-entrypoint.ts',
      'scripts/governance/local-real-status.ts',
    ],
    contract_refs: [CONTRACT_DOC],
    docs_refs: ['docs/contracts/README.md'],
    authority: {
      read_only: true,
      diagnostic_audit: false,
      ...NON_VERDICT_AUTHORITY,
    },
    safety_boundary: {
      forbidden_fields: ['release_verdict', 'automated_release_verdict'],
      redaction_required: true,
      raw_secret_output_allowed: false,
    },
  },
  {
    id: 'run_diagnostics_artifacts',
    kind: 'diagnostic_artifact_family',
    schema_ref: 'current-run-diagnostics-artifacts',
    schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
    implementation_refs: [
      'scripts/governance/current-run-diagnostics-schema.ts',
      'scripts/governance/run-diagnostics-writer.ts',
      'scripts/governance/current-run-diagnostic-selector.ts',
      'scripts/governance/run-rehearsal-stages.sh',
      'scripts/run-current-gate-result-wrapped.sh',
    ],
    contract_refs: [CONTRACT_DOC],
    docs_refs: ['docs/contracts/README.md'],
    authority: {
      read_only: false,
      diagnostic_audit: true,
      ...NON_VERDICT_AUTHORITY,
    },
    safety_boundary: {
      forbidden_fields: [...CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS],
      redaction_required: false,
      raw_secret_output_allowed: false,
    },
    artifact_files: Object.values(CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES),
  },
  {
    id: 'sentinel_preflight',
    kind: 'preflight_diagnostic',
    schema_ref: null,
    schema_version: null,
    implementation_refs: ['scripts/governance/sentinel-preflight.ts'],
    contract_refs: [CONTRACT_DOC],
    docs_refs: ['docs/contracts/README.md'],
    authority: {
      read_only: false,
      diagnostic_audit: true,
      ...NON_VERDICT_AUTHORITY,
    },
    safety_boundary: {
      forbidden_fields: [...SECRET_VALUE_FORBIDDEN_FIELDS],
      allowed_output_fields: [...SAFE_REDACTED_DIAGNOSTIC_FIELDS],
      redaction_required: true,
      raw_secret_output_allowed: false,
    },
    sentinel_probes: [...ORDERED_SENTINEL_PROBES],
  },
  {
    id: 'lease_status_shadow',
    kind: 'read_only_shadow',
    schema_ref: MINIMAL_LEASE_STATUS_SHADOW_SCHEMA,
    schema_version: MINIMAL_LEASE_STATUS_SHADOW_VERSION,
    implementation_refs: ['scripts/governance/lease-status-shadow.ts'],
    contract_refs: [CONTRACT_DOC],
    docs_refs: ['docs/contracts/README.md'],
    authority: {
      read_only: true,
      diagnostic_audit: false,
      ...NON_VERDICT_AUTHORITY,
    },
    safety_boundary: {
      forbidden_fields: [...SECRET_VALUE_FORBIDDEN_FIELDS],
      redaction_required: true,
      raw_secret_output_allowed: false,
    },
  },
  {
    id: 'rehearsal_metadata_schema',
    kind: 'read_only_metadata_schema',
    schema_ref: CURRENT_REHEARSAL_METADATA_SCHEMA,
    schema_version: CURRENT_REHEARSAL_METADATA_VERSION,
    implementation_refs: ['scripts/governance/current-rehearsal-metadata-schema.ts'],
    contract_refs: [CONTRACT_DOC],
    docs_refs: ['docs/contracts/README.md'],
    authority: {
      read_only: true,
      diagnostic_audit: false,
      ...NON_VERDICT_AUTHORITY,
    },
    safety_boundary: {
      forbidden_fields: [...CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS],
      redaction_required: true,
      raw_secret_output_allowed: false,
    },
  },
  {
    id: 'redaction_boundary',
    kind: 'redaction_boundary',
    schema_ref: null,
    schema_version: null,
    implementation_refs: ['scripts/governance/redaction.ts'],
    contract_refs: [CONTRACT_DOC],
    docs_refs: ['docs/contracts/README.md'],
    authority: {
      read_only: false,
      diagnostic_audit: true,
      ...NON_VERDICT_AUTHORITY,
    },
    safety_boundary: {
      forbidden_fields: [...SECRET_VALUE_FORBIDDEN_FIELDS],
      allowed_output_fields: [...SAFE_REDACTED_DIAGNOSTIC_FIELDS],
      redaction_required: true,
      raw_secret_output_allowed: false,
    },
  },
] as const satisfies readonly CurrentGovernanceObservabilityObjectDefinition[];

const MANIFEST_FIELDS = new Set<string>(['objects']);
const OBJECT_FIELDS = new Set<string>([
  'id',
  'kind',
  'schema_ref',
  'schema_version',
  'implementation_refs',
  'contract_refs',
  'docs_refs',
  'authority',
  'safety_boundary',
  'artifact_files',
  'sentinel_probes',
]);
const AUTHORITY_FIELDS = new Set<string>([
  'read_only',
  'diagnostic_audit',
  'non_verdict',
  'non_evidence_truth',
  'writes_canonical_result',
  'produces_release_verdict',
  'participates_in_evidence_completeness',
]);
const SAFETY_BOUNDARY_FIELDS = new Set<string>([
  'forbidden_fields',
  'allowed_output_fields',
  'redaction_required',
  'raw_secret_output_allowed',
]);
const OBJECT_ID_SET = new Set<string>(CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS);
const OBJECT_KIND_SET = new Set<string>([
  'read_only_projection',
  'diagnostic_artifact_family',
  'preflight_diagnostic',
  'read_only_shadow',
  'read_only_metadata_schema',
  'redaction_boundary',
] satisfies CurrentGovernanceObservabilityObjectKind[]);

export function listCurrentGovernanceObservabilityObjects():
  readonly CurrentGovernanceObservabilityObjectDefinition[] {
  return CURRENT_GOVERNANCE_OBSERVABILITY_OBJECTS;
}

export function validateCurrentGovernanceObservabilityManifest(
  manifest: unknown,
): CurrentGovernanceObservabilityManifestValidationResult {
  const failures: CurrentGovernanceObservabilityManifestFailure[] = [];
  if (!isRecord(manifest)) {
    return {
      ok: false,
      failures: [{ path: 'manifest', reason: 'manifest must be an object.' }],
    };
  }

  validateNoUnknownFields(manifest, MANIFEST_FIELDS, 'manifest', failures);
  if (!Array.isArray(manifest.objects)) {
    failures.push({ path: 'manifest.objects', reason: 'objects must be an array.' });
  } else {
    validateObjectDefinitions(manifest.objects, failures);
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: manifest as CurrentGovernanceObservabilityManifest,
  };
}

function validateObjectDefinitions(
  objects: readonly unknown[],
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  const ids = new Set<string>();
  objects.forEach((object, index) => {
    const path = `manifest.objects[${index}]`;
    if (!isRecord(object)) {
      failures.push({ path, reason: 'object definition must be an object.' });
      return;
    }

    validateNoUnknownFields(object, OBJECT_FIELDS, path, failures);
    validateString(object.id, `${path}.id`, failures);
    validateString(object.kind, `${path}.kind`, failures);
    validateNullableStringOrNumber(object.schema_ref, `${path}.schema_ref`, failures);
    validateNullableStringOrNumber(object.schema_version, `${path}.schema_version`, failures);
    validateStringArray(object.implementation_refs, `${path}.implementation_refs`, failures);
    validateStringArray(object.contract_refs, `${path}.contract_refs`, failures);
    validateStringArray(object.docs_refs, `${path}.docs_refs`, failures);
    validateAuthority(object.authority, `${path}.authority`, failures);
    validateSafetyBoundary(object.safety_boundary, `${path}.safety_boundary`, failures);
    if ('artifact_files' in object) {
      validateStringArray(object.artifact_files, `${path}.artifact_files`, failures);
    }
    if ('sentinel_probes' in object) {
      validateStringArray(object.sentinel_probes, `${path}.sentinel_probes`, failures);
    }

    if (typeof object.id === 'string') {
      if (!OBJECT_ID_SET.has(object.id)) {
        failures.push({ path: `${path}.id`, reason: `unknown observability object id: ${object.id}` });
      }
      if (ids.has(object.id)) {
        failures.push({ path: `${path}.id`, reason: `duplicate observability object id: ${object.id}` });
      }
      ids.add(object.id);
    }

    if (typeof object.kind === 'string' && !OBJECT_KIND_SET.has(object.kind)) {
      failures.push({ path: `${path}.kind`, reason: `unknown observability object kind: ${object.kind}` });
    }
  });

  const actualIds = objects
    .filter(isRecord)
    .map((object) => object.id)
    .filter((id): id is string => typeof id === 'string');
  const expectedIds = [...CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS];
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    failures.push({
      path: 'manifest.objects',
      reason: `object ids must match current P0 observability truth: ${expectedIds.join(', ')}`,
    });
  }
}

function validateAuthority(
  authority: unknown,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (!isRecord(authority)) {
    failures.push({ path, reason: 'authority must be an object.' });
    return;
  }

  validateNoUnknownFields(authority, AUTHORITY_FIELDS, path, failures);
  validateBoolean(authority.read_only, `${path}.read_only`, failures);
  validateBoolean(authority.diagnostic_audit, `${path}.diagnostic_audit`, failures);
  validateLiteral(authority.non_verdict, true, `${path}.non_verdict`, failures);
  validateLiteral(authority.non_evidence_truth, true, `${path}.non_evidence_truth`, failures);
  validateLiteral(authority.writes_canonical_result, false, `${path}.writes_canonical_result`, failures);
  validateLiteral(authority.produces_release_verdict, false, `${path}.produces_release_verdict`, failures);
  validateLiteral(
    authority.participates_in_evidence_completeness,
    false,
    `${path}.participates_in_evidence_completeness`,
    failures,
  );
}

function validateSafetyBoundary(
  safetyBoundary: unknown,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (!isRecord(safetyBoundary)) {
    failures.push({ path, reason: 'safety_boundary must be an object.' });
    return;
  }

  validateNoUnknownFields(safetyBoundary, SAFETY_BOUNDARY_FIELDS, path, failures);
  validateStringArray(safetyBoundary.forbidden_fields, `${path}.forbidden_fields`, failures);
  validateBoolean(safetyBoundary.redaction_required, `${path}.redaction_required`, failures);
  validateLiteral(safetyBoundary.raw_secret_output_allowed, false, `${path}.raw_secret_output_allowed`, failures);
  if ('allowed_output_fields' in safetyBoundary) {
    validateStringArray(safetyBoundary.allowed_output_fields, `${path}.allowed_output_fields`, failures);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateNoUnknownFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({ path: `${path}.${key}`, reason: `unknown field "${key}"` });
    }
  }
}

function validateString(
  value: unknown,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({ path, reason: 'value must be a non-empty string.' });
  }
}

function validateNullableStringOrNumber(
  value: unknown,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (
    value !== null
    && (typeof value !== 'string' || value.trim().length === 0)
    && typeof value !== 'number'
  ) {
    failures.push({ path, reason: 'value must be null, a non-empty string, or a number.' });
  }
}

function validateBoolean(
  value: unknown,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (typeof value !== 'boolean') {
    failures.push({ path, reason: 'value must be boolean.' });
  }
}

function validateLiteral(
  value: unknown,
  expected: boolean,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (value !== expected) {
    failures.push({ path, reason: `value must be ${String(expected)}.` });
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  failures: CurrentGovernanceObservabilityManifestFailure[],
): void {
  if (!Array.isArray(value)) {
    failures.push({ path, reason: 'value must be a string array.' });
    return;
  }
  value.forEach((entry, index) => {
    validateString(entry, `${path}[${index}]`, failures);
  });
}
