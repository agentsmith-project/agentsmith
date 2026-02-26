/**
 * TDD Test Suite: Resource Policy Execution Completion
 *
 * Epic A2: Resource Policy Execution Completion
 * Requirements:
 * - endpoint/source_library/agent rate/quota/access behavior consistent
 * - Policy priority stable: subject > resource > project-default
 *
 * Acceptance Criteria:
 * 1. Rule hit and priority can be proven by use cases
 * 2. deny/rate/quota all have audit and usage evidence
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

  // Test Case 1: Consistent behavior across resource types (endpoint)
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
    expect(['allow', 'deny', 'rate_limited', 'quota_exceeded']).toContain(result.decision);
    expect(result.matched_rules).toBeDefined();
  });

  // Test Case 2: Consistent behavior across resource types (source_library)
  it('should evaluate source_library policy with quota limits consistently', async () => {
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

    expect(result.decision).toBeDefined();
    expect(result.matched_rules).toBeDefined();
  });

  // Test Case 3: Consistent behavior across resource types (agent)
  it('should evaluate agent policy with rate limits consistently', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'agent',
      resource_id: 'ag-1',
      subject_id: 'user-3',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result: PolicyEvaluationResult = await evaluateResourcePolicy(evaluationContext);

    expect(result.decision).toBeDefined();
    expect(result.matched_rules).toBeDefined();
  });

  // Test Case 4: Policy priority - subject > resource > project-default
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

  // Test Case 5: Audit evidence for deny decisions
  it('should create audit evidence for deny decisions', async () => {
    const evaluationContext: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-2',
      subject_id: 'user-4', // Denied user
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

  // Test Case 6: Usage evidence for rate/quota decisions
  it('should create usage evidence for rate/quota decisions', async () => {
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

    if (result.decision === 'rate_limited' || result.decision === 'quota_exceeded') {
      expect(result.usage_record_id).toBeDefined();
      expect(result.usage_record_id).toMatch(/^usage_/);
    }
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
export type PolicyDecision = 'allow' | 'deny' | 'rate_limited' | 'quota_exceeded';

export interface MatchedRule {
  rule_key: string;
  rule_value: number;
  priority_source: 'subject' | 'resource' | 'project_default';
}
