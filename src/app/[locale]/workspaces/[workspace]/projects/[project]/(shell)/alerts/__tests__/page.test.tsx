import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AlertsPage from '../page';

const mockMessages = {
  alerts: {
    title: 'Alert Center',
    subtitle: 'Manage alert rules and view notifications',
    open_audit: 'Open Audit',
    open_usage: 'Open Usage',
    rules: 'Rules',
    notifications: 'Notifications',
    create_rule: 'Create Rule',
    enabled_rules: 'Enabled Rules',
    no_rules: 'No alert rules',
    no_rules_description: 'Create your first alert rule',
    no_alerts: 'No notifications',
    no_alerts_description: 'You are all caught up',
  },
  errors: {
    permission_denied_title: 'Permission denied',
    permission_denied_hint: 'You do not have access to this page.',
    validation_error: 'Validation error',
    badRequest: {
      description: 'The request parameters were invalid.',
    },
  },
  common: {
    create: 'Create',
  },
};

function resolveTranslation(path: string): string {
  const keys = path.split('.');
  let current: unknown = mockMessages;

  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return `__MISSING_TRANSLATION__:${path}`;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : `__MISSING_TRANSLATION__:${path}`;
}

const mockUseAlertPageCapabilities = vi.fn(() => ({ canRead: true, canManage: true }));
const mockListRules = vi.fn(async () => []);
const mockListNotifications = vi.fn(async () => []);
const STABLE_RULES: never[] = [];
const STABLE_NOTIFICATIONS: never[] = [];

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) =>
    resolveTranslation(`${namespace}.${key}`),
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
      expect(screen.getByTestId('alerts__surface')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('alerts__summary-meta')).not.toBeInTheDocument();
    expect(screen.getByTestId('alert-center-page')).toBeInTheDocument();
    expect(screen.getByTestId('alert-center__summary-meta')).toBeInTheDocument();
    expect(screen.getByTestId('alerts__main-surface')).toBeInTheDocument();
    expect(screen.getByTestId('alerts__main-surface').className).not.toContain('border-subtle');
    expect(screen.getByTestId('alerts__main-surface').className).not.toContain('bg-surface/95');
    expect(screen.getByTestId('alerts__main-surface').className).not.toContain('p-4');
    expect(screen.getByTestId('alerts__main-surface').className).not.toContain('shadow-card');
    expect(screen.queryByTestId('alert-center__summary-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('alerts__open-audit')).toHaveTextContent('Open Audit');
    expect(screen.getByTestId('alerts__open-usage')).toHaveTextContent('Open Usage');
    expect(screen.getByTestId('alerts__surface')).not.toHaveTextContent('__MISSING_TRANSLATION__');
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
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
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
      expect(screen.getByTestId('alerts__surface')).toBeInTheDocument();
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
    expect(screen.getByText('Validation error')).toBeInTheDocument();
  });
});
