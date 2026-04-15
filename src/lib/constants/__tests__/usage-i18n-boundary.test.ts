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
  'active_limits',
  'card_out_of',
  'card_remaining',
  'cards',
  'endpoints_label',
  'last_30_days',
  'limit_not_configured',
  'limit_reset_at',
  'limits_empty',
  'limits_section_title',
  'no_data',
  'no_data_hint',
  'panel_title',
  'scope_note',
  'trend_last_30_days',
  'trend_section_title',
  'window',
];

const EXPECTED_USAGE_DETAIL_KEYS = [
  'aggregate_bucket',
  'attempt_label',
  'cost',
  'current_usage',
  'decision_id',
  'effective_limit',
  'empty',
  'enforcement_kind',
  'error_class',
  'errors_badge',
  'estimated_cost',
  'governance_kind',
  'governance_title',
  'limit_key',
  'membership_status',
  'missing_permissions',
  'missing_price',
  'model',
  'open_audit',
  'open_member_access',
  'open_resource_policy',
  'pricing_source',
  'provider',
  'reason_label',
  'recovered',
  'recovered_badge',
  'recovered_status',
  'requests',
  'scope',
  'subtitle',
  'timeline_empty',
  'timeline_title',
  'title',
  'tokens',
  'usage_unit',
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

    const detail = usage.detail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual([...EXPECTED_USAGE_DETAIL_KEYS].sort());
  });
});
