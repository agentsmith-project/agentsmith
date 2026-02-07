import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useCanReadProjectPolicy,
  useCanUpdateProjectPolicy,
  useHasPermission,
} from '@/lib/hooks/use-permissions';

const mockPush = vi.fn();

const STABLE_PROJECT = {
  id: 'proj_1',
  workspace_id: 'ws_1',
  name: 'Project One',
  description: 'desc',
  visibility: 'private',
  join_policy: 'approval_required',
  runtime_preferences_json: {},
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
  useCanReadProjectPolicy: vi.fn(() => true),
  useCanUpdateProjectPolicy: vi.fn(() => true),
  useHasPermission: vi.fn((permission: string) => permission === 'project:policy:update'),
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

vi.mock('@/components/settings/RuntimePreferencesEditor', () => ({
  RuntimePreferencesEditor: () => <div data-testid="settings__runtime-editor" />,
}));

vi.mock('@/components/settings/SettingsTokenReference', () => ({
  SettingsTokenReference: () => <div data-testid="settings__token-ref" />,
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
const mockUseCanReadProjectPolicy = vi.mocked(useCanReadProjectPolicy);
const mockUseCanUpdateProjectPolicy = vi.mocked(useCanUpdateProjectPolicy);

describe('SettingsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCanReadProjectPolicy.mockReturnValue(true);
    mockUseCanUpdateProjectPolicy.mockReturnValue(true);
  });

  it('renders settings page when params and permission are valid', async () => {
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:policy:update');
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
      expect(screen.getByTestId('settings__tab--general')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings__tab--runtime')).toBeInTheDocument();
    expect(screen.queryByTestId('settings__tab--governance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings__tab--limits')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings__delete-project-btn')).toBeInTheDocument();
  });

  it('disables delete project when user lacks project:delete permission', async () => {
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:policy:update');
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
      expect(screen.getByTestId('settings__delete-project-btn')).toBeInTheDocument();
    });

    expect(screen.getByTestId('settings__delete-project-btn')).toBeDisabled();
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
    mockUseCanReadProjectPolicy.mockReturnValue(false);
    mockUseCanUpdateProjectPolicy.mockReturnValue(false);
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
