import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

import OverviewPage from '../page';

const mockUseQuery = vi.fn();
const mockUseParams = vi.fn(() => ({
  workspace: 'ws_default',
  project: 'proj_001',
  locale: 'en',
}));
const STABLE_AUDIT_DATA = { items: [] };
const STABLE_USAGE_BASE_DATA = { requests_today: 12, errors_today: 1 };
const STABLE_USAGE_WITH_STORAGE_DATA = {
  requests_today: 12,
  errors_today: 1,
  tokens_today: 800,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    pathname: '/',
    query: {},
  }),
  useSearchParams: () => ({
    get: vi.fn(),
  }),
  useParams: () => mockUseParams(),
  usePathname: () => '/',
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: { queryKey: unknown[] }) => mockUseQuery(options),
  };
});

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
  useCurrentPermissions: vi.fn(() => [
    'project:chat:access',
    'project:notebook:access',
    'project:agent:use',
    'project:endpoint:use',
    'project:member:view',
    'project:usage:view',
    'project:settings:manage',
  ]),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  UsageAPI: class {
    constructor() {}
  },
  AuditAPI: class {
    constructor() {}
  },
}));

describe('OverviewPage', () => {
  const mockUseHasPermission = vi.mocked(useHasPermission);

  function setupQueryMocks() {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: STABLE_USAGE_BASE_DATA };
      }
      if (queryKey[0] === 'audit') {
        return { data: STABLE_AUDIT_DATA };
      }
      return { data: undefined };
    });
  }

  it('renders tokens card even when optional KPI fields are missing', () => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: STABLE_USAGE_BASE_DATA };
      }
      if (queryKey[0] === 'audit') {
        return { data: STABLE_AUDIT_DATA };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    expect(screen.getByText('kpi.tokens_today')).toBeInTheDocument();
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('formats tokens when present', () => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: STABLE_USAGE_WITH_STORAGE_DATA };
      }
      if (queryKey[0] === 'audit') {
        return { data: STABLE_AUDIT_DATA };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    expect(screen.getByText('800')).toBeInTheDocument();
  });

  it('renders header and toolbar layout', () => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: STABLE_USAGE_BASE_DATA };
      }
      if (queryKey[0] === 'audit') {
        return { data: STABLE_AUDIT_DATA };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(within(toolbar).getByTestId('overview__time-range')).toBeInTheDocument();
  });

  it('renders page state container', () => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: STABLE_USAGE_BASE_DATA };
      }
      if (queryKey[0] === 'audit') {
        return { data: STABLE_AUDIT_DATA };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__success')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', () => {
    mockUseHasPermission.mockReturnValue(true);
    setupQueryMocks();
    mockUseParams.mockReturnValue({
      workspace: '<script>',
      project: 'proj_001',
      locale: 'en',
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project read permission', () => {
    mockUseHasPermission.mockReturnValue(false);
    setupQueryMocks();
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en',
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
