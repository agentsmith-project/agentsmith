import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AlertsPage from '../page';

const mockHasPermission = vi.fn((_permission?: string) => true);
const mockListRules = vi.fn(async () => []);
const mockListNotifications = vi.fn(async () => []);

vi.mock('@/components/alerts/AlertCenterPage', () => ({
  AlertCenterPage: () => <div data-testid="alerts__center" />,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockHasPermission(permission),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AlertAPI: vi.fn().mockImplementation(function () {
    return {
      listRules: mockListRules,
      listNotifications: mockListNotifications,
      createRule: vi.fn(),
      updateRule: vi.fn(),
      deleteRule: vi.fn(),
      testRule: vi.fn(async () => ({ details: 'ok' })),
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn() },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

describe('AlertsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it('renders alert center when params and permission are valid', async () => {
    render(
      <AlertsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('alerts__center')).toBeInTheDocument();
    });
    expect(screen.getByTestId('alerts__open-release-ops')).toBeInTheDocument();
    expect(screen.getByTestId('alerts__open-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('alerts__open-usage')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks alert view permission', async () => {
    mockHasPermission.mockReturnValue(false);
    render(
      <AlertsPage
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
    render(
      <AlertsPage
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
});
