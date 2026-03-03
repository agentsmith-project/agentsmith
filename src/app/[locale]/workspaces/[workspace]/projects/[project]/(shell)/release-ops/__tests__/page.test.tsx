import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ReleaseOpsPage from '../page';

let permissionFn: (permission?: string) => boolean = () => true;
const mockSearchParams = new URLSearchParams();

const queryResult = {
  data: undefined,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
};

const mutationResult = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => '/en/workspaces/ws_1/projects/proj_1/release-ops',
    useSearchParams: () => mockSearchParams,
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission?: string) => permissionFn(permission),
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useRuntimeObservability: () => queryResult,
  useUsageOperationsSummary: () => queryResult,
  useUsageReportEvidence: () => ({ ...queryResult, data: { blockers: [], warnings: [] } }),
  useUsageReportSchedules: () => ({ ...queryResult, data: { items: [] } }),
}));

vi.mock('@/lib/hooks/use-release-ops', () => ({
  useReleaseReportList: () => ({ ...queryResult, data: { items: [] } }),
  useReleaseReportDetail: () => queryResult,
  useReleaseEscalationList: () => ({ ...queryResult, data: { items: [] } }),
  useReleaseEscalationDetail: () => queryResult,
  useReleaseGateRunList: () => ({ ...queryResult, data: { items: [] } }),
  useReleaseGateRunDetail: () => queryResult,
  useReleaseGateRunnerStatus: () => queryResult,
  useReleasePolicyOverrides: () => ({ ...queryResult, data: { items: [] } }),
  useAcknowledgeReleaseEscalation: () => mutationResult,
  useAssignReleaseEscalation: () => mutationResult,
  useResolveReleaseEscalation: () => mutationResult,
  useTriggerReleaseGateRun: () => mutationResult,
  useCreateReleasePolicyOverride: () => mutationResult,
  useDecideReleasePolicyOverride: () => mutationResult,
}));

vi.mock('@/components/runtime/ReleaseOpsDashboard', () => ({
  ReleaseOpsDashboard: () => <div data-testid="release-ops__dashboard" />,
}));

vi.mock('@/components/audit-usage/UsageOperationsSummary', () => ({
  UsageOperationsSummary: () => <div data-testid="release-ops__usage-summary" />,
}));

vi.mock('@/components/ui/GovernanceDrilldownBanner', () => ({
  GovernanceDrilldownBanner: () => null,
}));

describe('ReleaseOpsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionFn = () => true;
    mockSearchParams.forEach((_value, key) => mockSearchParams.delete(key));
  });

  it('renders release ops page for valid params and permission', async () => {
    render(
      <ReleaseOpsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('release-ops__dashboard')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks usage permission', async () => {
    permissionFn = () => false;
    render(
      <ReleaseOpsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(
      <ReleaseOpsPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
