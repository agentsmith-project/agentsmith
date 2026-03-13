import type { ReactNode } from 'react';
import type { PolicyRule, PolicyRuleKey } from '@/lib/api/types';
import type { ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';

export function getDefaultActionForResourceType(resourceType: ResourceRow['type']): string {
  if (resourceType !== 'endpoint') return 'invoke';
  return 'invoke';
}

export function renderRuleSummary(
  rateRules: PolicyRule[],
  spendingRules: PolicyRule[],
  labelForKey: (key: PolicyRuleKey) => string,
  noRulesText: string,
  valueForRule: (rule: PolicyRule) => string,
  sourceForRule?: (rule: PolicyRule) => string,
): ReactNode {
  const rules = [...rateRules, ...spendingRules];
  if (rules.length === 0) {
    return <p className="text-xs text-tertiary">{noRulesText}</p>;
  }
  return rules.map((rule) => (
    <p key={`${rule.key}-${rule.value}`} className="text-xs text-tertiary">
      {labelForKey(rule.key)}:{' '}
      <span className="text-primary">{valueForRule(rule)}</span>
      {sourceForRule ? (
        <span className="ml-1 text-[11px] text-tertiary">({sourceForRule(rule)})</span>
      ) : null}
    </p>
  ));
}
