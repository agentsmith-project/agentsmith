import { describe, expect, it } from 'vitest';
import { buildGovernanceDrilldownQuery, parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';

describe('governance-drilldown-context', () => {
  it('builds and parses governance drilldown query context', () => {
    const query = buildGovernanceDrilldownQuery({
      gov_from: 'organization_overview',
      gov_kind: 'member',
      gov_workspace_id: 'ws_1',
      gov_project_id: 'proj_1',
      gov_member_id: 'wm_1',
      gov_action_id: 'action:ws_1:member:wm_1',
      gov_reason: 'public_scope',
      gov_related_signals: 5,
      gov_blocked_signals: 2,
      gov_warning_signals: 3,
      gov_project_signals: 4,
      gov_member_signals: 1,
      gov_workspace_risk_score: 320,
      gov_workspace_blocked_items: 2,
      gov_workspace_warning_items: 6,
      gov_workspace_risky_projects: 7,
    });

    const parsed = parseGovernanceDrilldownContext(new URLSearchParams(query));

    expect(parsed).toEqual({
      gov_from: 'organization_overview',
      gov_kind: 'member',
      gov_workspace_id: 'ws_1',
      gov_project_id: 'proj_1',
      gov_member_id: 'wm_1',
      gov_action_id: 'action:ws_1:member:wm_1',
      gov_reason: 'public_scope',
      gov_related_signals: 5,
      gov_blocked_signals: 2,
      gov_warning_signals: 3,
      gov_project_signals: 4,
      gov_member_signals: 1,
      gov_workspace_risk_score: 320,
      gov_workspace_blocked_items: 2,
      gov_workspace_warning_items: 6,
      gov_workspace_risky_projects: 7,
    });
  });

  it('returns null for invalid context', () => {
    const parsed = parseGovernanceDrilldownContext(new URLSearchParams('gov_from=unknown'));
    expect(parsed).toBeNull();
  });

  it('drops invalid numeric evidence values', () => {
    const parsed = parseGovernanceDrilldownContext(
      new URLSearchParams(
        'gov_from=organization_overview&gov_kind=project&gov_workspace_id=ws_1&gov_related_signals=foo&gov_blocked_signals=-1',
      ),
    );
    expect(parsed).toMatchObject({
      gov_from: 'organization_overview',
      gov_kind: 'project',
      gov_workspace_id: 'ws_1',
      gov_related_signals: undefined,
      gov_blocked_signals: undefined,
    });
  });
});
