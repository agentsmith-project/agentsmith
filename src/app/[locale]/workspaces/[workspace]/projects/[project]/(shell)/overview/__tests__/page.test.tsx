import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import OverviewPage from '../page';

const mockUseParams = vi.fn(() => ({
  workspace: 'ws_default',
  project: 'proj_001',
  locale: 'en-US',
}));

const mockUseUsageKPI = vi.fn();
const mockUseAuditEvents = vi.fn();
const mockUseRuntimeObservability = vi.fn();
const mockUseUsageOperationsSummary = vi.fn();
const mockUseUsageReportEvidence = vi.fn();
const mockUseReleaseReportList = vi.fn();
const mockUseReleaseGateRunList = vi.fn();
const mockUseReleaseEscalationList = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

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
    'project:usage:view',
  ]),
}));

vi.mock('@/lib/hooks/use-audit-usage', () => ({
  useUsageKPI: (...args: unknown[]) => mockUseUsageKPI(...args),
  useAuditEvents: (...args: unknown[]) => mockUseAuditEvents(...args),
  useRuntimeObservability: (...args: unknown[]) => mockUseRuntimeObservability(...args),
  useUsageOperationsSummary: (...args: unknown[]) => mockUseUsageOperationsSummary(...args),
  useUsageReportEvidence: (...args: unknown[]) => mockUseUsageReportEvidence(...args),
}));

vi.mock('@/lib/hooks/use-release-ops', () => ({
  useReleaseReportList: (...args: unknown[]) => mockUseReleaseReportList(...args),
  useReleaseGateRunList: (...args: unknown[]) => mockUseReleaseGateRunList(...args),
  useReleaseEscalationList: (...args: unknown[]) => mockUseReleaseEscalationList(...args),
}));

describe('OverviewPage', () => {
  const mockUseHasPermission = vi.mocked(useHasPermission);

  beforeEach(() => {
    mockUseHasPermission.mockReturnValue(true);
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en-US',
    });
    mockUseUsageKPI.mockReturnValue({
      data: { requests_today: 24, errors_today: 2, tokens_today: 1024 },
    });
    mockUseAuditEvents.mockReturnValue({
      data: { items: [] },
    });
    mockUseRuntimeObservability.mockReturnValue({
      data: {
        total_requests: 120,
        error_rate: 0.02,
        avg_estimated_cost: 0.00021,
        p95_estimated_cost: 0.0008,
        degradation_signals: [],
        health_summary: {
          recovered_requests: 3,
          terminal_error_requests: 0,
          missing_price_facts: 0,
          provider_count: 2,
          model_count: 3,
        },
      },
    });
    mockUseUsageOperationsSummary.mockReturnValue({
      data: {
        anomaly_peaks: [],
        top_models: [
          { provider: 'secondaryok', model: 'model-b', estimated_cost: 0.0009 },
        ],
      },
    });
    mockUseUsageReportEvidence.mockReturnValue({
      data: {
        release_readiness: 'ready',
      },
    });
    mockUseReleaseReportList.mockReturnValue({
      data: {
        items: [{
          name: 'report-1',
          generated_at: '2026-03-01T00:00:00.000Z',
          policy_enforcement: {
            decision: 'ready',
            blocker_count: 0,
            warning_count: 0,
            approved_override_count: 0,
          },
        }],
      },
    });
    mockUseReleaseGateRunList.mockReturnValue({
      data: {
        items: [{
          id: 'run-1',
          started_at: '2026-03-01T00:00:00.000Z',
          status: 'pass',
        }],
      },
    });
    mockUseReleaseEscalationList.mockReturnValue({
      data: {
        items: [],
      },
    });
  });

  it('renders ai ops home sections', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId('overview__ai-ops-home')).toBeInTheDocument();
    expect(screen.getByTestId('overview__status-strip')).toBeInTheDocument();
    expect(screen.getByTestId('overview__attention')).toBeInTheDocument();
    expect(screen.getByTestId('overview__primary-actions')).toBeInTheDocument();
    expect(screen.getByTestId('overview__snapshot-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('overview__snapshot-release')).toBeInTheDocument();
    expect(screen.getByTestId('overview__quick-actions')).toBeInTheDocument();
    expect(screen.getByTestId('overview__snapshot-runtime-link')).toHaveAttribute('href', expect.stringContaining('/runtime-observability?'));
    expect(screen.getByTestId('overview__snapshot-cost-link')).toHaveAttribute('href', expect.stringContaining('/usage?'));
    expect(screen.getByTestId('overview__snapshot-release-link')).toHaveAttribute('href', expect.stringContaining('/release-ops?'));
    expect(screen.getByTestId('overview__primary-action-link-0')).toHaveAttribute('href', expect.stringContaining('/release-ops?'));
    expect(screen.getByTestId('overview__primary-action-link-1')).toHaveAttribute('href', expect.stringContaining('/runtime-observability?'));
    expect(screen.getByTestId('overview__primary-action-link-2')).toHaveAttribute('href', expect.stringContaining('/usage?'));
    expect(screen.getByTestId('overview__primary-action-link-3')).toHaveAttribute('href', expect.stringContaining('/release-ops?'));
  });

  it('renders header and toolbar layout', () => {
    render(<OverviewPage />);

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(within(header).getByTestId('overview__open-runtime')).toHaveAttribute('href', expect.stringContaining('/runtime-observability?'));
    expect(within(header).getByTestId('overview__open-usage')).toHaveAttribute('href', expect.stringContaining('/usage?'));
    expect(within(header).getByTestId('overview__open-release-ops')).toHaveAttribute('href', expect.stringContaining('/release-ops?'));
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(within(toolbar).getByTestId('overview__time-range')).toBeInTheDocument();
  });

  it('shows urgent attention items when release is blocked', () => {
    mockUseReleaseReportList.mockReturnValue({
      data: {
        items: [{
          name: 'report-2',
          generated_at: '2026-03-01T00:00:00.000Z',
          policy_enforcement: {
            decision: 'blocked',
            blocker_count: 2,
            warning_count: 0,
            approved_override_count: 0,
          },
        }],
      },
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('overview__attention-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('overview__attention-link-0')).toHaveAttribute('href', expect.stringContaining('/release-ops?'));
  });

  it('renders page state container', () => {
    render(<OverviewPage />);
    expect(screen.getByTestId('page-state__success')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', () => {
    mockUseParams.mockReturnValue({
      workspace: '<script>',
      project: 'proj_001',
      locale: 'en-US',
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project read permission', () => {
    mockUseHasPermission.mockReturnValue(false);

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
