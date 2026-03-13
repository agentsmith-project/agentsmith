'use client';

import type { PolicyRule } from '@/lib/api/types';
import { getRuleLabel, mergeRuleSets } from '@/lib/constants/resource-policy';
import { formatRuleValue, mergeRuleSources } from '@/lib/resource-policy/editor-utils';

import { renderRuleSummary } from '../resource-policy-page-utils';

interface ResourcePolicyEffectiveSummaryProps {
  accessMode: 'allow_all_members' | 'allow_list';
  draftRootRuleSet: {
    rateRules: PolicyRule[];
    spendingRules: PolicyRule[];
  };
  tResource: (key: string) => string;
  validSubjects: Array<{
    subject_type: 'group' | 'user';
    subject_id: string;
    rate_limits?: { rules: PolicyRule[] };
    spending_limits?: { rules: PolicyRule[] };
  }>;
}

export function ResourcePolicyEffectiveSummary({
  accessMode,
  draftRootRuleSet,
  tResource,
  validSubjects,
}: ResourcePolicyEffectiveSummaryProps) {
  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-2" data-testid="resource-policy__effective-summary">
      <p className="text-xs font-medium text-foreground">{tResource('effective_summary.title')}</p>
      <p className="text-xs text-tertiary">
        {tResource('effective_summary.access')}: <span className="text-primary">{tResource(`access_mode.${accessMode}`)}</span>
      </p>
      <div className="space-y-1">
        {renderRuleSummary(
          draftRootRuleSet.rateRules,
          draftRootRuleSet.spendingRules,
          (key) => tResource(getRuleLabel(key)),
          tResource('effective_summary.no_explicit_limits'),
          (rule) => formatRuleValue(rule, tResource),
          () => tResource('effective_summary.source_resource'),
        )}
      </div>
      {validSubjects.length > 0 ? (
        <div className="pt-2 border-t border-subtle space-y-2">
          {validSubjects.map((subject, index) => {
            const effectiveRate = mergeRuleSets(draftRootRuleSet.rateRules, subject.rate_limits?.rules ?? []);
            const effectiveSpending = mergeRuleSets(draftRootRuleSet.spendingRules, subject.spending_limits?.rules ?? []);
            const effectiveTrace = mergeRuleSources(
              draftRootRuleSet.rateRules,
              draftRootRuleSet.spendingRules,
              subject.rate_limits?.rules ?? [],
              subject.spending_limits?.rules ?? [],
            );
            return (
              <div
                key={`${subject.subject_type}:${subject.subject_id}:${index}`}
                className="space-y-1"
                data-testid={`resource-policy__effective-subject--${index}`}
              >
                <p className="text-xs text-tertiary">
                  {tResource(`subjects.${subject.subject_type}`)}: <span className="text-primary">{subject.subject_id}</span>
                </p>
                {renderRuleSummary(
                  effectiveRate,
                  effectiveSpending,
                  (key) => tResource(getRuleLabel(key)),
                  tResource('effective_summary.no_explicit_limits'),
                  (rule) => formatRuleValue(rule, tResource),
                  (rule) =>
                    tResource(
                      effectiveTrace.get(rule.key) === 'subject'
                        ? 'effective_summary.source_subject'
                        : 'effective_summary.source_resource',
                    ),
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
