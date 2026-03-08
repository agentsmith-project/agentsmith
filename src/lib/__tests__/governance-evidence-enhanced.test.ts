/**
 * Governance Evidence Pipeline - Tests
 *
 * TDD: Tests for enhanced evidence pipeline
 */

import { describe, expect, it } from 'vitest';
import {
  classifyGovernanceEvidenceFocus,
  getGovernanceEvidenceCount,
  getEvidenceTargetPage,
  buildEvidenceFilterContext,
} from '@/lib/governance-evidence';
import type { GovernanceDrilldownContext } from '@/lib/governance-drilldown-context';

describe('classifyGovernanceEvidenceFocus', () => {
  it('classifies limit-related reasons', () => {
    expect(classifyGovernanceEvidenceFocus('missing_source_library_limit')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('rate_limit_exceeded')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('spending_limit_exceeded')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('max_total_files_reached')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('max_file_size_exceeded')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('daily_limit')).toBe('limit');
  });

  it('classifies cost-related reasons', () => {
    expect(classifyGovernanceEvidenceFocus('token_usage_budget_alert')).toBe('cost');
    expect(classifyGovernanceEvidenceFocus('billing_threshold_exceeded')).toBe('cost');
    expect(classifyGovernanceEvidenceFocus('usage_spike_detected')).toBe('cost');
    expect(classifyGovernanceEvidenceFocus('budget_overrun_warning')).toBe('cost');
  });

  it('classifies deny-related reasons', () => {
    expect(classifyGovernanceEvidenceFocus('permission_denied')).toBe('deny');
    expect(classifyGovernanceEvidenceFocus('access_blocked')).toBe('deny');
    expect(classifyGovernanceEvidenceFocus('request_forbidden')).toBe('deny');
    expect(classifyGovernanceEvidenceFocus('removed_member_with_project_scope')).toBe('deny');
  });

  it('classifies exposure-related reasons', () => {
    expect(classifyGovernanceEvidenceFocus('public_visibility')).toBe('exposure');
    expect(classifyGovernanceEvidenceFocus('open_access_enabled')).toBe('exposure');
    expect(classifyGovernanceEvidenceFocus('visibility_exposed')).toBe('exposure');
  });

  it('classifies membership-related reasons', () => {
    expect(classifyGovernanceEvidenceFocus('member_scope_review')).toBe('membership');
    expect(classifyGovernanceEvidenceFocus('role_change_required')).toBe('membership');
    expect(classifyGovernanceEvidenceFocus('governance_policy_violation')).toBe('membership');
  });

  it('classifies unknown reasons as other', () => {
    expect(classifyGovernanceEvidenceFocus('')).toBe('other');
    expect(classifyGovernanceEvidenceFocus(undefined)).toBe('other');
    expect(classifyGovernanceEvidenceFocus('unknown_reason_type')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(classifyGovernanceEvidenceFocus('SPENDING_LIMIT_EXCEEDED')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('Permission_Denied')).toBe('deny');
    expect(classifyGovernanceEvidenceFocus('Public_Visibility')).toBe('exposure');
  });

  it('handles whitespace', () => {
    expect(classifyGovernanceEvidenceFocus('  spending_limit_exceeded  ')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('  ')).toBe('other');
  });
});

describe('getGovernanceEvidenceCount', () => {
  it('prefers related_signals when available', () => {
    const context: GovernanceDrilldownContext = {
      gov_from: 'organization_overview',
      gov_kind: 'project',
      gov_workspace_id: 'ws_1',
      gov_related_signals: 7,
      gov_blocked_signals: 2,
      gov_warning_signals: 3,
    };
    expect(getGovernanceEvidenceCount(context)).toBe(7);
  });

  it('falls back to blocked + warning sum', () => {
    const context: GovernanceDrilldownContext = {
      gov_from: 'organization_overview',
      gov_kind: 'project',
      gov_workspace_id: 'ws_1',
      gov_blocked_signals: 2,
      gov_warning_signals: 3,
    };
    expect(getGovernanceEvidenceCount(context)).toBe(5);
  });

  it('returns undefined when no signals present', () => {
    const context: GovernanceDrilldownContext = {
      gov_from: 'organization_overview',
      gov_kind: 'project',
      gov_workspace_id: 'ws_1',
    };
    expect(getGovernanceEvidenceCount(context)).toBeUndefined();
  });

  it('returns 0 when blocked and warning are both 0', () => {
    const context: GovernanceDrilldownContext = {
      gov_from: 'organization_overview',
      gov_kind: 'project',
      gov_workspace_id: 'ws_1',
      gov_blocked_signals: 0,
      gov_warning_signals: 0,
    };
    expect(getGovernanceEvidenceCount(context)).toBeUndefined();
  });
});

describe('getEvidenceTargetPage', () => {
  it('returns audit page for limit focus', () => {
    expect(getEvidenceTargetPage('limit')).toBe('audit');
  });

  it('returns usage page for cost focus', () => {
    expect(getEvidenceTargetPage('cost')).toBe('usage');
  });

  it('returns audit page for deny focus', () => {
    expect(getEvidenceTargetPage('deny')).toBe('audit');
  });

  it('returns members page for membership focus', () => {
    expect(getEvidenceTargetPage('membership')).toBe('members');
  });

  it('returns settings page for exposure focus', () => {
    expect(getEvidenceTargetPage('exposure')).toBe('settings');
  });

  it('returns audit page for other focus (default)', () => {
    expect(getEvidenceTargetPage('other')).toBe('audit');
  });
});

describe('buildEvidenceFilterContext', () => {
  const baseContext: GovernanceDrilldownContext = {
    gov_from: 'organization_overview',
    gov_kind: 'project',
    gov_workspace_id: 'ws_1',
    gov_project_id: 'proj_1',
    gov_reason: 'spending_limit_exceeded',
  };

  it('builds filter context for limit focus', () => {
    const result = buildEvidenceFilterContext(baseContext, 'limit');
    expect(result.gov_focus).toBe('limit');
    expect(result.gov_entity_filter?.project_ids).toContain('proj_1');
  });

  it('builds filter context for cost focus', () => {
    const result = buildEvidenceFilterContext(baseContext, 'cost');
    expect(result.gov_focus).toBe('cost');
  });

  it('includes workspace and project IDs when available', () => {
    const result = buildEvidenceFilterContext(baseContext, 'deny');
    expect(result.gov_entity_filter?.workspace_ids).toContain('ws_1');
    expect(result.gov_entity_filter?.project_ids).toContain('proj_1');
  });

  it('handles context without project ID', () => {
    const workspaceOnlyContext: GovernanceDrilldownContext = {
      gov_from: 'organization_overview',
      gov_kind: 'workspace',
      gov_workspace_id: 'ws_1',
    };
    const result = buildEvidenceFilterContext(workspaceOnlyContext, 'cost');
    expect(result.gov_entity_filter?.workspace_ids).toContain('ws_1');
    expect(result.gov_entity_filter?.project_ids).toBeUndefined();
  });

  it('preserves drilldown query parameters', () => {
    const result = buildEvidenceFilterContext(baseContext, 'limit');
    const queryString = new URLSearchParams(result as unknown as Record<string, string>);
    expect(queryString.get('gov_from')).toBe('organization_overview');
    expect(queryString.get('gov_kind')).toBe('project');
    expect(queryString.get('gov_focus')).toBe('limit');
  });
});
