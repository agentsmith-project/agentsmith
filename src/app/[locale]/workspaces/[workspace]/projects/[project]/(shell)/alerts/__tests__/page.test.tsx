import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AlertsPage from '../page';

const mockUseAlertPageCapabilities = vi.fn(() => ({ canRead: true, canManage: true }));
const mockListRules = vi.fn(async () => []);
const mockListNotifications = vi.fn(async () => []);
const STABLE_RULES: never[] = [];
const STABLE_NOTIFICATIONS: never[] = [];

vi.mock('@/components/alerts/AlertCenterPage', () => ({
  AlertCenterPage: () => <div data-testid="alerts__center" />,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useAlertPageCapabilities: () => mockUseAlertPageCapabilities(),
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
    useQuery: vi.fn((options?: { queryKey?: unknown[] }) => {
      const key = options?.queryKey?.[0];
      if (key === 'alert-rules') {
        return { data: STABLE_RULES, isLoading: false, error: null };
      }
      if (key === 'alert-notifications') {
        return { data: STABLE_NOTIFICATIONS, isLoading: false, error: null };
      }
      return { data: STABLE_RULES, isLoading: false, error: null };
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

describe('AlertsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAlertPageCapabilities.mockReturnValue({ canRead: true, canManage: true });
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
    expect(screen.getByTestId('alerts__open-audit')).toBeInTheDocument();
    expect(screen.getByTestId('alerts__open-usage')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks alert view permission', async () => {
    mockUseAlertPageCapabilities.mockReturnValue({ canRead: false, canManage: false });
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

  it('allows audit readers to access alerts without governance update', async () => {
    mockUseAlertPageCapabilities.mockReturnValue({ canRead: true, canManage: false });
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
