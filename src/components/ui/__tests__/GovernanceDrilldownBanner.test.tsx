import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) =>
    params?.value ? `${key}:${params.value}` : key,
}));

describe('GovernanceDrilldownBanner', () => {
  it('renders evidence metrics when evidence context exists', () => {
    render(
      <GovernanceDrilldownBanner
        locale="en-US"
        context={{
          gov_from: 'organization_overview',
          gov_kind: 'project',
          gov_workspace_id: 'ws_1',
          gov_project_id: 'proj_1',
          gov_action_id: 'action:ws_1:project:proj_1',
          gov_reason: 'public_visibility',
          gov_related_signals: 3,
          gov_blocked_signals: 1,
          gov_warning_signals: 2,
          gov_workspace_risk_score: 120,
          gov_member_id: 'wm_1',
        }}
      />,
    );

    expect(screen.getByTestId('governance-drilldown__banner')).toBeInTheDocument();
    expect(screen.getByTestId('governance-drilldown__evidence')).toBeInTheDocument();
    expect(
      screen.getByTestId('governance-drilldown__metric--governance-drilldown-metric-related-signals'),
    ).toHaveTextContent('3');
    expect(screen.getByText('governance_drilldown_action_id:action:ws_1:project:proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('governance-drilldown__open-policy')).toHaveAttribute(
      'href',
      expect.stringContaining('gov_from=organization_overview'),
    );
    expect(screen.getByTestId('governance-drilldown__open-audit')).toBeInTheDocument();
    expect(screen.getByTestId('governance-drilldown__open-release-ops')).toBeInTheDocument();
    expect(screen.getByTestId('governance-drilldown__open-members')).toHaveAttribute(
      'href',
      expect.stringContaining('member_id=wm_1'),
    );
    expect(screen.getByTestId('governance-drilldown__focus')).toBeInTheDocument();
  });

  it('hides policy quick-link when project is absent', () => {
    render(
      <GovernanceDrilldownBanner
        locale="en-US"
        context={{
          gov_from: 'organization_overview',
          gov_kind: 'workspace',
          gov_workspace_id: 'ws_1',
        }}
      />,
    );

    expect(screen.queryByTestId('governance-drilldown__evidence')).not.toBeInTheDocument();
    expect(screen.queryByTestId('governance-drilldown__open-policy')).not.toBeInTheDocument();
  });
});
