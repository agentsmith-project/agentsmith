import {
  CURRENT_PURE_CHECK_IDENTITY_MANIFEST,
  type CurrentPureCheckCachePolicy,
  type CurrentPureCheckId,
  type CurrentPureCheckIdentityManifest,
} from './current-pure-check-identity-manifest';
import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import type { GovernanceDigest, GovernancePureCheckReuseDecisionKind } from './governance-run-state';

export const PURE_CHECK_SHADOW_AUDIT_SCHEMA = 'agentsmith_pure_check_shadow_audit/v1' as const;
export const PURE_CHECK_SHADOW_AUDIT_SCOPE = 'pure_check_shadow_audit' as const;
export const PURE_CHECK_SHADOW_AUDIT_FILE_NAME = 'pure-check-shadow-audit.json' as const;

export interface GovernancePureCheckShadowAuditDigests {
  scope: typeof PURE_CHECK_SHADOW_AUDIT_SCOPE;
  input?: GovernanceDigest;
  artifact?: GovernanceDigest;
  result?: GovernanceDigest;
  claim?: GovernanceDigest;
}

export interface GovernancePureCheckShadowAuditScriptResult {
  script: string;
  result_status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
}

export interface GovernancePureCheckShadowAuditEvaluation {
  check_id: CurrentPureCheckId;
  decision: GovernancePureCheckReuseDecisionKind;
  reason_codes: readonly string[];
  cache_policy?: CurrentPureCheckCachePolicy;
  result_status?: CurrentGateResultStatus;
  failure_class?: CurrentGateResultFailureClass;
  script_results?: readonly GovernancePureCheckShadowAuditScriptResult[];
  claim_store_read: boolean;
  claim_store_write: boolean;
  claim_count: number;
  valid_count: number;
  invalid_count: number;
  audit_digests?: Partial<Omit<GovernancePureCheckShadowAuditDigests, 'scope'>>;
}

export interface GovernancePureCheckShadowAuditCheck {
  check_id: CurrentPureCheckId;
  cache_policy: CurrentPureCheckCachePolicy;
  decision: GovernancePureCheckReuseDecisionKind;
  would_reuse: boolean;
  result_status?: CurrentGateResultStatus;
  failure_class?: CurrentGateResultFailureClass;
  script_results?: readonly GovernancePureCheckShadowAuditScriptResult[];
  reason_codes: readonly string[];
  claim_store_read: boolean;
  claim_store_write: boolean;
  claim_count: number;
  valid_count: number;
  invalid_count: number;
  audit_digests?: GovernancePureCheckShadowAuditDigests;
}

export interface GovernancePureCheckShadowAudit {
  schema: typeof PURE_CHECK_SHADOW_AUDIT_SCHEMA;
  audit_scope: typeof PURE_CHECK_SHADOW_AUDIT_SCOPE;
  summary_semantics: 'audit_only_not_release_verdict';
  cache_semantics: 'shadow_no_skip';
  claim_store_read: boolean;
  claim_store_write: boolean;
  claim_count: number;
  valid_count: number;
  invalid_count: number;
  checks: readonly GovernancePureCheckShadowAuditCheck[];
  generated_at: string;
}

export interface BuildGovernancePureCheckShadowAuditInput {
  evaluations?: readonly GovernancePureCheckShadowAuditEvaluation[];
  manifest?: CurrentPureCheckIdentityManifest;
  includeMissingChecks?: boolean;
  generated_at?: string;
}

export interface BuildGovernancePureCheckShadowAuditForVerifyRunInput {
  executedScripts: readonly string[];
  generated_at?: string;
}

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
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

