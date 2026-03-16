import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useCanReadAudit,
  useCanManageProjectAdmins,
  useCanManageProjectLifecycle,
  useHasPermission,
  useCanReadProjectSettings,
} from '@/lib/hooks/use-permissions';
import { PROJECT_BUILT_IN_GROUP_IDS } from '@/lib/governance/member-groups';

const mockPush = vi.fn();
const mockProjectUpdate = vi.fn();
const mockProjectDelete = vi.fn();
const mockUpdateProjectGroup = vi.fn();

const STABLE_PROJECT = {
  id: 'proj_1',
  workspace_id: 'ws_1',
  name: 'Project One',
  description: 'desc',
  visibility: 'private',
  join_policy: 'approval_required',
  execution_preferences_json: {},
  governance_json: {},
  admin_member_ids: ['admin_1'],
  limits_json: {},
  owner_id: 'owner_1',
  status: 'active',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};
const STABLE_MEMBERS = [
  { id: 'wm_owner', user_id: 'owner_1', name: 'Owner', email: 'owner@example.com' },
  { id: 'wm_admin', user_id: 'admin_1', name: 'Project Admin', email: 'admin@example.com' },
];
const STABLE_PROJECT_MEMBERS = [
  { id: 'owner_1', user_id: 'owner_1', name: 'Owner', email: 'owner@example.com' },
  { id: 'admin_1', user_id: 'admin_1', name: 'Project Admin', email: 'admin@example.com' },
  { id: 'member_1', user_id: 'member_1', name: 'Joined Member', email: 'member@example.com' },
];
const STABLE_PROJECT_GROUPS = [
  {
    id: PROJECT_BUILT_IN_GROUP_IDS.admins,
    name: 'Project Admins',
    permission_template_id: 'tpl_project_admin',
    built_in: true,
    system_key: 'admins',
    member_ids: ['admin_1'],
  },
];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanReadProjectSettings: vi.fn(() => true),
  useCanReadAudit: vi.fn(() => true),
  useCanManageProjectLifecycle: vi.fn(() => true),
  useCanManageProjectAdmins: vi.fn(() => true),
  useHasPermission: vi.fn((permission: string) =>
    permission === 'project:governance:update' || permission === 'project:membership:update'
  ),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: vi.fn(() => ({
    data: STABLE_PROJECT,
  })),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaceMembers: vi.fn(() => ({
    data: STABLE_MEMBERS,
  })),
}));

vi.mock('@/lib/hooks/use-members', () => ({
  useMembers: vi.fn(() => ({
    data: STABLE_PROJECT_MEMBERS,
  })),
  useProjectGroups: vi.fn(() => ({
    data: STABLE_PROJECT_GROUPS,
  })),
  useUpdateProjectGroup: vi.fn(() => ({
    mutateAsync: mockUpdateProjectGroup,
    isPending: false,
  })),
}));

const mockAuthUser = vi.fn(() => ({ id: 'owner_1' }));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: mockAuthUser() }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  ProjectAPI: vi.fn().mockImplementation(function () {
    return {
      update: mockProjectUpdate,
      delete: mockProjectDelete,
    };
  }),
}));

vi.mock('@/lib/hooks/use-api-error', () => ({
  useApiError: () => ({ handleError: vi.fn() }),
}));

vi.mock('@/components/projects/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => null,
}));




