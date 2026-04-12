import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import enUsMessages from '@/messages/en-US.json';
import zhCnMessages from '@/messages/zh-CN.json';

const mockUseHasWorkspacePermission = vi.fn(() => true);
const mockContextManager = vi.fn<(props: unknown) => unknown>(() => <div data-testid="context-manager" />);
type MockProjectMembershipResult = {
  data:
    | {
        id: string;
        workspace_id: string;
        name: string;
        visibility: string;
        owner_id: string;
        status: string;
        created_at: string;
        updated_at: string;
        permissions: string[];
        membership_status: string;
      }
    | undefined;
  isLoading: boolean;
  error: null;
};

function createMockProject(membershipStatus = 'active', permissions = ['project:endpoint:use']) {
  return {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Project One',
    visibility: 'private',
    owner_id: 'user_1',
    status: 'active',
    created_at: '2026-04-10T00:00:00.000Z',
    updated_at: '2026-04-10T00:00:00.000Z',
    permissions,
    membership_status: membershipStatus,
  };
}

const mockUseProject = vi.fn<() => MockProjectMembershipResult>(() => ({
  data: createMockProject(),
  isLoading: false,
  error: null,
}));
const mockResolvedRoute = vi.fn(() => ({
  workspace: 'ws_1',
  project: 'proj_1',
  locale: 'en-US',
  isReady: true,
  isValid: true,
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: () => mockUseHasWorkspacePermission(),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: () => mockUseProject(),
}));

vi.mock('@/lib/hooks/use-resolved-project-route', () => ({
  useResolvedProjectRoute: () => mockResolvedRoute(),
}));

vi.mock('@/components/context/ContextManager', () => ({
  ContextManager: (props: unknown) => {
    mockContextManager(props);
    return <div data-testid="context-manager" />;
  },
}));

import ProjectPersonalContextPage from '../page';

describe('ProjectPersonalContextPage', () => {
  it('ships project-member forbidden copy in both supported locales', () => {
    expect(enUsMessages.context_store.member_project_forbidden_description).toBeTruthy();
    expect(zhCnMessages.context_store.member_project_forbidden_description).toBeTruthy();
  });

  it('renders project entry for workspace personal context', () => {
    render(
      <ProjectPersonalContextPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en-US' })}
      />,
    );

    expect(screen.getByText('member_project_title')).toBeInTheDocument();
    expect(screen.getByText('member_project_subtitle')).toBeInTheDocument();
    expect(screen.getByText('member_project_scope_note')).toBeInTheDocument();
    expect(screen.getByTestId('context-manager')).toBeInTheDocument();
    expect(mockContextManager).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project_member',
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        surface: 'project',
      }),
    );
  });

  it('shows permission denied when workspace access is unavailable', () => {
    mockUseHasWorkspacePermission.mockReturnValueOnce(false);

    render(
      <ProjectPersonalContextPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en-US' })}
      />,
    );

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows loading while project membership is still resolving', () => {
    mockUseProject.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(
      <ProjectPersonalContextPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en-US' })}
      />,
    );

    expect(screen.getByTestId('page-state__loading')).toBeInTheDocument();
  });

  it('shows a project-member specific error when the current user is not an active project member', () => {
    mockUseProject.mockReturnValueOnce({
      data: {
        ...createMockProject('none', []),
      },
      isLoading: false,
      error: null,
    });

    render(
      <ProjectPersonalContextPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en-US' })}
      />,
    );

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    expect(screen.getByText('member_project_forbidden_description')).toBeInTheDocument();
  });

  it('shows validation error for invalid parameters', () => {
    mockResolvedRoute.mockReturnValueOnce({
      workspace: '',
      project: '',
      locale: 'en-US',
      isReady: true,
      isValid: false,
    });

    render(
      <ProjectPersonalContextPage
        params={Promise.resolve({ workspace: 'bad ws', project: 'bad proj', locale: 'en-US' })}
      />,
    );

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