const DECISIONS = new Set<GovernancePureCheckReuseDecisionKind>([
  'reuse_allowed',
  'shadow_only',
  'rerun_required',
]);
const FORBIDDEN_RUNTIME_SEMANTIC_KEYS = new Set([
  'automated_release_verdict',
  'verdict',
  'release_verdict',
  'release_decision',
  'status',
  'exit_code',
  'cache_hit',
  'claim_reuse',
  'skip',
  'skipped',
  'producer',
  'owner',
]);
const VERIFY_SHARED_PREFLIGHT_PURE_CHECK_IDS = [
  'contracts',
  'openapi-contract',
  'openapi-generated',
  'lint',
  'typecheck',
] as const satisfies readonly CurrentPureCheckId[];
const PURE_CHECK_IDS_BY_VERIFY_SCRIPT = new Map<string, readonly CurrentPureCheckId[]>([
  ['verify:quick', VERIFY_SHARED_PREFLIGHT_PURE_CHECK_IDS],
  ['verify:default', VERIFY_SHARED_PREFLIGHT_PURE_CHECK_IDS],
]);

function assertNoSecretLookingString(value: string, path: string): void {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`pure check shadow audit ${path} contains a secret-looking string.`);
  }
}

function assertNonNegativeInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`pure check shadow audit ${path} must be a non-negative integer.`);
  }
}

function assertReasonCodes(reasonCodes: readonly string[], checkId: string): readonly string[] {
  if (reasonCodes.length === 0) {
    throw new Error(`pure check shadow audit ${checkId} must include at least one reason code.`);
  }

  const uniqueReasons: string[] = [];
  reasonCodes.forEach((reason, index) => {
    assertNoSecretLookingString(reason, `${checkId}.reason_codes[${index}]`);
    if (!REASON_CODE_PATTERN.test(reason)) {
      throw new Error(`pure check shadow audit ${checkId}.reason_codes[${index}] must be snake_case.`);
    }
    if (FORBIDDEN_RUNTIME_SEMANTIC_KEYS.has(reason)) {
      throw new Error(`pure check shadow audit ${checkId}.reason_codes[${index}] is a forbidden runtime/cache/verdict semantic.`);
    }
    if (!uniqueReasons.includes(reason)) {
      uniqueReasons.push(reason);
    }
  });
  return uniqueReasons;
}

function assertCounts(evaluation: GovernancePureCheckShadowAuditEvaluation): void {
  assertNonNegativeInteger(evaluation.claim_count, `${evaluation.check_id}.claim_count`);
  assertNonNegativeInteger(evaluation.valid_count, `${evaluation.check_id}.valid_count`);
  assertNonNegativeInteger(evaluation.invalid_count, `${evaluation.check_id}.invalid_count`);
  if (evaluation.valid_count + evaluation.invalid_count !== evaluation.claim_count) {
    throw new Error(`pure check shadow audit ${evaluation.check_id} claim counts must balance.`);
  }
  if (!evaluation.claim_store_read && evaluation.claim_count !== 0) {
    throw new Error(`pure check shadow audit ${evaluation.check_id} cannot report claims without claim_store_read.`);
  }
}

function assertSupportedResultPair(args: {
  checkId: string;
  resultStatus: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
}): void {
  if (!CURRENT_GATE_RESULT_STATUSES.includes(args.resultStatus)) {
    throw new Error(`pure check shadow audit ${args.checkId}.result_status is not supported.`);
  }
  if (!CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(args.failureClass)) {
    throw new Error(`pure check shadow audit ${args.checkId}.failure_class is not supported.`);
  }
  if (args.resultStatus === 'passed' && args.failureClass !== 'none') {
    throw new Error(`pure check shadow audit ${args.checkId} passed result must use failure_class none.`);
  }
  if (args.resultStatus === 'failed' && args.failureClass === 'none') {
    throw new Error(`pure check shadow audit ${args.checkId} failed result must use a non-none failure_class.`);
  }
}

