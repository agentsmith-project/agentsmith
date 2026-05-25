export const CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA = 'current-build-manifest-aggregate.v1' as const;
export const CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION = 1 as const;
export const CURRENT_BUILD_SKIP_DECISION_SCHEMA = 'current-build-skip-decision.v1' as const;
export const CURRENT_BUILD_SKIP_DECISION_VERSION = 1 as const;

export const CURRENT_BUILD_ARTIFACT_TARGETS = ['app'] as const;
export type CurrentBuildArtifactTarget = (typeof CURRENT_BUILD_ARTIFACT_TARGETS)[number];
export const CURRENT_BUILD_PRODUCT_IMAGE_IDS = ['agentsmith_app'] as const;
export type CurrentBuildProductImageId = (typeof CURRENT_BUILD_PRODUCT_IMAGE_IDS)[number];
export type CurrentBuildOperationalSkipTarget = `image:${string}`;
export type CurrentBuildSkipDecisionTarget = CurrentBuildArtifactTarget | CurrentBuildOperationalSkipTarget;

export const CURRENT_BUILD_MANIFEST_MODES = [
  'build',
  'bundle',
  'release-fidelity',
  'offline-package',
] as const;
export type CurrentBuildManifestMode = (typeof CURRENT_BUILD_MANIFEST_MODES)[number];

export const CURRENT_BUILD_MANIFEST_TARGET_DECISIONS = ['built', 'reused', 'skipped'] as const;
export type CurrentBuildManifestTargetDecision = (typeof CURRENT_BUILD_MANIFEST_TARGET_DECISIONS)[number];

export const CURRENT_BUILD_SKIP_OPERATIONS = [
  'docker_build',
  'docker_save',
  'docker_load',
  'registry_push',
  'kind_preload',
  'release_alias_retag',
] as const;
export type CurrentBuildSkipOperation = (typeof CURRENT_BUILD_SKIP_OPERATIONS)[number];

export const CURRENT_BUILD_FORBIDDEN_EVIDENCE_TRUTH_FIELDS = [
  'verdict',
  'claim_id',
  'reusable',
  'passed',
  'failed',
  'status',
  'result_status',
  'failure_class',
  'evidence_claim',
  'claim_reuse',
  'cache_hit',
] as const;

export interface CurrentBuildManifestProducer {
  name: string;
  version: string;
  command: string;
  runtime: string;
}

export interface CurrentBuildManifestTarget {
  target: CurrentBuildArtifactTarget;
  release_id: string;
  content_ref: string;
  release_alias_ref: string;
  image_digest: string;
  input_digest: string;
  base_image_digest: string;
  decision: CurrentBuildManifestTargetDecision;
  producer: CurrentBuildManifestProducer;
  generated_at: string;
}

export interface CurrentBuildManifestAggregate {
  schema: typeof CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA;
  version: typeof CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION;
  manifest_kind: 'build_manifest_aggregate';
  run_id: string;
  release_id: string;
  version_path: string;
  mode: CurrentBuildManifestMode;
  producer: CurrentBuildManifestProducer;
  generated_at: string;
  targets: readonly CurrentBuildManifestTarget[];
}

export interface CurrentBuildSkipDecision {
  schema: typeof CURRENT_BUILD_SKIP_DECISION_SCHEMA;
  version: typeof CURRENT_BUILD_SKIP_DECISION_VERSION;
  target: CurrentBuildSkipDecisionTarget;
  operation: CurrentBuildSkipOperation;
  input_digest: string;
  existing_artifact_digest: string;
  skip_reason: string;
  validator: string;
  generated_at: string;
}

export interface CurrentBuildArtifactBrokerValidationFailure {
  path: string;
  reason: string;
}

export type CurrentBuildArtifactBrokerValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      failures: readonly CurrentBuildArtifactBrokerValidationFailure[];
    };

const AGGREGATE_FIELDS = [
  'schema',
  'version',
  'manifest_kind',
  'run_id',
  'release_id',
  'version_path',
  'mode',
  'producer',
  'generated_at',
  'targets',
] as const;
const TARGET_FIELDS = [
  'target',
  'release_id',
  'content_ref',
  'release_alias_ref',
  'image_digest',
  'input_digest',
  'base_image_digest',
  'decision',
  'producer',
  'generated_at',
] as const;
const PRODUCER_FIELDS = ['name', 'version', 'command', 'runtime'] as const;
const SKIP_DECISION_FIELDS = [
  'schema',
  'version',
  'target',
  'operation',
  'input_digest',
  'existing_artifact_digest',
  'skip_reason',
  'validator',
  'generated_at',
] as const;

