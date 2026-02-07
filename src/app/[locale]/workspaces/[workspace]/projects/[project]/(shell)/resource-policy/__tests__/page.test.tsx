import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { useHasPermission } from '@/lib/hooks/use-permissions';

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

const mockListLibraries = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'lib_1',
      workspace_id: 'ws_1',
      project_id: 'prj_1',
      name: 'Shared Docs',
      visibility: 'shared',
      created_by_user_id: 'u_1',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
});

const mockListAgents = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'agent_1',
      project_id: 'prj_1',
      name: 'Analysis Agent',
      mode: 'internal',
      status: 'enabled',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
});

const mockGetResourcePolicy = vi.fn().mockImplementation(
  async (_ws: string, _project: string, resourceType: 'endpoint' | 'source_library' | 'agent', resourceId: string) => {
    const defaultPolicy = {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members' as const,
      allowed_subjects: [],
      rate_limits: { rules: [] },
      quota_limits: { rules: [] },
    };
    if (resourceType === 'endpoint') {
      return {
        ...defaultPolicy,
        quota_limits: { rules: [{ key: 'endpoint.daily_token_limit', value: 100000, window: 'day' as const }] },
      };
    }
    if (resourceType === 'source_library') {
      return {
        ...defaultPolicy,
        access_mode: 'allow_list' as const,
        allowed_subjects: [{ subject_type: 'group' as const, subject_id: 'group_001' }],
      };
    }
    return defaultPolicy;
  }
);

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return { list: mockListEndpoints };
  }),
  SourcesAPI: vi.fn().mockImplementation(function () {
    return { listLibraries: mockListLibraries };
  }),
  AgentAPI: vi.fn().mockImplementation(function () {
    return { list: mockListAgents };
  }),
  MemberAPI: vi.fn().mockImplementation(function () {
    return { getResourcePolicy: mockGetResourcePolicy };
  }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const defaultPolicyData = () => ({
  resource_type: 'endpoint',
  resource_id: 'ep_1',
  access_mode: 'allow_all_members' as const,
  allowed_subjects: [],
  quota_limits: {
    rules: [{ key: 'endpoint.daily_token_limit', value: 100000, window: 'day' as const }],
  },
});

let mockPolicyData = defaultPolicyData();
vi.mock('@/lib/hooks/use-members', () => ({
  useMembers: vi.fn(() => ({
    data: [
      {
        id: 'user_123',
        email: 'user123@example.com',
        name: 'User 123',
        role: 'developer',
        permissions: [],
        status: 'active',
        joined_at: '2026-02-01T00:00:00Z',
      },
    ],
  })),
  useProjectGroups: vi.fn(() => ({
    data: [
      {
        id: 'group_001',
        project_id: 'prj_1',
        name: 'Ops Team',
        permission_template_id: 'developer',
        member_ids: [],
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ],
  })),
  useResourcePolicy: vi.fn(() => ({
    data: mockPolicyData,
    isLoading: false,
  })),
  useUpdateResourcePolicy: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
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
    mockPolicyData = defaultPolicyData();
    mockMutateAsync.mockClear();
    mockGetResourcePolicy.mockClear();
  });

  it('saves endpoint policy changes', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__endpoint-daily-token-limit')).toBeInTheDocument();
    });

    const input = screen.getByTestId('resource-policy__endpoint-daily-token-limit');
    await user.clear(input);
    await user.type(input, '250000');
    await user.click(screen.getByTestId('resource-policy__add-subject'));
    const subjectSelects = screen.getAllByTestId('resource-policy__subject-id-select');
    await user.selectOptions(subjectSelects[0], 'user_123');
    await user.type(
      screen.getByPlaceholderText('subject_placeholders.endpoint.daily_token_limit'),
      '70000'
    );
    await user.click(screen.getByTestId('resource-policy__save'));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        access_mode: 'allow_all_members',
        allowed_subjects: [
          expect.objectContaining({
            subject_type: 'user',
            subject_id: 'user_123',
            quota_limits: {
              rules: [{ key: 'endpoint.daily_token_limit', value: 70000, window: 'day' }],
            },
          }),
        ],
        quota_limits: {
          rules: [{ key: 'endpoint.daily_token_limit', value: 250000, window: 'day' }],
        },
      })
    );
  });

  it('blocks save for allow_list when subject list is empty', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__access-mode')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('resource-policy__access-mode'), 'allow_list');
    expect(screen.getByTestId('resource-policy__allow-list-required')).toBeInTheDocument();
    expect(screen.getByTestId('resource-policy__save')).toBeDisabled();
  });

  it('renders resource rows when user has permission', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('resource-policy__row--endpoint--ep_1')).toBeInTheDocument();
    expect(screen.getByTestId('resource-policy__row--source_library--lib_1')).toBeInTheDocument();
    expect(screen.getByTestId('resource-policy__row--agent--agent_1')).toBeInTheDocument();
    expect(screen.getByTestId('resource-policy__row-status--endpoint--ep_1')).toHaveTextContent(
      'resource_status.overridden'
    );
    expect(screen.getByTestId('resource-policy__row-status--source_library--lib_1')).toHaveAttribute(
      'title',
      'resource_status_reason.allow_list'
    );
    expect(screen.getByTestId('resource-policy__row-status--source_library--lib_1')).toHaveAttribute(
      'aria-label',
      'resource_status.allow_list. resource_status_reason.allow_list'
    );
    expect(screen.getByTestId('resource-policy__row-status--agent--agent_1')).toHaveTextContent(
      'resource_status.default'
    );
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: '<script>', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks read access', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('renders effective summary with merged subject override', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__effective-summary')).toBeInTheDocument();
    });

    await user.clear(screen.getByTestId('resource-policy__endpoint-daily-token-limit'));
    await user.type(screen.getByTestId('resource-policy__endpoint-daily-token-limit'), '250000');

    await user.click(screen.getByTestId('resource-policy__add-subject'));
    const subjectSelects = screen.getAllByTestId('resource-policy__subject-id-select');
    await user.selectOptions(subjectSelects[0], 'user_123');
    await user.type(
      screen.getByPlaceholderText('subject_placeholders.endpoint.daily_token_limit'),
      '70000'
    );

    const summary = screen.getByTestId('resource-policy__effective-summary');
    expect(summary).toHaveTextContent('effective_summary.access');
    expect(summary).toHaveTextContent('access_mode.allow_all_members');
    expect(summary).toHaveTextContent('250000 units.tokens_per_day');

    const subjectSummary = screen.getByTestId('resource-policy__effective-subject--0');
    expect(within(subjectSummary).getByText(/user:/)).toBeInTheDocument();
    expect(subjectSummary).toHaveTextContent('70000 units.tokens_per_day');
  });

  it('saves source library policy changes', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__row--source_library--lib_1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('resource-policy__row--source_library--lib_1'));
    await user.type(screen.getByTestId('resource-policy__library-max-total-files'), '200');
    await user.type(screen.getByTestId('resource-policy__library-max-file-size-bytes'), '10485760');

    await user.click(screen.getByTestId('resource-policy__add-subject'));
    const subjectSelects = screen.getAllByTestId('resource-policy__subject-id-select');
    await user.selectOptions(subjectSelects[0], 'user_123');
    await user.type(
      screen.getByPlaceholderText('subject_placeholders.source_library.max_total_files'),
      '50'
    );
    await user.type(
      screen.getByPlaceholderText('subject_placeholders.source_library.max_file_size_bytes'),
      '2097152'
    );

    await user.click(screen.getByTestId('resource-policy__save'));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        quota_limits: {
          rules: expect.arrayContaining([
            { key: 'source_library.max_total_files', value: 200 },
            { key: 'source_library.max_file_size_bytes', value: 10485760 },
          ]),
        },
        allowed_subjects: [
          expect.objectContaining({
            subject_id: 'user_123',
            quota_limits: {
              rules: expect.arrayContaining([
                { key: 'source_library.max_total_files', value: 50 },
                { key: 'source_library.max_file_size_bytes', value: 2097152 },
              ]),
            },
          }),
        ],
      })
    );
  });

  it('saves agent policy changes', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__row--agent--agent_1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('resource-policy__row--agent--agent_1'));
    await user.type(screen.getByTestId('resource-policy__agent-max-concurrency'), '6');

    await user.click(screen.getByTestId('resource-policy__add-subject'));
    const subjectSelects = screen.getAllByTestId('resource-policy__subject-id-select');
    await user.selectOptions(subjectSelects[0], 'user_123');
    await user.type(screen.getByPlaceholderText('subject_placeholders.agent.max_concurrency'), '2');

    await user.click(screen.getByTestId('resource-policy__save'));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        rate_limits: {
          rules: [{ key: 'agent.max_concurrency', value: 6 }],
        },
        allowed_subjects: [
          expect.objectContaining({
            subject_id: 'user_123',
            rate_limits: {
              rules: [{ key: 'agent.max_concurrency', value: 2 }],
            },
          }),
        ],
      })
    );
  });
});