function assertResultRef(evaluation: GovernancePureCheckShadowAuditEvaluation): {
  result_status?: CurrentGateResultStatus;
  failure_class?: CurrentGateResultFailureClass;
} {
  if (evaluation.result_status === undefined && evaluation.failure_class === undefined) {
    return {};
  }
  if (evaluation.result_status === undefined || evaluation.failure_class === undefined) {
    throw new Error(`pure check shadow audit ${evaluation.check_id} result_status and failure_class must be reported together.`);
  }
  assertSupportedResultPair({
    checkId: evaluation.check_id,
    resultStatus: evaluation.result_status,
    failureClass: evaluation.failure_class,
  });
  return {
    result_status: evaluation.result_status,
    failure_class: evaluation.failure_class,
  };
}

function normalizeScriptResults(
  checkId: string,
  scriptResults: readonly GovernancePureCheckShadowAuditScriptResult[] | undefined,
): readonly GovernancePureCheckShadowAuditScriptResult[] | undefined {
  if (!scriptResults || scriptResults.length === 0) {
    return undefined;
  }

  return scriptResults.map((scriptResult, index) => {
    assertNoSecretLookingString(scriptResult.script, `${checkId}.script_results[${index}].script`);
    assertSupportedResultPair({
      checkId,
      resultStatus: scriptResult.result_status,
      failureClass: scriptResult.failure_class,
    });
    return {
      script: scriptResult.script,
      result_status: scriptResult.result_status,
      failure_class: scriptResult.failure_class,
    };
  });
}

function assertNoForbiddenRuntimeSemanticKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenRuntimeSemanticKeys(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RUNTIME_SEMANTIC_KEYS.has(key)) {
      throw new Error(`pure check shadow audit ${path}.${key} is a forbidden runtime/cache/verdict semantic.`);
    }
    assertNoForbiddenRuntimeSemanticKeys(nested, `${path}.${key}`);
  }
}

function scopedAuditDigests(
  checkId: string,
  digests: GovernancePureCheckShadowAuditEvaluation['audit_digests'],
): GovernancePureCheckShadowAuditDigests | undefined {
  if (!digests) {
    return undefined;
  }

  const output: GovernancePureCheckShadowAuditDigests = {
    scope: PURE_CHECK_SHADOW_AUDIT_SCOPE,
  };
  for (const field of ['input', 'artifact', 'result', 'claim'] as const) {
    const digest = digests[field];
    if (digest === undefined) {
      continue;
    }
    if (!SHA256_DIGEST_PATTERN.test(digest)) {
      throw new Error(`pure check shadow audit digest ${checkId}.${field} must use sha256:<64 lowercase hex>.`);
    }
    output[field] = digest;
  }

  return output;
}

function normalizeEvaluation(
  evaluation: GovernancePureCheckShadowAuditEvaluation,
  cachePolicy: CurrentPureCheckCachePolicy,
): GovernancePureCheckShadowAuditCheck {
  assertNoForbiddenRuntimeSemanticKeys(evaluation, evaluation.check_id);
  assertCounts(evaluation);
  if (!DECISIONS.has(evaluation.decision)) {
    throw new Error(`pure check shadow audit ${evaluation.check_id} decision is not supported.`);
  }
  if (evaluation.cache_policy !== undefined && evaluation.cache_policy !== cachePolicy) {
    throw new Error(`pure check shadow audit ${evaluation.check_id} cache_policy must match the current manifest.`);
  }
  const resultRef = assertResultRef(evaluation);
  const scriptResults = normalizeScriptResults(evaluation.check_id, evaluation.script_results);
  const wouldReuse = evaluation.decision === 'reuse_allowed';
  const decision = cachePolicy === 'shadow' && wouldReuse ? 'shadow_only' : evaluation.decision;
  const reasonCodes = assertReasonCodes(evaluation.reason_codes, evaluation.check_id);
  const shadowReasonCodes = cachePolicy === 'shadow' && wouldReuse && !reasonCodes.includes('cache_policy_shadow_only')
    ? [...reasonCodes, 'cache_policy_shadow_only']
    : reasonCodes;

  const auditDigests = scopedAuditDigests(evaluation.check_id, evaluation.audit_digests);
  return {
    check_id: evaluation.check_id,
    cache_policy: cachePolicy,
    decision,
    would_reuse: wouldReuse,
    ...resultRef,
    ...(scriptResults ? { script_results: scriptResults } : {}),
    reason_codes: shadowReasonCodes,
    claim_store_read: evaluation.claim_store_read,
    claim_store_write: evaluation.claim_store_write,
    claim_count: evaluation.claim_count,
    valid_count: evaluation.valid_count,
    invalid_count: evaluation.invalid_count,
    ...(auditDigests ? { audit_digests: auditDigests } : {}),
  };
}

