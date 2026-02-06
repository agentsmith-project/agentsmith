import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import OverviewPage from '../page';

const mockUseQuery = vi.fn();

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
  it('renders tokens and userdata cards even when KPI fields are missing', () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: { requests_today: 12, errors_today: 1 } };
      }
      if (queryKey[0] === 'audit') {
        return { data: { items: [] } };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    expect(screen.getByText('kpi.tokens_today')).toBeInTheDocument();
    expect(screen.getByText('kpi.userdata_storage')).toBeInTheDocument();
    expect(screen.getAllByText('--')).toHaveLength(2);
  });

  it('formats userdata bytes when present', () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return {
          data: {
            requests_today: 12,
            errors_today: 1,
            tokens_today: 800,
            userdata_bytes: 1024,
          },
        };
      }
      if (queryKey[0] === 'audit') {
        return { data: { items: [] } };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
  });

  it('renders header and toolbar layout', () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: { requests_today: 12, errors_today: 1 } };
      }
      if (queryKey[0] === 'audit') {
        return { data: { items: [] } };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(toolbar.querySelector('.flex.flex-wrap.items-center.gap-3')).toBeInTheDocument();
    expect(screen.getByTestId('overview__time-range')).toBeInTheDocument();
  });

  it('renders page state container', () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'usage') {
        return { data: { requests_today: 12, errors_today: 1 } };
      }
      if (queryKey[0] === 'audit') {
        return { data: { items: [] } };
      }
      return { data: undefined };
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__success')).toBeInTheDocument();
  });
});
