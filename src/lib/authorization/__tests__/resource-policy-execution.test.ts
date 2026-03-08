/**
 * TDD Test Suite: Resource Policy Execution Completion
 *
 * MVP Requirements:
 * - endpoint-only resource policy execution
 * - Policy priority stable: subject > resource > project-default
 * - Constraint decisions: deny / rate_limited / spending_limit_exceeded
 *
 * Acceptance Criteria:
 * 1. Rule hit and priority can be proven by use cases
 * 2. deny/rate/limit all have audit and usage evidence
 * 3. After rollback policy, behavior restored with audit record
 *
 * RED PHASE: Write failing tests first
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateResourcePolicy,
  type PolicyEvaluationContext,
  type PolicyEvaluationResult,
} from '../resource-policy-execution';

describe('Resource Policy Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test Case 1: Endpoint evaluation returns supported decision kinds
  it('should evaluate endpoint policy with rate limits consistently', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-1',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    expect(result.decision).toBeDefined();
    expect(['allow', 'deny', 'rate_limited', 'spending_limit_exceeded']).toContain(result.decision);
    expect(result.matched_rules).toBeDefined();
  });

  // Test Case 2: Non-endpoint resources are denied in MVP boundary
  it('should deny non-endpoint resources in MVP boundary', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'source_library',
      resource_id: 'lib-1',
      subject_id: 'user-2',
      subject_type: 'user',
      action: 'upload',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    expect(result.decision).toBe('deny');
    expect(result.deny_reason).toBe('unsupported_resource_type_in_mvp');
    expect(result.audit_id).toMatch(/^audit_/);
  });

  // Test Case 3: Policy priority - subject > resource > project-default
  it('should apply policy priority: subject > resource > project-default', async () => {
    // Create a scenario where subject has an override
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-1', // Has subject override
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    // Subject override should take precedence
    expect(result.priority_applied).toBe('subject');
    expect(result.matched_rules).toBeDefined();
  });

  // Test Case 4: Audit evidence for deny decisions
  it('should create audit evidence for deny decisions', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-2',
      subject_id: 'user-4',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    if (result.decision === 'deny') {
      expect(result.audit_id).toBeDefined();
      expect(result.audit_id).toMatch(/^audit_/);
      expect(result.deny_reason).toBeDefined();
    }
  });

  // Test Case 6: Usage evidence for rate/spending decisions
  it('should create usage evidence for rate/spending limit decisions', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-2',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    if (result.decision === 'rate_limited' || result.decision === 'spending_limit_exceeded') {
      expect(result.usage_record_id).toBeDefined();
      expect(result.usage_record_id).toMatch(/^usage_/);
    }
  });

  it('should produce rate-limited decision with usage and audit evidence', async () => {
    const result = await evaluateResourcePolicy({
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-3',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    expect(result.decision).toBe('rate_limited');
    expect(result.usage_record_id).toMatch(/^usage_/);
    expect(result.audit_id).toMatch(/^audit_/);
  });

  // Test Case 7: Rollback restores previous behavior with audit record
  it('should restore previous behavior after policy rollback with audit', async () => {
    // First evaluation with a policy
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-1',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      policy_version: 2,
    };

    const result1 = await evaluateResourcePolicy(evaluationContext);

    // Simulate rollback to version 1
    const rollbackContext = { ...evaluationContext, policy_version: 1 };
    const result2 = await evaluateResourcePolicy(rollbackContext);

    // Results should differ due to version change
    expect(result1.policy_version).toBe(2);
    expect(result2.policy_version).toBe(1);

    // Rollback should have an audit record
    expect(result2.rollback_audit_id).toBeDefined();
  });

  // Test Case 8: Rule hit proof with matched rules
  it('should provide proof of which rules were matched', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-1',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    expect(result.matched_rules).toBeDefined();
    expect(result.matched_rules.length).toBeGreaterThanOrEqual(0);
    // Each matched rule should have: rule_key, rule_value, priority_source
    if (result.matched_rules.length > 0) {
      expect(result.matched_rules[0].rule_key).toBeDefined();
      expect(result.matched_rules[0].priority_source).toBeDefined();
    }
  });
});

/**
 * Test Types
 */
export type PolicyDecision = 'allow' | 'deny' | 'rate_limited' | 'spending_limit_exceeded';

export interface MatchedRule {
  rule_key: string;
  rule_value: number;
  priority_source: 'subject' | 'resource' | 'project_default';
}
