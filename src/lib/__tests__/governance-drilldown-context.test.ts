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
    });
  });

  it('returns null for invalid context', () => {
    const parsed = parseGovernanceDrilldownContext(new URLSearchParams('gov_from=unknown'));
    expect(parsed).toBeNull();
  });
});
