import { describe, expect, it } from 'vitest';
import {
  RESOURCE_POLICY_RULE_DEFINITIONS,
  RESOURCE_POLICY_RULE_MATRIX,
  validatePolicyRulesForResource,
} from '@/lib/constants/resource-policy';

describe('validatePolicyRulesForResource', () => {
  it('rejects non-endpoint resource policy rules', () => {
    const result = validatePolicyRulesForResource(
      'agent',
      { rules: [{ key: 'agent.requests_per_minute', value: 3 }] },
      undefined
    );
    expect(result.valid).toBe(false);
  });

  it('rejects endpoint agent-rate rule', () => {
    const result = validatePolicyRulesForResource(
      'endpoint',
      { rules: [{ key: 'agent.requests_per_minute', value: 3 }] },
      undefined
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.invalidKeys).toContain('agent.requests_per_minute');
    }
  });

  it('accepts endpoint spending-per-day rule in spending bucket', () => {
    const result = validatePolicyRulesForResource(
      'endpoint',
      undefined,
      { rules: [{ key: 'endpoint.spending_usd_per_day', value: 100, window: 'day' }] }
    );
    expect(result.valid).toBe(true);
  });

  it('keeps rule definitions aligned with allowed-key matrix', () => {
    for (const resourceType of Object.keys(RESOURCE_POLICY_RULE_MATRIX) as Array<
      keyof typeof RESOURCE_POLICY_RULE_MATRIX
    >) {
      const allowedKeys = new Set([
        ...RESOURCE_POLICY_RULE_MATRIX[resourceType].rate,
        ...RESOURCE_POLICY_RULE_MATRIX[resourceType].spending,
      ]);
      for (const definition of RESOURCE_POLICY_RULE_DEFINITIONS[resourceType]) {
        expect(allowedKeys.has(definition.key)).toBe(true);
      }
    }
  });
});
