import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const EXPECTED_USAGE_TOP_LEVEL_KEYS = [
  'title',
  'subtitle',
  'load_failed_with_reason',
  'permission_denied',
  'scope_my_usage',
  'view',
  'detail',
];

const EXPECTED_USAGE_VIEW_KEYS = [
  'limit_mode_all',
  'limit_mode_label',
  'limit_mode_rate',
  'limit_mode_spending',
  'rate_limit_title',
  'spending_limit_title',
  'limit_group_empty',
  'window',
  'limits_section_title',
  'limit_reset_at',
  'limits_empty',
  'panel_title',
  'remaining_suffix',
  'status_badge',
  'trend_section_title',
  'no_data',
  'no_data_hint',
  'period',
];

const EXPECTED_USAGE_VIEW_PERIOD_KEYS = [
  '24h',
  '48h',
];

const EXPECTED_USAGE_DETAIL_KEYS = [
  'title',
  'subtitle',
  'aggregate_bucket',
  'requests',
  'recovered',
  'cost',
  'errors_badge',
  'recovered_badge',
  'recovered_status',
  'missing_price',
  'pricing_source',
  'provider',
  'model',
  'error_class',
  'governance_title',
  'governance_kind',
  'enforcement_kind',
  'limit_key',
  'scope',
  'effective_limit',
  'current_usage',
  'usage_unit',
  'reason_label',
  'membership_status',
  'missing_permissions',
  'open_member_access',
  'open_resource_policy',
  'open_audit',
  'tokens',
  'decision_id',
  'estimated_cost',
  'timeline_title',
  'timeline_empty',
  'attempt_label',
  'empty',
];

const FORBIDDEN_USAGE_KEYS = [
  'lite',
  'dashboard',
  'kpi',
  'filters',
  'error_class',
  'summary',
  'table',
  'view_mode',
  'facts_table',
  'facts_summary',
  'operations',
];

function readUsageNamespace(localeFile: 'en-US.json' | 'zh-CN.json') {
  const fullPath = path.resolve(process.cwd(), 'src/messages', localeFile);
  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as { usage?: Record<string, unknown> };
  return parsed.usage ?? {};
}

describe('usage i18n boundary guard', () => {
  it.each(['en-US.json', 'zh-CN.json'] as const)('keeps usage namespace minimal for %s', (localeFile) => {
    const usage = readUsageNamespace(localeFile) as Record<string, unknown>;

    expect(Object.keys(usage).sort()).toEqual([...EXPECTED_USAGE_TOP_LEVEL_KEYS].sort());

    for (const forbiddenKey of FORBIDDEN_USAGE_KEYS) {
      expect(usage[forbiddenKey]).toBeUndefined();
    }

    const view = usage.view as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([...EXPECTED_USAGE_VIEW_KEYS].sort());

    const viewPeriod = view.period as Record<string, unknown>;
    expect(Object.keys(viewPeriod).sort()).toEqual([...EXPECTED_USAGE_VIEW_PERIOD_KEYS].sort());

    const detail = usage.detail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual([...EXPECTED_USAGE_DETAIL_KEYS].sort());
  });
});
