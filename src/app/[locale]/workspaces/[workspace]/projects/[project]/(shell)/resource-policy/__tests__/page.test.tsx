import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanReadProjectPolicy, useCanUpdateProjectPolicy } from '@/lib/hooks/use-permissions';
import { useResourcePolicy } from '@/lib/hooks/use-members';

const mockSearchParams = new URLSearchParams();
const mockListEndpoints = vi.fn().mockResolvedValue({ items: [{ id: 'ep_1', project_id: 'prj_1', name: 'OpenAI Main', model: 'gpt-4o', type: 'catalog', upstream_protocol: 'openai_chat_completions', base_url: 'https://api.openai.com/v1', status: 'active', created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' }] });
const mockGetResourcePolicy = vi.fn().mockResolvedValue({ resource_type: 'endpoint', resource_id: 'ep_1', access_mode: 'allow_all_members', allowed_subjects: [], rate_limits: { rules: [{ key: 'endpoint.requests_per_day', value: 100000, window: 'day' }] } });
const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const STABLE_MEMBERS = [{ id: 'user_123', email: 'user123@example.com', name: 'User 123', role: 'developer', permissions: [], status: 'active', joined_at: '2026-02-01T00:00:00Z' }];
const STABLE_GROUPS = [{ id: 'group_001', project_id: 'prj_1', name: 'Ops Team', permission_template_id: 'developer', member_ids: [], created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' }];
const STABLE_RESOURCE_POLICY = { resource_type: 'endpoint', resource_id: 'ep_1', access_mode: 'allow_all_members', allowed_subjects: [], rate_limits: { rules: [{ key: 'endpoint.requests_per_day', value: 100000, window: 'day' }] } };

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () { return { list: mockListEndpoints }; }),
  MemberAPI: vi.fn().mockImplementation(function () { return { getResourcePolicy: mockGetResourcePolicy }; }),
  AuditAPI: vi.fn().mockImplementation(function () { return { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, has_more: false }) }; }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mockSearchParams }));
vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanReadProjectPolicy: vi.fn(() => true),
  useCanUpdateProjectPolicy: vi.fn(() => true),
}));
vi.mock('@/lib/hooks/use-members', () => ({
  useMembers: vi.fn(() => ({ data: STABLE_MEMBERS })),
  useProjectGroups: vi.fn(() => ({ data: STABLE_GROUPS })),
  useResourcePolicy: vi.fn(() => ({ data: STABLE_RESOURCE_POLICY, isLoading: false })),
  useUpdateResourcePolicy: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
}));
vi.mock('@/lib/hooks/use-governance-explainability', () => ({
  useAuthorizationCheck: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ allowed: false, decision: { source: 'resource_policy', reason: 'subject_not_allow_listed' }, matched_policy: { id: 'policy_ep_1', resource_type: 'endpoint', resource_id: 'ep_1', access_mode: 'allow_list' } }), isPending: false })),
}));

import ResourcePolicyPage from '../page';

const mockUseCanReadProjectPolicy = vi.mocked(useCanReadProjectPolicy);
const mockUseCanUpdateProjectPolicy = vi.mocked(useCanUpdateProjectPolicy);

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ResourcePolicyPage', () => {
  beforeEach(() => {
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
    mockMutateAsync.mockClear();
    mockUseCanReadProjectPolicy.mockReturnValue(true);
    mockUseCanUpdateProjectPolicy.mockReturnValue(true);
  });

  it('renders endpoint group', async () => {
    render(<ResourcePolicyPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__group--endpoint')).toBeInTheDocument();
    });
  });

  it('shows suggested default values when a rule is not configured yet', async () => {
    vi.mocked(useResourcePolicy).mockReturnValueOnce({ data: { resource_type: 'endpoint', resource_id: 'ep_1', access_mode: 'allow_all_members', allowed_subjects: [], rate_limits: { rules: [] }, spending_limits: { rules: [] } }, isLoading: false } as unknown as ReturnType<typeof useResourcePolicy>);
    render(<ResourcePolicyPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__endpoint-requests-per-day')).toBeInTheDocument();
    });
  });

  it('keeps the header focused on policy details instead of governance cross-links', async () => {
    render(<ResourcePolicyPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });
    const header = screen.getByTestId('page-layout__header');
    expect(within(header).queryByTestId('resource-policy__open-members')).not.toBeInTheDocument();
    expect(screen.getByTestId('resource-policy__summary-line')).toHaveTextContent('resource_type.endpoint');
    expect(screen.queryByTestId('resource-policy__summary-chip--access-mode')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resource-policy__summary-chip--subjects')).not.toBeInTheDocument();
  });

  it('does not fall back to a different resource when the query resource is missing', async () => {
    mockSearchParams.set('resource_type', 'endpoint');
    mockSearchParams.set('resource_id', 'missing_ep');

    render(<ResourcePolicyPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__resource-not-found')).toBeInTheDocument();
    });
    expect(screen.getByTestId('resource-policy__resource-not-found')).toHaveTextContent('resource_not_found');
    const editor = screen.getByTestId('resource-policy__editor');
    expect(within(editor).queryByText('OpenAI Main')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resource-policy__access-mode')).not.toBeInTheDocument();
  });

  it('allows users to select an existing resource after the query resource is missing', async () => {
    const user = userEvent.setup();
    mockSearchParams.set('resource_type', 'endpoint');
    mockSearchParams.set('resource_id', 'missing_ep');

    render(<ResourcePolicyPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__resource-not-found')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('resource-policy__row--endpoint--ep_1'));

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__access-mode')).toBeInTheDocument();
    });
    expect(screen.getByTestId('resource-policy__editor')).toHaveTextContent('OpenAI Main');
    expect(screen.queryByTestId('resource-policy__resource-not-found')).not.toBeInTheDocument();
  });

  it('shows permission denied without policy permission', async () => {
    mockUseCanReadProjectPolicy.mockReturnValue(false);
    mockUseCanUpdateProjectPolicy.mockReturnValue(false);
    render(<ResourcePolicyPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('project-recovery__action')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects');
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(<ResourcePolicyPage params={Promise.resolve({ workspace: '<script>', project: 'prj_1', locale: 'en-US' })} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('project-recovery__action')).toHaveAttribute('href', '/en-US/workspaces');
  });
});