// Keep Tabs simple to reduce render complexity in route-level tests
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value, ...rest }: { children: React.ReactNode; value: string }) => (
    <button type="button" {...rest} data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import SettingsPage from '../page';

const mockUseCanReadProjectSettings = vi.mocked(useCanReadProjectSettings);
const mockUseCanReadAudit = vi.mocked(useCanReadAudit);
const mockUseCanManageProjectLifecycle = vi.mocked(useCanManageProjectLifecycle);
const mockUseCanManageProjectAdmins = vi.mocked(useCanManageProjectAdmins);
const mockUseHasPermission = vi.mocked(useHasPermission);

describe('SettingsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCanReadProjectSettings.mockReturnValue(true);
    mockUseCanReadAudit.mockReturnValue(true);
    mockUseCanManageProjectLifecycle.mockReturnValue(true);
    mockUseCanManageProjectAdmins.mockReturnValue(true);
    mockUseHasPermission.mockImplementation((permission: string) =>
      permission === 'project:governance:update' || permission === 'project:membership:update'
    );
    mockAuthUser.mockReturnValue({ id: 'owner_1' });
    mockProjectUpdate.mockResolvedValue(undefined);
    mockProjectDelete.mockResolvedValue(undefined);
    mockUpdateProjectGroup.mockResolvedValue(undefined);
  });

  it('renders settings page when params and permission are valid', async () => {
    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('settings__governance-section')).toBeInTheDocument();
      expect(screen.getByTestId('settings__ownership-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings__general-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings__project-admins-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings__project-admins-open-members')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/projects/proj_1/members?member_tab=requests',
    );
    expect(screen.getByTestId('settings__project-owner-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings__delete-project-btn')).toBeInTheDocument();
    expect(screen.getByTestId('settings__governance-link--audit')).toBeInTheDocument();
    expect(screen.getByTestId('settings__governance-link--members')).toBeInTheDocument();
    expect(screen.getByTestId('settings__governance-link--credentials')).toBeInTheDocument();
  });

  it('allows project admins with split governance permissions to access settings', async () => {
    mockUseCanReadProjectSettings.mockReturnValue(true);
    mockUseCanManageProjectLifecycle.mockReturnValue(false);
    mockUseCanManageProjectAdmins.mockReturnValue(false);
    mockAuthUser.mockReturnValue({ id: 'admin_1' });

    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('settings__governance-section')).toBeInTheDocument();
      expect(screen.getByTestId('settings__ownership-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings__general-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings__project-admins-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings__project-owner-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings__governance-link--audit')).toBeInTheDocument();
    expect(screen.getByTestId('settings__governance-link--members')).toBeInTheDocument();
    expect(screen.getByTestId('settings__governance-link--credentials')).toBeInTheDocument();
    expect(screen.getByTestId('settings__save-btn')).toBeDisabled();
    expect(screen.queryByTestId('settings__project-admins-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings__project-owner-save')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings__delete-project-btn')).toBeDisabled();
  });

  it('allows governance managers to read settings in read-only mode', async () => {
    mockUseCanReadProjectSettings.mockReturnValue(true);
    mockUseCanReadAudit.mockReturnValue(false);
    mockUseCanManageProjectLifecycle.mockReturnValue(false);
    mockUseCanManageProjectAdmins.mockReturnValue(false);
    mockUseHasPermission.mockReturnValue(false);
    mockAuthUser.mockReturnValue({ id: 'governance_1' });

    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('settings__governance-section')).toBeInTheDocument();
      expect(screen.getByTestId('settings__ownership-section')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('settings__governance-link--audit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings__governance-link--members')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings__governance-link--credentials')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings__save-btn')).toBeDisabled();
    expect(screen.queryByTestId('settings__project-admins-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings__project-owner-save')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings__delete-project-btn')).toBeDisabled();
  });

  it('lets project owners transfer ownership', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('settings__project-owner-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('settings__project-owner-select'), 'admin_1');
    await user.click(screen.getByTestId('settings__project-owner-save'));

    await waitFor(() => {
      expect(mockProjectUpdate).toHaveBeenCalledWith('ws_1', 'proj_1', { owner_id: 'admin_1' });
    });
  });

  it('includes joined project members in project admin options', async () => {
    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('settings__project-admins-section')).toBeInTheDocument();
    });

    expect(screen.getByTestId('settings__project-admin-option--member_1')).toBeInTheDocument();
    expect(screen.getByText('Joined Member')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks settings manage permission', async () => {
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanManageProjectLifecycle.mockReturnValue(false);
    mockUseCanManageProjectAdmins.mockReturnValue(false);
    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    mockUseCanReadProjectSettings.mockReturnValue(true);
    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks settings read permission', async () => {
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanManageProjectLifecycle.mockReturnValue(false);
    mockUseCanManageProjectAdmins.mockReturnValue(false);
    render(
      <SettingsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