function defaultMissingEvaluation(checkId: CurrentPureCheckId): GovernancePureCheckShadowAuditEvaluation {
  return {
    check_id: checkId,
    decision: 'rerun_required',
    cache_policy: 'shadow',
    reason_codes: ['pure_check_shadow_evaluation_not_available'],
    claim_store_read: false,
    claim_store_write: false,
    claim_count: 0,
    valid_count: 0,
    invalid_count: 0,
  };
}

export function buildGovernancePureCheckShadowAudit(
  input: BuildGovernancePureCheckShadowAuditInput = {},
): GovernancePureCheckShadowAudit {
  const manifest = input.manifest ?? CURRENT_PURE_CHECK_IDENTITY_MANIFEST;
  const identitiesById = new Map(manifest.checks.map((check) => [check.check_id, check]));
  const evaluationsById = new Map<CurrentPureCheckId, GovernancePureCheckShadowAuditEvaluation>();

  for (const evaluation of input.evaluations ?? []) {
    const identity = identitiesById.get(evaluation.check_id);
    if (!identity) {
      throw new Error(`pure check shadow audit unknown check_id: ${evaluation.check_id}.`);
    }
    if (evaluationsById.has(evaluation.check_id)) {
      throw new Error(`pure check shadow audit duplicate check_id: ${evaluation.check_id}.`);
    }
    evaluationsById.set(evaluation.check_id, evaluation);
  }

  const checks = manifest.checks
    .flatMap((identity) => {
      const evaluation = evaluationsById.get(identity.check_id);
      if (!evaluation && input.includeMissingChecks === false) {
        return [];
      }
      return [normalizeEvaluation(evaluation ?? defaultMissingEvaluation(identity.check_id), identity.cache_policy)];
    });

  return {
    schema: PURE_CHECK_SHADOW_AUDIT_SCHEMA,
    audit_scope: PURE_CHECK_SHADOW_AUDIT_SCOPE,
    summary_semantics: 'audit_only_not_release_verdict',
    cache_semantics: 'shadow_no_skip',
    claim_store_read: checks.some((check) => check.claim_store_read),
    claim_store_write: checks.some((check) => check.claim_store_write),
    claim_count: checks.reduce((sum, check) => sum + check.claim_count, 0),
    valid_count: checks.reduce((sum, check) => sum + check.valid_count, 0),
    invalid_count: checks.reduce((sum, check) => sum + check.invalid_count, 0),
    checks,
    generated_at: input.generated_at ?? new Date().toISOString(),
  };
}

export function buildGovernancePureCheckShadowAuditForVerifyRun(
  input: BuildGovernancePureCheckShadowAuditForVerifyRunInput,
): GovernancePureCheckShadowAudit {
  const checkIds = [...new Set(
    input.executedScripts.flatMap((script) => PURE_CHECK_IDS_BY_VERIFY_SCRIPT.get(script) ?? []),
  )];

  return buildGovernancePureCheckShadowAudit({
    includeMissingChecks: false,
    generated_at: input.generated_at,
    evaluations: checkIds.map((checkId) => ({
      check_id: checkId,
      decision: 'shadow_only',
      reason_codes: ['producer_execution_confirmed_shadow_only'],
      claim_store_read: false,
      claim_store_write: false,
      claim_count: 0,
      valid_count: 0,
      invalid_count: 0,
    })),
  });
}
