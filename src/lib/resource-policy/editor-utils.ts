import type {
  PolicyRule,
  PolicyRuleKey,
  PolicyResourceType,
} from '@/lib/api/types';
import { getRuleDefinitionsForResource } from '@/lib/constants/resource-policy';

export function createSubjectRowId(): string {
  return `subject_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function buildDraftRuleValues(
  resourceType: PolicyResourceType,
  current: { rateRules?: PolicyRule[]; quotaRules?: PolicyRule[] },
): Partial<Record<PolicyRuleKey, string>> {
  const draft: Partial<Record<PolicyRuleKey, string>> = {};
  for (const definition of getRuleDefinitionsForResource(resourceType)) {
    const sourceRules = definition.bucket === 'rate' ? current.rateRules : current.quotaRules;
    const matched = sourceRules?.find((rule) => rule.key === definition.key);
    if (matched) {
      draft[definition.key] = String(matched.value);
    }
  }
  return draft;
}

export function buildRuleSetFromDraft(
  resourceType: PolicyResourceType,
  currentRateRules: PolicyRule[] | undefined,
  currentQuotaRules: PolicyRule[] | undefined,
  draftValues: Partial<Record<PolicyRuleKey, string>>,
): { rateRules: PolicyRule[]; quotaRules: PolicyRule[] } {
  let rateRules = [...(currentRateRules ?? [])];
  let quotaRules = [...(currentQuotaRules ?? [])];
  for (const definition of getRuleDefinitionsForResource(resourceType)) {
    const value = parsePositiveNumber(draftValues[definition.key] ?? '');
    if (definition.bucket === 'rate') {
      rateRules = upsertRule(rateRules, definition.key, value, definition.window);
    } else {
      quotaRules = upsertRule(quotaRules, definition.key, value, definition.window);
    }
  }
  return { rateRules, quotaRules };
}

export function mergeRuleSources(
  rootRateRules: PolicyRule[],
  rootQuotaRules: PolicyRule[],
  subjectRateRules: PolicyRule[],
  subjectQuotaRules: PolicyRule[],
): Map<PolicyRuleKey, 'resource' | 'subject'> {
  const sourceMap = new Map<PolicyRuleKey, 'resource' | 'subject'>();
  [...rootRateRules, ...rootQuotaRules].forEach((rule) => {
    sourceMap.set(rule.key, 'resource');
  });
  [...subjectRateRules, ...subjectQuotaRules].forEach((rule) => {
    sourceMap.set(rule.key, 'subject');
  });
  return sourceMap;
}

export function formatRuleValue(rule: PolicyRule, tResource: (key: string) => string): string {
  if (rule.key === 'endpoint.daily_token_limit') {
    return `${rule.value} ${tResource('units.tokens_per_day')}`;
  }
  if (rule.key === 'endpoint.requests_per_5_hours') {
    return `${rule.value} ${tResource('units.requests_per_5_hours')}`;
  }
  if (rule.key === 'endpoint.requests_per_day') {
    return `${rule.value} ${tResource('units.requests_per_day')}`;
  }
  if (
    rule.key === 'endpoint.spending_usd_per_minute'
    || rule.key === 'endpoint.spending_usd_per_5_hours'
    || rule.key === 'endpoint.spending_usd_per_day'
  ) {
    return `$${rule.value} ${tResource(`units.${rule.key.replace('endpoint.', '')}`)}`;
  }
  if (rule.key === 'source_library.max_total_files') {
    return `${rule.value} ${tResource('units.files')}`;
  }
  if (rule.key === 'source_library.max_file_size_bytes') {
    return formatBytes(rule.value, tResource);
  }
  return `${rule.value} ${tResource('units.sessions')}`;
}

function parsePositiveNumber(input: string): number | undefined {
  if (!input) return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function upsertRule(
  rules: PolicyRule[] | undefined,
  key: PolicyRuleKey,
  value: number | undefined,
  window?: 'day' | null,
): PolicyRule[] {
  const base = [...(rules ?? [])].filter((rule) => rule.key !== key);
  if (value === undefined) return base;
  base.push({
    key,
    value,
    ...(window !== undefined ? { window } : {}),
  });
  return base;
}

function formatBytes(bytes: number, tResource: (key: string) => string): string {
  if (bytes < 1024) return `${bytes} ${tResource('units.byte')}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number(kb.toFixed(1))} ${tResource('units.kib')}`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Number(mb.toFixed(1))} ${tResource('units.mib')}`;
  const gb = mb / 1024;
  return `${Number(gb.toFixed(1))} ${tResource('units.gib')}`;
}
