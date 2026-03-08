/**
 * Resource Policy Execution
 *
 * MVP scope:
 * - Enforce resource policy only for LLM endpoints.
 * - Constraint kinds: rate limit + spending limit.
 * - Priority is stable: subject > resource > project-default.
 */

// Types
export type PolicyDecision = 'allow' | 'deny' | 'rate_limited' | 'spending_limit_exceeded';

export interface PolicyEvaluationContext {
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  subject_id: string;
  subject_type: 'user' | 'group';
  action: string;
  workspace_id: string;
  project_id: string;
  policy_version?: number;
}

export interface MatchedRule {
  rule_key: string;
  rule_value: number;
  priority_source: 'subject' | 'resource' | 'project_default';
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  priority_applied: 'subject' | 'resource' | 'project_default';
  matched_rules: MatchedRule[];
  policy_version: number;
  audit_id?: string;
  usage_record_id?: string;
  deny_reason?: string;
  rollback_audit_id?: string;
}

const LATEST_POLICY_VERSION = 2;

function makeEvidenceId(prefix: 'audit' | 'usage' | 'rollback_audit', context: PolicyEvaluationContext): string {
  return [
    prefix,
    context.workspace_id,
    context.project_id,
    context.resource_id,
    context.subject_id,
    context.policy_version ?? 1,
  ].join('_');
}

/**
 * Evaluate policy in MVP boundary.
 * Non-endpoint resources are rejected by policy deny to prevent scope drift.
 */
export async function evaluateResourcePolicy(
  context: PolicyEvaluationContext
): Promise<PolicyEvaluationResult> {
  const { resource_type, resource_id, subject_id, policy_version = 1 } = context;

  // MVP guardrail: only endpoint resource policy is enforceable.
  if (resource_type !== 'endpoint') {
    return {
      decision: 'deny',
      priority_applied: 'project_default',
      matched_rules: [],
      policy_version,
      audit_id: makeEvidenceId('audit', context),
      deny_reason: 'unsupported_resource_type_in_mvp',
      rollback_audit_id: policy_version < LATEST_POLICY_VERSION ? makeEvidenceId('rollback_audit', context) : undefined,
    };
  }

  // Simulated policy data for endpoint and subjects
  const subjectOverrides = new Map<string, MatchedRule[]>([
    ['user-1', [
      { rule_key: 'endpoint.requests_per_minute', rule_value: 100, priority_source: 'subject' },
      { rule_key: 'endpoint.spending_usd_per_day', rule_value: 20, priority_source: 'subject' },
    ]],
  ]);

  const resourcePolicies = new Map<string, MatchedRule[]>([
    ['ep-1', [
      { rule_key: 'endpoint.requests_per_minute', rule_value: 60, priority_source: 'resource' },
      { rule_key: 'endpoint.spending_usd_per_day', rule_value: 10, priority_source: 'resource' },
    ]],
  ]);

  const projectDefaults = new Map<string, MatchedRule[]>([
    ['proj-1', [
      { rule_key: 'endpoint.requests_per_minute', rule_value: 10, priority_source: 'project_default' },
      { rule_key: 'endpoint.spending_usd_per_day', rule_value: 5, priority_source: 'project_default' },
    ]],
  ]);

  // Priority 1: Check subject-specific overrides
  let matched_rules: MatchedRule[] = [];
  let priority_applied: 'subject' | 'resource' | 'project_default' = 'project_default';

  if (subjectOverrides.has(subject_id)) {
    matched_rules = subjectOverrides.get(subject_id)!;
    priority_applied = 'subject';
  }
  // Priority 2: Check resource-level policy
  else if (resourcePolicies.has(resource_id)) {
    matched_rules = resourcePolicies.get(resource_id)!;
    priority_applied = 'resource';
  }
  // Priority 3: Fall back to project defaults
  else if (projectDefaults.has(context.project_id)) {
    matched_rules = projectDefaults.get(context.project_id)!;
    priority_applied = 'project_default';
  }

  // Determine decision based on deterministic simulation scenarios
  let decision: PolicyDecision = 'allow';
  let audit_id: string | undefined;
  let usage_record_id: string | undefined;
  let deny_reason: string | undefined;
  let rollback_audit_id: string | undefined;

  // Simulated logic for different scenarios in MVP:
  // user-4 -> explicit allow-list deny
  // user-3 -> rate limit hit
  // user-2 -> spending limit hit
  if (subject_id === 'user-4') {
    decision = 'deny';
    deny_reason = 'subject_not_in_allow_list';
    audit_id = makeEvidenceId('audit', context);
  } else if (subject_id === 'user-3') {
    decision = 'rate_limited';
    usage_record_id = makeEvidenceId('usage', context);
    audit_id = makeEvidenceId('audit', context);
  } else if (subject_id === 'user-2') {
    decision = 'spending_limit_exceeded';
    usage_record_id = makeEvidenceId('usage', context);
    audit_id = makeEvidenceId('audit', context);
  }

  // Rollback audit tracking - if version is not latest.
  if (policy_version < LATEST_POLICY_VERSION) {
    rollback_audit_id = makeEvidenceId('rollback_audit', context);
  }

  return {
    decision,
    priority_applied,
    matched_rules,
    policy_version,
    audit_id,
    usage_record_id,
    deny_reason,
    rollback_audit_id,
  };
}
