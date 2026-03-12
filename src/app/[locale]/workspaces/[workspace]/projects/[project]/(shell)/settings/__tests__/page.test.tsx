import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

const mockPush = vi.fn();

const STABLE_PROJECT = {
  id: 'proj_1',
  workspace_id: 'ws_1',
  name: 'Project One',
  description: 'desc',
  visibility: 'private',
  join_policy: 'approval_required',
  execution_preferences_json: {},
  governance_json: {},
  limits_json: {},
  owner_id: 'owner_1',
  status: 'active',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn((permission: string) => permission === 'project:manage'),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: vi.fn(() => ({
    data: STABLE_PROJECT,
  })),
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
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
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

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('SettingsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:manage');
  });

  it('renders settings page when params and permission are valid', async () => {
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:manage');
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
      expect(screen.getByTestId('settings__general-section')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('settings__tab--governance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings__tab--limits')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings__delete-project-btn')).toBeInTheDocument();
  });

  it('allows project admins with project manage permission to access settings', async () => {
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:manage');

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
      expect(screen.getByTestId('settings__general-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings__delete-project-btn')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks settings manage permission', async () => {
    mockUseHasPermission.mockReturnValue(false);
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
    mockUseHasPermission.mockReturnValue(true);
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
    mockUseHasPermission.mockReturnValue(false);
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
