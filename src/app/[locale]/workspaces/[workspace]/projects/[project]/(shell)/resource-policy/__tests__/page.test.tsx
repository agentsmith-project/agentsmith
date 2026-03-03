import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { useHasPermission } from '@/lib/hooks/use-permissions';

const mockSearchParams = new URLSearchParams();

const mockListEndpoints = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'ep_1',
      project_id: 'prj_1',
      name: 'OpenAI Main',
      openai_model: 'gpt-4o',
      type: 'openai',
      base_url: 'https://api.openai.com/v1',
      status: 'active',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
});

const mockGetResourcePolicy = vi.fn().mockResolvedValue({
  resource_type: 'endpoint',
  resource_id: 'ep_1',
  access_mode: 'allow_all_members',
  allowed_subjects: [],
  quota_limits: {
    rules: [{ key: 'endpoint.daily_token_limit', value: 100000, window: 'day' }],
  },
});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return { list: mockListEndpoints };
  }),
  MemberAPI: vi.fn().mockImplementation(function () {
    return { getResourcePolicy: mockGetResourcePolicy };
  }),
  AuditAPI: vi.fn().mockImplementation(function () {
    return { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, has_more: false }) };
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const STABLE_MEMBERS = [
  {
    id: 'user_123',
    email: 'user123@example.com',
    name: 'User 123',
    role: 'developer',
    permissions: [],
    status: 'active',
    joined_at: '2026-02-01T00:00:00Z',
  },
];
const STABLE_GROUPS = [
  {
    id: 'group_001',
    project_id: 'prj_1',
    name: 'Ops Team',
    permission_template_id: 'developer',
    member_ids: [],
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
];
const STABLE_RESOURCE_POLICY = {
  resource_type: 'endpoint',
  resource_id: 'ep_1',
  access_mode: 'allow_all_members',
  allowed_subjects: [],
  quota_limits: { rules: [{ key: 'endpoint.daily_token_limit', value: 100000, window: 'day' }] },
};
vi.mock('@/lib/hooks/use-members', () => ({
  useMembers: vi.fn(() => ({
    data: STABLE_MEMBERS,
  })),
  useProjectGroups: vi.fn(() => ({
    data: STABLE_GROUPS,
  })),
  useResourcePolicy: vi.fn(() => ({
    data: STABLE_RESOURCE_POLICY,
    isLoading: false,
  })),
  useUpdateResourcePolicy: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/lib/hooks/use-governance-explainability', () => ({
  useAuthorizationCheck: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({
      allowed: false,
      decision: { source: 'resource_policy', reason: 'subject_not_allow_listed' },
      matched_policy: {
        id: 'policy_ep_1',
        resource_type: 'endpoint',
        resource_id: 'ep_1',
        access_mode: 'allow_list',
      },
    }),
    isPending: false,
  })),
}));

import ResourcePolicyPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ResourcePolicyPage', () => {
  beforeEach(() => {
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
    mockMutateAsync.mockClear();
    mockUseHasPermission.mockReturnValue(true);
  });

  it('renders endpoint group', async () => {
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__group--endpoint')).toBeInTheDocument();
    });
  });

  it('saves endpoint policy changes', async () => {
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__endpoint-daily-token-limit')).toBeInTheDocument();
    });

    const input = screen.getByTestId('resource-policy__endpoint-daily-token-limit');
    await user.clear(input);
    await user.type(input, '250000');
    await user.click(screen.getByTestId('resource-policy__save'));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        quota_limits: {
          rules: [{ key: 'endpoint.daily_token_limit', value: 250000, window: 'day' }],
        },
      }),
    );
  });

  it('renders governance header actions', async () => {
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByTestId('resource-policy__open-members')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects/prj_1/members');
    expect(within(header).getByTestId('resource-policy__open-credentials')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects/prj_1/credentials');
    expect(within(header).getByTestId('resource-policy__open-audit')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects/prj_1/audit');
  });

  it('shows permission denied without policy permission', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', async () => {
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: '<script>', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
