import { findCurrentGateDefinitionById } from './current-gate-manifest';
import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_STATUSES,
  findCurrentGateResultWriter,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import { findCurrentVerificationCampaignById } from './current-verification-campaign-manifest';

export const CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION = '1.1.0' as const;

export const CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS = [
  'schema_version',
  'subject',
  'scope',
  'campaign_id',
  'campaign_root',
  'run_id',
  'step_id',
  'check_id',
  'gate_id',
  'line_kind',
  'gate_adapter',
  'evidence_dir',
  'result_status',
  'failure_class',
  'input_digest',
  'artifact_digest',
  'result_digest',
  'producer',
  'freshness',
  'validator',
  'generated_at',
] as const;

export const CURRENT_EVIDENCE_CLAIM_SCOPES = [
  'debug',
  'pr',
  'visual',
  'real',
  'release',
] as const;

export const CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES = [
  'record',
  'reuse',
  'pure_check_reuse',
  'verdict_candidate',
] as const;

export const CURRENT_EVIDENCE_CLAIM_SCHEMA = {
  schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  top_level_keys: CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS,
  digest_format: 'sha256:<64 lowercase hex>',
  validation_purposes: CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES,
} as const;

export type CurrentEvidenceClaimValidationPurpose =
  | 'record'
  | 'reuse'
  | 'pure_check_reuse'
  | 'verdict_candidate';
export type CurrentEvidenceClaimScope = (typeof CURRENT_EVIDENCE_CLAIM_SCOPES)[number];
export type CurrentEvidenceClaimCampaignId = 'release-full';

export interface CurrentEvidenceClaimDigest {
  value: string;
}

export interface CurrentEvidenceClaimGateAdapter {
  npm_script: string;
}

export interface CurrentEvidenceClaimProducer {
  origin: string;
}

export interface CurrentEvidenceClaimFreshness {
  git_sha: string;
  allow_cross_commit: boolean;
  allow_cross_secret_profile: boolean;
  secret_profile_digest: string | null;
}

export interface CurrentEvidenceClaimValidator {
  name: string;
  version: string;
}

export interface CurrentEvidenceClaimRecord {
  schema_version: typeof CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION;
  subject: string;
  scope: CurrentEvidenceClaimScope;
  campaign_id: CurrentEvidenceClaimCampaignId | null;
  campaign_root: string | null;
  run_id: string | null;
  step_id: string | null;
  check_id: string | null;
  gate_id: string;
  line_kind: string;
  gate_adapter: CurrentEvidenceClaimGateAdapter;
  evidence_dir: string;
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  input_digest: CurrentEvidenceClaimDigest;
  artifact_digest: CurrentEvidenceClaimDigest;
  result_digest: string;
  producer: CurrentEvidenceClaimProducer;
  freshness: CurrentEvidenceClaimFreshness;
  validator: CurrentEvidenceClaimValidator;
  generated_at: string;
}

export interface CurrentEvidenceClaimValidationOptions {
  purpose: CurrentEvidenceClaimValidationPurpose;
}

export interface CurrentEvidenceClaimValidationFailure {
  path: string;
  code: string;
  message: string;
}

export type CurrentEvidenceClaimValidationResult =
  | {
      ok: true;
      value: CurrentEvidenceClaimRecord;
    }
  | {
      ok: false;
      failures: CurrentEvidenceClaimValidationFailure[];
    };

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CAMEL_CASE_PATTERN = /[a-z][A-Z]/;
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\bapi_key\s*=/i,
  /\baccess_token\s*=/i,
  /\brefresh_token\s*=/i,
  /\boauth_token\s*=/i,
  /\bclient_secret\s*=/i,
  /\bpassword\s*=/i,
  /\bticket\s*=/i,
  /managed_credentials\./,
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+/,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pushFailure(
  failures: CurrentEvidenceClaimValidationFailure[],
  path: string,
  code: string,
  message: string,
): void {
  failures.push({ path, code, message });
}

function validateKnownKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      pushFailure(
        failures,
        path === '$' ? key : `${path}.${key}`,
        'unknown_key',
        `${path === '$' ? 'top-level' : path} key is not in the current evidence claim schema.`,
      );
    }
  }
}

