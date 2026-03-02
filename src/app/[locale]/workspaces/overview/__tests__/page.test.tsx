import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrganizationActionsStore } from '@/lib/stores/organization-actions-store';

const mockUseWorkspaces = vi.fn();
const mockUseOrganizationGovernanceRollup = vi.fn();
const mockRefetchWorkspaces = vi.fn();
const mockRefetchRollup = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

vi.mock('@/lib/hooks/use-organization-governance-rollup', () => ({
  useOrganizationGovernanceRollup: () => mockUseOrganizationGovernanceRollup(),
}));

import WorkspacesOverviewPage from '../page';

describe('WorkspacesOverviewPage', () => {
  beforeEach(() => {
    useOrganizationActionsStore.getState()._resetForTests?.();
    mockRefetchWorkspaces.mockClear();
    mockRefetchRollup.mockClear();
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      refetch: mockRefetchWorkspaces,
    });
    mockUseOrganizationGovernanceRollup.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: mockRefetchRollup,
      rollup: {
        summary: {
          readiness: 'warning',
          totalWorkspaces: 1,
          blockedWorkspaces: 0,
          warningWorkspaces: 1,
          riskyWorkspaces: 1,
          totalRiskyProjects: 2,
        },
        workspaceRanking: [
          {
            workspaceId: 'ws_1',
            workspaceName: 'Workspace One',
            readiness: 'warning',
            riskScore: 20,
            blockedItems: 0,
            warningItems: 2,
            riskyProjects: 2,
            totalProjects: 3,
            topRiskProjectId: 'proj_1',
          },
        ],
        attention: [
          {
            id: 'ws_1:project:proj_1',
            workspaceId: 'ws_1',
            workspaceName: 'Workspace One',
            severity: 'warning',
            kind: 'project',
            title: 'Project One',
            description: 'public_visibility',
            projectId: 'proj_1',
          },
        ],
        actionsQueue: [
          {
            id: 'action:ws_1:project:proj_1',
            workspaceId: 'ws_1',
            workspaceName: 'Workspace One',
            projectId: 'proj_1',
            severity: 'warning',
            actionType: 'investigate_project_risk',
            title: 'Project One',
            description: 'public_visibility',
          },
        ],
      },
    });
  });

  it('renders matrix and attention views', () => {
    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId('workspace-overview__heading')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__matrix')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__search')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__readiness-filter')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__row--ws_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__attention')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__attention-item--ws_1--project--proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__actions-queue')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__actions-queue-item--action--ws_1--project--proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__action-explain-panel')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__attention-open-audit--ws_1--project--proj_1')).toHaveAttribute(
      'href',
      expect.stringContaining('gov_from=organization_overview'),
    );
  });

  it('filters matrix rows by readiness', () => {
    render(<WorkspacesOverviewPage />);
    fireEvent.change(screen.getByTestId('workspace-overview__readiness-filter'), { target: { value: 'blocked' } });

    expect(screen.queryByTestId('workspace-overview__row--ws_1')).not.toBeInTheDocument();
    expect(screen.getByText('org_overview_matrix_empty_filtered')).toBeInTheDocument();
  });

  it('updates action status and shows audit history', () => {
    render(<WorkspacesOverviewPage />);
    fireEvent.click(screen.getByTestId('workspace-overview__actions-queue-mark-in-progress--action--ws_1--project--proj_1'));

    expect(screen.getByText('org_overview_action_status_in_progress')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__actions-queue-history--action--ws_1--project--proj_1')).toBeInTheDocument();
  });

  it('opens explain panel from an action item', () => {
    render(<WorkspacesOverviewPage />);
    fireEvent.click(screen.getByTestId('workspace-overview__actions-queue-open-explain--action--ws_1--project--proj_1'));

    expect(screen.getByTestId('workspace-overview__action-explain-open-audit')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__action-explain-open-policy')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseOrganizationGovernanceRollup.mockReturnValue({
      isLoading: true,
      isError: false,
      refetch: mockRefetchRollup,
      rollup: null,
    });

    render(<WorkspacesOverviewPage />);
    expect(screen.getByTestId('workspace-overview__loading')).toBeInTheDocument();
  });

  it('shows retry state and triggers both refetch handlers', () => {
    mockUseOrganizationGovernanceRollup.mockReturnValue({
      isLoading: false,
      isError: true,
      refetch: mockRefetchRollup,
      rollup: null,
    });

    render(<WorkspacesOverviewPage />);
    expect(screen.getByTestId('workspace-overview__error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-overview__retry'));
    expect(mockRefetchWorkspaces).toHaveBeenCalledTimes(1);
    expect(mockRefetchRollup).toHaveBeenCalledTimes(1);
  });
});
