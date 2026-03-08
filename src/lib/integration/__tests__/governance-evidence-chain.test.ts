/**
 * M3 Integration Tests: Governance Evidence Chain
 *
 * Epic A (Governance) Integration Tests
 * Testing: Authorization + Policy Execution + Audit Trail
 *
 * M3 Goal: Verify all epics work together and evidence is complete.
 *
 * RED PHASE: Write failing tests first
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkPermission,
  type AuthorizationContext,
} from '../../authorization/unified-authorization';
import {
  evaluateResourcePolicy,
  type PolicyEvaluationContext,
} from '../../authorization/resource-policy-execution';
import {
  updateMemberPermissions,
} from '../../authorization/permission-propagation';

describe('M3 Integration: Governance Evidence Chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Integration Test 1: Permission decision creates audit trail
  it('should create audit trail when permission is checked', async () => {
    const context: AuthorizationContext = {
      member_id: 'user-1',
      permission: 'project:manage',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
    };

    const result = await checkPermission(context);

    // Verify audit trail is created
    expect(result.audit_id).toBeDefined();
    expect(result.audit_id).toMatch(/^audit_/);
    expect(result.check_id).toBeDefined();
    expect(result.checked_at).toBeDefined();
  });

  // Integration Test 2: Permission change propagates to authorization check
  it('should reflect permission changes in subsequent authorization checks', async () => {
    const member_id = 'user-2';
    const workspace_id = 'ws-1';
    const project_id = 'proj-1';

    // Update permissions
    await updateMemberPermissions({
      member_id,
      workspace_id,
      project_id,
      permissions: ['project:manage'],
      mode: 'custom',
    });

    // Check authorization immediately
    const result = await checkPermission({
      member_id,
      permission: 'project:manage',
      resource_context: { workspace_id, project_id },
    });

    expect(result.granted).toBe(true);
  });

  // Integration Test 3: Endpoint spending-limit decision creates usage evidence
  it('should create usage evidence when spending limit is hit', async () => {
    const context: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-2', // Has spending-limit exceeded outcome in simulation
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result = await evaluateResourcePolicy(context);

    if (result.decision === 'spending_limit_exceeded') {
      expect(result.usage_record_id).toBeDefined();
      expect(result.usage_record_id).toMatch(/^usage_/);
      expect(result.audit_id).toBeDefined();
    }
  });

  // Integration Test 4: Permission deny creates proper denial reason
  it('should provide denial reason when permission is denied', async () => {
    const context: AuthorizationContext = {
      member_id: 'user-4', // Denied user
      permission: 'project:manage',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
    };

    const result = await checkPermission(context);

    if (!result.granted) {
      expect(result.denial_reason).toBeDefined();
      expect(result.denial_reason).not.toBe('');
      expect(result.audit_id).toBeDefined();
    }
  });

  // Integration Test 5: Policy priority is correctly applied
  it('should apply subject > resource > project-default priority', async () => {
    const context: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-1', // Has subject override
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    };

    const result = await evaluateResourcePolicy(context);

    expect(result.priority_applied).toBe('subject');
    expect(result.matched_rules).toBeDefined();
    expect(result.matched_rules.length).toBeGreaterThan(0);
    expect(result.matched_rules[0].priority_source).toBe('subject');
  });

  // Integration Test 6: Permission version changes create rollback audit
  it('should create rollback audit when policy version changes', async () => {
    const context: PolicyEvaluationContext = {
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: 'user-1',
      subject_type: 'user',
      action: 'use',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      policy_version: 1, // Older version
    };

    const result = await evaluateResourcePolicy(context);

    // Should indicate rollback
    expect(result.rollback_audit_id).toBeDefined();
    expect(result.rollback_audit_id).toMatch(/^rollback_audit_/);
  });

  // Integration Test 7: Full evidence chain for permission + policy
  it('should create complete evidence chain for authorization + policy', async () => {
    const member_id = 'user-1';
    const workspace_id = 'ws-1';
    const project_id = 'proj-1';

    // 1. Check permission (creates audit)
    const authzResult = await checkPermission({
      member_id,
      permission: 'project:endpoint:use',
      resource_context: { workspace_id, project_id },
    });

    // 2. Evaluate policy (creates usage evidence for limits)
    const policyResult = await evaluateResourcePolicy({
      resource_type: 'endpoint',
      resource_id: 'ep-1',
      subject_id: member_id,
      subject_type: 'user',
      action: 'use',
      workspace_id,
      project_id,
    });

    // Verify complete evidence chain
    expect(authzResult.audit_id).toBeDefined();
    expect(authzResult.check_id).toBeDefined();
    expect(policyResult.policy_version).toBeDefined();
    expect(policyResult.matched_rules).toBeDefined();

    // Policy audit_id is created for deny/limit decisions
    if (policyResult.decision !== 'allow') {
      expect(policyResult.audit_id).toBeDefined();
    }
  });
});
