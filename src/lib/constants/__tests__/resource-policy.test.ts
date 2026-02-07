import { describe, expect, it } from 'vitest';
import {
  RESOURCE_POLICY_RULE_DEFINITIONS,
  RESOURCE_POLICY_RULE_MATRIX,
  validatePolicyRulesForResource,
} from '@/lib/constants/resource-policy';

describe('validatePolicyRulesForResource', () => {
  it('accepts agent concurrency rule', () => {
    const result = validatePolicyRulesForResource(
      'agent',
      { rules: [{ key: 'agent.max_concurrency', value: 3 }] },
      undefined
    );
    expect(result.valid).toBe(true);
  });

  it('rejects endpoint concurrency rule', () => {
    const result = validatePolicyRulesForResource(
      'endpoint',
      { rules: [{ key: 'agent.max_concurrency', value: 3 }] },
      undefined
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.invalidKeys).toContain('agent.max_concurrency');
    }
  });

  it('accepts endpoint daily token limit rule in quota bucket', () => {
    const result = validatePolicyRulesForResource(
      'endpoint',
      undefined,
      { rules: [{ key: 'endpoint.daily_token_limit', value: 100000, window: 'day' }] }
    );
    expect(result.valid).toBe(true);
  });

  it('keeps rule definitions aligned with allowed-key matrix', () => {
    for (const resourceType of Object.keys(RESOURCE_POLICY_RULE_MATRIX) as Array<
      keyof typeof RESOURCE_POLICY_RULE_MATRIX
    >) {
      const allowedKeys = new Set([
        ...RESOURCE_POLICY_RULE_MATRIX[resourceType].rate,
        ...RESOURCE_POLICY_RULE_MATRIX[resourceType].quota,
      ]);
      for (const definition of RESOURCE_POLICY_RULE_DEFINITIONS[resourceType]) {
        expect(allowedKeys.has(definition.key)).toBe(true);
      }
    }
  });
});