const AGGREGATE_FIELD_SET = new Set<string>(AGGREGATE_FIELDS);
const TARGET_FIELD_SET = new Set<string>(TARGET_FIELDS);
const PRODUCER_FIELD_SET = new Set<string>(PRODUCER_FIELDS);
const SKIP_DECISION_FIELD_SET = new Set<string>(SKIP_DECISION_FIELDS);
const TARGET_SET = new Set<string>(CURRENT_BUILD_ARTIFACT_TARGETS);
const MANIFEST_MODE_SET = new Set<string>(CURRENT_BUILD_MANIFEST_MODES);
const MANIFEST_TARGET_DECISION_SET = new Set<string>(CURRENT_BUILD_MANIFEST_TARGET_DECISIONS);
const SKIP_OPERATION_SET = new Set<string>(CURRENT_BUILD_SKIP_OPERATIONS);
const FORBIDDEN_EVIDENCE_TRUTH_FIELD_SET = new Set<string>(CURRENT_BUILD_FORBIDDEN_EVIDENCE_TRUTH_FIELDS);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CONTENT_REF_PATTERN = /:ck-[a-f0-9]{32}$/;
const RELEASE_ALIAS_PATTERN = /:release-[a-zA-Z0-9._-]+$/;
const IMAGE_SKIP_TARGET_PATTERN = /^image:[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

export function validateBuildManifestAggregate(
  value: unknown,
): CurrentBuildArtifactBrokerValidationResult<CurrentBuildManifestAggregate> {
  const failures: CurrentBuildArtifactBrokerValidationFailure[] = [];

  validateForbiddenEvidenceTruthFields(value, 'manifest', failures);

  if (!isRecord(value)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          path: 'manifest',
          reason: 'build manifest aggregate must be an object.',
        },
      ],
    };
  }

  validateAllowedFields(value, AGGREGATE_FIELD_SET, 'aggregate', 'manifest', failures);
  validateRequiredFields(value, AGGREGATE_FIELDS, 'manifest', failures);
  validateLiteral(value.schema, CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA, 'manifest.schema', failures);
  validateLiteral(value.version, CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION, 'manifest.version', failures);
  validateLiteral(value.manifest_kind, 'build_manifest_aggregate', 'manifest.manifest_kind', failures);
  validateRequiredString(value.run_id, 'manifest.run_id', failures);
  validateRequiredString(value.release_id, 'manifest.release_id', failures);
  validateRequiredString(value.version_path, 'manifest.version_path', failures);
  validateEnum(value.mode, MANIFEST_MODE_SET, 'manifest.mode', failures);
  validateProducer(value.producer, 'manifest.producer', failures);
  validateRequiredString(value.generated_at, 'manifest.generated_at', failures);

  if (!Array.isArray(value.targets)) {
    failures.push({
      path: 'manifest.targets',
      reason: 'targets must be an array.',
    });
  } else {
    if (value.targets.length === 0) {
      failures.push({
        path: 'manifest.targets',
        reason: 'targets must not be empty.',
      });
    }
    value.targets.forEach((target, index) => {
      validateTarget(target, index, typeof value.release_id === 'string' ? value.release_id : undefined, failures);
    });
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: value as CurrentBuildManifestAggregate,
  };
}

export function validateBuildSkipDecision(
  value: unknown,
): CurrentBuildArtifactBrokerValidationResult<CurrentBuildSkipDecision> {
  const failures: CurrentBuildArtifactBrokerValidationFailure[] = [];

  validateForbiddenEvidenceTruthFields(value, 'skip_decision', failures);

  if (!isRecord(value)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          path: 'skip_decision',
          reason: 'build skip decision must be an object.',
        },
      ],
    };
  }

  validateAllowedFields(value, SKIP_DECISION_FIELD_SET, 'skip decision', 'skip_decision', failures);
  validateRequiredFields(value, SKIP_DECISION_FIELDS, 'skip_decision', failures);
  validateLiteral(value.schema, CURRENT_BUILD_SKIP_DECISION_SCHEMA, 'skip_decision.schema', failures);
  validateLiteral(value.version, CURRENT_BUILD_SKIP_DECISION_VERSION, 'skip_decision.version', failures);
  validateSkipDecisionTarget(value.target, 'skip_decision.target', failures);
  validateEnum(value.operation, SKIP_OPERATION_SET, 'skip_decision.operation', failures);
  validateDigest(value.input_digest, 'skip_decision.input_digest', failures);
  validateDigest(value.existing_artifact_digest, 'skip_decision.existing_artifact_digest', failures);
  validateRequiredString(value.skip_reason, 'skip_decision.skip_reason', failures);
  validateRequiredString(value.validator, 'skip_decision.validator', failures);
  validateRequiredString(value.generated_at, 'skip_decision.generated_at', failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: value as CurrentBuildSkipDecision,
  };
}