function validateRequiredKeys(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): void {
  for (const key of requiredKeys) {
    if (!hasOwn(record, key)) {
      pushFailure(
        failures,
        path === '$' ? key : `${path}.${key}`,
        'missing_required',
        'Required current evidence claim field is missing.',
      );
    }
  }
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): string | undefined {
  if (!hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushFailure(
      failures,
      path,
      'malformed_string',
      'Required current evidence claim field must be a non-empty string.',
    );
    return undefined;
  }
  return value;
}

function readRequiredNullableString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): string | null | undefined {
  if (!hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushFailure(
      failures,
      path,
      'malformed_nullable_string',
      'Required current evidence claim field must be null or a non-empty string.',
    );
    return undefined;
  }
  return value;
}

function readRequiredBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): boolean | undefined {
  if (!hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (typeof value !== 'boolean') {
    pushFailure(
      failures,
      path,
      'malformed_boolean',
      'Required current evidence claim field must be a boolean.',
    );
    return undefined;
  }
  return value;
}

function readRequiredRecord(
  record: Record<string, unknown>,
  key: string,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): Record<string, unknown> | undefined {
  if (!hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (!isRecord(value)) {
    pushFailure(
      failures,
      path,
      'malformed_object',
      'Required current evidence claim field must be an object.',
    );
    return undefined;
  }
  return value;
}

function isSha256Digest(value: string): boolean {
  return SHA256_DIGEST_PATTERN.test(value);
}

function validateDigestString(
  value: string | undefined,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): void {
  if (value === undefined) {
    return;
  }
  if (!isSha256Digest(value)) {
    pushFailure(
      failures,
      path,
      'malformed_digest',
      'Digest must use sha256:<64 lowercase hex>.',
    );
  }
}

function readDigestRecord(
  record: Record<string, unknown>,
  key: string,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): string | undefined {
  const digestRecord = readRequiredRecord(record, key, path, failures);
  if (!digestRecord) {
    return undefined;
  }

  validateKnownKeys(digestRecord, ['value'], path, failures);
  validateRequiredKeys(digestRecord, ['value'], path, failures);

  const value = readRequiredString(digestRecord, 'value', `${path}.value`, failures);
  validateDigestString(value, `${path}.value`, failures);
  return value;
}

function isCurrentEvidenceClaimScope(value: string): value is CurrentEvidenceClaimScope {
  return CURRENT_EVIDENCE_CLAIM_SCOPES.includes(value as CurrentEvidenceClaimScope);
}

function isCurrentGateResultStatus(value: string): value is CurrentGateResultStatus {
  return CURRENT_GATE_RESULT_STATUSES.includes(value as CurrentGateResultStatus);
}

function isCurrentGateResultFailureClass(value: string): value is CurrentGateResultFailureClass {
  return CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(value as CurrentGateResultFailureClass);
}

function normalizePathForComparison(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}

function campaignRootMatchesRunId(campaignRoot: string, runId: string): boolean {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    return false;
  }
  const expected = normalizePathForComparison(
    campaign.runRootPattern.replace('<campaign-run-id>', runId),
  );
  const actual = normalizePathForComparison(campaignRoot);
  return actual === expected || actual.endsWith(`/${expected}`);
}

function releaseStepEvidenceDirMatchesRunIdStep(
  evidenceDir: string,
  runRootPattern: string,
  runId: string,
  stepId: string,
): boolean {
  const expectedRunRoot = runRootPattern.replace('<campaign-run-id>', runId);
  const expected = normalizePathForComparison(`${expectedRunRoot}/${stepId}`);
  const actual = normalizePathForComparison(evidenceDir);
  return actual === expected || actual.endsWith(`/${expected}`);
}

function scanSecretLookingStrings(
  value: unknown,
  path: string,
  failures: CurrentEvidenceClaimValidationFailure[],
): void {
  if (typeof value === 'string') {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        pushFailure(
          failures,
          path,
          'secret_like_value',
          'Current evidence claim payload contains a secret-looking string.',
        );
        return;
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      scanSecretLookingStrings(entry, `${path}[${index}]`, failures);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    scanSecretLookingStrings(nestedValue, path === '$' ? key : `${path}.${key}`, failures);
  }
}

function requiresReleaseCampaignBinding(
  scope: string | undefined,
  campaignId: string | null | undefined,
  campaignRoot: string | null | undefined,
  runId: string | null | undefined,
  stepId: string | null | undefined,
  gateId: string | undefined,
  lineKind: string | undefined,
): boolean {
  return scope === 'release'
    || campaignId !== null && campaignId !== undefined
    || campaignRoot !== null && campaignRoot !== undefined
    || runId !== null && runId !== undefined
    || stepId !== null && stepId !== undefined
    || gateId === 'gate-release-full'
    || lineKind === 'release_full_verdict';
}

function requiresSecretProfileBinding(
  scope: string | undefined,
  campaignId: string | null | undefined,
  gateId: string | undefined,
  lineKind: string | undefined,
): boolean {
  const gate = gateId ? findCurrentGateDefinitionById(gateId) : undefined;
  return scope === 'real'
    || scope === 'release'
    || campaignId === 'release-full'
    || gate?.backendRealPolicy === 'required'
    || gateId === 'gate-release'
    || gateId === 'gate-release-full'
    || gateId?.includes('backend-real') === true
    || lineKind?.includes('backend_real') === true
    || lineKind?.includes('release') === true;
}

function buildClaimRecord(args: {
  schemaVersion: string;
  subject: string;
  scope: CurrentEvidenceClaimScope;
  campaignId: CurrentEvidenceClaimCampaignId | null;
  campaignRoot: string | null;
  runId: string | null;
  stepId: string | null;
  checkId: string | null;
  gateId: string;
  lineKind: string;
  npmScript: string;
  evidenceDir: string;
  resultStatus: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  inputDigest: string;
  artifactDigest: string;
  resultDigest: string;
  producerOrigin: string;
  gitSha: string;
  allowCrossCommit: boolean;
  allowCrossSecretProfile: boolean;
  secretProfileDigest: string | null;
  validatorName: string;
  validatorVersion: string;
  generatedAt: string;
}): CurrentEvidenceClaimRecord {
  return {
    schema_version: args.schemaVersion as typeof CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    subject: args.subject,
    scope: args.scope,
    campaign_id: args.campaignId,
    campaign_root: args.campaignRoot,
    run_id: args.runId,
    step_id: args.stepId,
    check_id: args.checkId,
    gate_id: args.gateId,
    line_kind: args.lineKind,
    gate_adapter: {
      npm_script: args.npmScript,
    },
    evidence_dir: args.evidenceDir,
    result_status: args.resultStatus,
    failure_class: args.failureClass,
    input_digest: {
      value: args.inputDigest,
    },
    artifact_digest: {
      value: args.artifactDigest,
    },
    result_digest: args.resultDigest,
    producer: {
      origin: args.producerOrigin,
    },
    freshness: {
      git_sha: args.gitSha,
      allow_cross_commit: args.allowCrossCommit,
      allow_cross_secret_profile: args.allowCrossSecretProfile,
      secret_profile_digest: args.secretProfileDigest,
    },
    validator: {
      name: args.validatorName,
      version: args.validatorVersion,
    },
    generated_at: args.generatedAt,
  };
}

export function validateCurrentEvidenceClaim(
  claim: unknown,
  options: CurrentEvidenceClaimValidationOptions = { purpose: 'record' },
): CurrentEvidenceClaimValidationResult {
  const failures: CurrentEvidenceClaimValidationFailure[] = [];
  const purpose = options?.purpose ?? 'record';

  if (!CURRENT_EVIDENCE_CLAIM_VALIDATION_PURPOSES.includes(purpose)) {
    pushFailure(
      failures,
      'options.purpose',
      'unknown_validation_purpose',
      'Current evidence claim validation purpose is not supported.',
    );
  }

  if (!isRecord(claim)) {
    pushFailure(
      failures,
      '$',
      'malformed_claim',
      'Current evidence claim must be a plain object.',
    );
    return { ok: false, failures };
  }

  scanSecretLookingStrings(claim, '$', failures);
  validateKnownKeys(claim, CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS, '$', failures);
  for (const key of Object.keys(claim)) {
    if (CAMEL_CASE_PATTERN.test(key)) {
      pushFailure(
        failures,
        key,
        'camel_case_top_level_key',
        'Current evidence claim top-level keys must be snake_case.',
      );
    }
  }
  validateRequiredKeys(claim, CURRENT_EVIDENCE_CLAIM_TOP_LEVEL_KEYS, '$', failures);

  const schemaVersion = readRequiredString(claim, 'schema_version', 'schema_version', failures);
  if (
    schemaVersion !== undefined
    && schemaVersion !== CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION
  ) {
    pushFailure(
      failures,
      'schema_version',
      'schema_version_mismatch',
      'Current evidence claim schema_version does not match the validator.',
    );
  }

  const subject = readRequiredString(claim, 'subject', 'subject', failures);
  const scope = readRequiredString(claim, 'scope', 'scope', failures);
  if (scope !== undefined && !isCurrentEvidenceClaimScope(scope)) {
    pushFailure(
      failures,
      'scope',
      'unknown_scope',
      'Current evidence claim scope is not supported by this schema version.',
    );
  }

  const campaignId = readRequiredNullableString(claim, 'campaign_id', 'campaign_id', failures);
  const campaignRoot = readRequiredNullableString(claim, 'campaign_root', 'campaign_root', failures);
  const runId = readRequiredNullableString(claim, 'run_id', 'run_id', failures);
  const stepId = readRequiredNullableString(claim, 'step_id', 'step_id', failures);
  const checkId = readRequiredNullableString(claim, 'check_id', 'check_id', failures);
  const gateId = readRequiredString(claim, 'gate_id', 'gate_id', failures);
  const lineKind = readRequiredString(claim, 'line_kind', 'line_kind', failures);
  const evidenceDir = readRequiredString(claim, 'evidence_dir', 'evidence_dir', failures);
  const resultStatus = readRequiredString(claim, 'result_status', 'result_status', failures);
  const failureClass = readRequiredString(claim, 'failure_class', 'failure_class', failures);

  const gateAdapter = readRequiredRecord(claim, 'gate_adapter', 'gate_adapter', failures);
  if (gateAdapter) {
    validateKnownKeys(gateAdapter, ['npm_script'], 'gate_adapter', failures);
    validateRequiredKeys(gateAdapter, ['npm_script'], 'gate_adapter', failures);
  }
  const npmScript = gateAdapter
    ? readRequiredString(gateAdapter, 'npm_script', 'gate_adapter.npm_script', failures)
    : undefined;

  const inputDigest = readDigestRecord(claim, 'input_digest', 'input_digest', failures);
  const artifactDigest = readDigestRecord(claim, 'artifact_digest', 'artifact_digest', failures);
  const resultDigest = readRequiredString(claim, 'result_digest', 'result_digest', failures);
  validateDigestString(resultDigest, 'result_digest', failures);

  const producer = readRequiredRecord(claim, 'producer', 'producer', failures);
  if (producer) {
    validateKnownKeys(producer, ['origin'], 'producer', failures);
    validateRequiredKeys(producer, ['origin'], 'producer', failures);
  }
  const producerOrigin = producer
    ? readRequiredString(producer, 'origin', 'producer.origin', failures)
    : undefined;

  const freshness = readRequiredRecord(claim, 'freshness', 'freshness', failures);
  if (freshness) {
    validateKnownKeys(
      freshness,
      [
        'git_sha',
        'allow_cross_commit',
        'allow_cross_secret_profile',
        'secret_profile_digest',
      ],
      'freshness',
      failures,
    );
    validateRequiredKeys(
      freshness,
      [
        'git_sha',
        'allow_cross_commit',
        'allow_cross_secret_profile',
        'secret_profile_digest',
      ],
      'freshness',
      failures,
    );
  }
  const gitSha = freshness
    ? readRequiredString(freshness, 'git_sha', 'freshness.git_sha', failures)
    : undefined;
  const allowCrossCommit = freshness
    ? readRequiredBoolean(freshness, 'allow_cross_commit', 'freshness.allow_cross_commit', failures)
    : undefined;
  const allowCrossSecretProfile = freshness
    ? readRequiredBoolean(
      freshness,
      'allow_cross_secret_profile',
      'freshness.allow_cross_secret_profile',
      failures,
    )
    : undefined;
  const secretProfileDigest = freshness
    ? readRequiredNullableString(
      freshness,
      'secret_profile_digest',
      'freshness.secret_profile_digest',
      failures,
    )
    : undefined;
  if (typeof secretProfileDigest === 'string') {
    validateDigestString(secretProfileDigest, 'freshness.secret_profile_digest', failures);
  }

  const validator = readRequiredRecord(claim, 'validator', 'validator', failures);
  if (validator) {
    validateKnownKeys(validator, ['name', 'version'], 'validator', failures);
    validateRequiredKeys(validator, ['name', 'version'], 'validator', failures);
  }
  const validatorName = validator
    ? readRequiredString(validator, 'name', 'validator.name', failures)
    : undefined;
  const validatorVersion = validator
    ? readRequiredString(validator, 'version', 'validator.version', failures)
    : undefined;

  const generatedAt = readRequiredString(claim, 'generated_at', 'generated_at', failures);

  if (gateId !== undefined) {
    const gate = findCurrentGateDefinitionById(gateId);
    if (!gate) {
      pushFailure(
        failures,
        'gate_id',
        'unknown_gate_id',
        'gate_id is not present in the current gate manifest.',
      );
    } else if (
      npmScript !== undefined
      && purpose !== 'pure_check_reuse'
      && !requiresReleaseCampaignBinding(scope, campaignId, campaignRoot, runId, stepId, gateId, lineKind)
      && npmScript !== gate.npmScript
    ) {
      pushFailure(
        failures,
        'gate_adapter.npm_script',
        'npm_script_mismatch',
        'gate_adapter.npm_script does not match the current gate manifest.',
      );
    }
  }

  if (resultStatus !== undefined && !isCurrentGateResultStatus(resultStatus)) {
    pushFailure(
      failures,
      'result_status',
      'unknown_result_status',
      'result_status is not a current gate result status.',
    );
  }

  if (failureClass !== undefined && !isCurrentGateResultFailureClass(failureClass)) {
    pushFailure(
      failures,
      'failure_class',
      'unknown_failure_class',
      'failure_class is not a current gate result failure class.',
    );
  }

  if (resultStatus !== undefined && failureClass !== undefined) {
    if (resultStatus === 'passed' && failureClass !== 'none') {
      pushFailure(
        failures,
        'failure_class',
        'passed_failure_class_mismatch',
        'passed claim must use failure_class none.',
      );
    }
    if (resultStatus === 'failed' && failureClass === 'none') {
      pushFailure(
        failures,
        'failure_class',
        'failed_failure_class_mismatch',
        'failed claim must use a non-none failure_class.',
      );
    }
    if (purpose !== 'record' && resultStatus === 'failed') {
      pushFailure(
        failures,
        'result_status',
        'failed_claim_not_reusable',
        'failed claim cannot be reused or used as a verdict candidate.',
      );
    }
  }

  if (purpose === 'pure_check_reuse') {
    if (checkId === null || checkId === undefined) {
      pushFailure(
        failures,
        'check_id',
        'pure_check_id_required',
        'pure check reuse claim must bind a stable check_id.',
      );
    }
    if (scope === 'release') {
      pushFailure(
        failures,
        'scope',
        'pure_check_release_scope_not_allowed',
        'pure check reuse claim must be non-release scoped.',
      );
    }
    if (campaignId !== null && campaignId !== undefined) {
      pushFailure(
        failures,
        'campaign_id',
        'pure_check_campaign_id_not_allowed',
        'pure check reuse claim must not bind a release campaign_id.',
      );
    }
    if (campaignRoot !== null && campaignRoot !== undefined) {
      pushFailure(
        failures,
        'campaign_root',
        'pure_check_campaign_root_not_allowed',
        'pure check reuse claim must not bind a release campaign_root.',
      );
    }
    if (runId !== null && runId !== undefined) {
      pushFailure(
        failures,
        'run_id',
        'pure_check_run_id_not_allowed',
        'pure check reuse claim must not bind a release run_id.',
      );
    }
    if (stepId !== null && stepId !== undefined) {
      pushFailure(
        failures,
        'step_id',
        'pure_check_step_id_not_allowed',
        'pure check reuse claim must not bind a release step_id.',
      );
    }
  }

  if (
    gateId !== undefined
    && lineKind !== undefined
    && !requiresReleaseCampaignBinding(scope, campaignId, campaignRoot, runId, stepId, gateId, lineKind)
  ) {
    const writer = findCurrentGateResultWriter(gateId);
    if (writer && writer.line_kind !== lineKind) {
      pushFailure(
        failures,
        'line_kind',
        'line_kind_mismatch',
        'line_kind does not match the current gate result writer.',
      );
    }
  }

  if (requiresReleaseCampaignBinding(scope, campaignId, campaignRoot, runId, stepId, gateId, lineKind)) {
    const campaign = findCurrentVerificationCampaignById('release-full');
    if (!campaign) {
      pushFailure(
        failures,
        'campaign_id',
        'missing_release_campaign_manifest',
        'release-full campaign is not present in the current verification campaign manifest.',
      );
    }

    if (campaignId !== 'release-full') {
      pushFailure(
        failures,
        'campaign_id',
        'release_campaign_id_required',
        'release claim must bind campaign_id release-full.',
      );
    }
    if (campaignRoot === null || campaignRoot === undefined) {
      pushFailure(
        failures,
        'campaign_root',
        'release_campaign_root_required',
        'release claim must bind campaign_root.',
      );
    }
    if (runId === null || runId === undefined) {
      pushFailure(
        failures,
        'run_id',
        'release_run_id_required',
        'release claim must bind run_id.',
      );
    }
    if (stepId === null || stepId === undefined) {
      pushFailure(
        failures,
        'step_id',
        'release_step_id_required',
        'release claim must bind step_id.',
      );
    }

    if (typeof campaignRoot === 'string' && typeof runId === 'string') {
      if (!campaignRootMatchesRunId(campaignRoot, runId)) {
        pushFailure(
          failures,
          'campaign_root',
          'campaign_root_run_id_mismatch',
          'campaign_root must match the current release-full runRootPattern and run_id.',
        );
      }
    }

    if (campaign && typeof stepId === 'string') {
      const step = campaign.steps.find((candidate) => candidate.id === stepId);
      if (!step) {
        pushFailure(
          failures,
          'step_id',
          'unknown_release_step_id',
          'step_id is not present in the release-full campaign manifest.',
        );
      } else {
        if (gateId !== undefined && step.gateId !== gateId) {
          pushFailure(
            failures,
            'gate_id',
            'release_step_gate_id_mismatch',
            'gate_id does not match the release-full campaign step.',
          );
        }
        if (lineKind !== undefined && step.lineKind !== lineKind) {
          pushFailure(
            failures,
            'line_kind',
            'release_step_line_kind_mismatch',
            'line_kind does not match the release-full campaign step.',
          );
        }
        if (npmScript !== undefined && step.npmScript !== npmScript) {
          pushFailure(
            failures,
            'gate_adapter.npm_script',
            'release_step_npm_script_mismatch',
            'gate_adapter.npm_script does not match the release-full campaign step.',
          );
        }
        if (
          typeof runId === 'string'
          && evidenceDir !== undefined
          && !releaseStepEvidenceDirMatchesRunIdStep(
            evidenceDir,
            campaign.runRootPattern,
            runId,
            step.id,
          )
        ) {
          pushFailure(
            failures,
            'evidence_dir',
            'release_step_evidence_dir_mismatch',
            'evidence_dir must match the release-full campaign run step directory.',
          );
        }
      }
    }
  }

  if (requiresSecretProfileBinding(scope, campaignId, gateId, lineKind)) {
    if (secretProfileDigest === null || secretProfileDigest === undefined) {
      pushFailure(
        failures,
        'freshness.secret_profile_digest',
        'secret_profile_digest_required',
        'backend-real, real, and release claims must bind a secret_profile_digest.',
      );
    }
    if (allowCrossSecretProfile !== false) {
      pushFailure(
        failures,
        'freshness.allow_cross_secret_profile',
        'cross_secret_profile_not_allowed',
        'backend-real, real, and release claims must not allow cross-secret-profile reuse.',
      );
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return {
    ok: true,
    value: buildClaimRecord({
      schemaVersion: schemaVersion ?? CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
      subject: subject ?? '',
      scope: (scope ?? 'debug') as CurrentEvidenceClaimScope,
      campaignId: campaignId as CurrentEvidenceClaimCampaignId | null,
      campaignRoot: campaignRoot ?? null,
      runId: runId ?? null,
      stepId: stepId ?? null,
      checkId: checkId ?? null,
      gateId: gateId ?? '',
      lineKind: lineKind ?? '',
      npmScript: npmScript ?? '',
      evidenceDir: evidenceDir ?? '',
      resultStatus: (resultStatus ?? 'failed') as CurrentGateResultStatus,
      failureClass: (failureClass ?? 'evidence_missing') as CurrentGateResultFailureClass,
      inputDigest: inputDigest ?? '',
      artifactDigest: artifactDigest ?? '',
      resultDigest: resultDigest ?? '',
      producerOrigin: producerOrigin ?? '',
      gitSha: gitSha ?? '',
      allowCrossCommit: allowCrossCommit ?? false,
      allowCrossSecretProfile: allowCrossSecretProfile ?? false,
      secretProfileDigest: secretProfileDigest ?? null,
      validatorName: validatorName ?? '',
      validatorVersion: validatorVersion ?? '',
      generatedAt: generatedAt ?? '',
    }),
  };
}