function validateTarget(
  value: unknown,
  index: number,
  aggregateReleaseId: string | undefined,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  const path = `manifest.targets[${index}]`;

  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'target entry must be an object.',
    });
    return;
  }

  validateAllowedFields(value, TARGET_FIELD_SET, 'target', path, failures);
  validateRequiredFields(value, TARGET_FIELDS, path, failures);
  validateEnum(value.target, TARGET_SET, `${path}.target`, failures);
  validateRequiredString(value.release_id, `${path}.release_id`, failures);
  validateRequiredString(value.content_ref, `${path}.content_ref`, failures);
  validateRequiredString(value.release_alias_ref, `${path}.release_alias_ref`, failures);
  validateDigest(value.image_digest, `${path}.image_digest`, failures);
  validateDigest(value.input_digest, `${path}.input_digest`, failures);
  validateDigest(value.base_image_digest, `${path}.base_image_digest`, failures);
  validateEnum(value.decision, MANIFEST_TARGET_DECISION_SET, `${path}.decision`, failures);
  validateRequiredString(value.generated_at, `${path}.generated_at`, failures);
  validateProducer(value.producer, `${path}.producer`, failures);

  if (typeof value.release_id === 'string' && aggregateReleaseId && value.release_id !== aggregateReleaseId) {
    failures.push({
      path: `${path}.release_id`,
      reason: 'target release_id must match aggregate release_id.',
    });
  }
  if (typeof value.content_ref === 'string' && !CONTENT_REF_PATTERN.test(value.content_ref)) {
    failures.push({
      path: `${path}.content_ref`,
      reason: 'content_ref must use a ck- content tag.',
    });
  }
  if (typeof value.release_alias_ref === 'string' && !RELEASE_ALIAS_PATTERN.test(value.release_alias_ref)) {
    failures.push({
      path: `${path}.release_alias_ref`,
      reason: 'release_alias_ref must use a release- alias tag.',
    });
  }
}

function validateProducer(
  value: unknown,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'producer must be an object.',
    });
    return;
  }

  validateAllowedFields(value, PRODUCER_FIELD_SET, 'producer', path, failures);
  validateRequiredFields(value, PRODUCER_FIELDS, path, failures);
  validateRequiredString(value.name, `${path}.name`, failures);
  validateRequiredString(value.version, `${path}.version`, failures);
  validateRequiredString(value.command, `${path}.command`, failures);
  validateRequiredString(value.runtime, `${path}.runtime`, failures);
}

function validateSkipDecisionTarget(
  value: unknown,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (typeof value === 'string' && (TARGET_SET.has(value) || IMAGE_SKIP_TARGET_PATTERN.test(value))) {
    return;
  }

  failures.push({
    path,
    reason: `must be one of: ${[...TARGET_SET].join(', ')}, or image:<ref>.`,
  });
}

function validateForbiddenEvidenceTruthFields(
  value: unknown,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateForbiddenEvidenceTruthFields(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;

    if (FORBIDDEN_EVIDENCE_TRUTH_FIELD_SET.has(key)) {
      failures.push({
        path: nestedPath,
        reason: `forbidden evidence truth field "${key}".`,
      });
    }
    validateForbiddenEvidenceTruthFields(nestedValue, nestedPath, failures);
  }
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `unknown ${label} field "${key}".`,
      });
    }
  }
}

function validateRequiredFields(
  value: Record<string, unknown>,
  requiredFields: readonly string[],
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  for (const field of requiredFields) {
    if (!(field in value)) {
      failures.push({
        path: `${path}.${field}`,
        reason: `${field} is required.`,
      });
    }
  }
}

function validateRequiredString(
  value: unknown,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (typeof value !== 'string' || value.trim() === '') {
    failures.push({
      path,
      reason: 'must be a non-empty string.',
    });
  }
}

function validateDigest(
  value: unknown,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    failures.push({
      path,
      reason: 'must be a sha256 digest.',
    });
  }
}

function validateLiteral(
  value: unknown,
  expected: string | number | boolean,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (value !== expected) {
    failures.push({
      path,
      reason: `must be ${String(expected)}.`,
    });
  }
}

function validateEnum(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  failures: CurrentBuildArtifactBrokerValidationFailure[],
): void {
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    failures.push({
      path,
      reason: `must be one of: ${[...allowedValues].join(', ')}.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
