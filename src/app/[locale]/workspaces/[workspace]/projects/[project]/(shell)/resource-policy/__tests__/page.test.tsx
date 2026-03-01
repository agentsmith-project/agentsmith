import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { useCanManageResourcePolicy, useHasPermission } from '@/lib/hooks/use-permissions';

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
    if (resourceType === 'agent') {
      return {
        ...defaultPolicy,
        rate_limits: { rules: [{ key: 'agent.requests_per_minute', value: 4 }] },
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
  FilesAPI: vi.fn().mockImplementation(function () {
    return { listLibraries: mockListLibraries };
  }),
  AgentAPI: vi.fn().mockImplementation(function () {
    return { list: mockListAgents };
  }),
  MemberAPI: vi.fn().mockImplementation(function () {
    return { getResourcePolicy: mockGetResourcePolicy };
  }),
  AuditAPI: vi.fn().mockImplementation(function () {
    return { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, has_more: false }) };
  }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
  useCanManageResourcePolicy: vi.fn(() => true),
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
const mockUseCanManageResourcePolicy = vi.mocked(useCanManageResourcePolicy);

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
    mockUseHasPermission.mockReturnValue(true);
    mockUseCanManageResourcePolicy.mockReturnValue(true);
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

  it('renders govern header actions', async () => {
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByTestId('resource-policy__open-members')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects/prj_1/members');
    expect(within(header).getByTestId('resource-policy__open-credentials')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects/prj_1/credentials');
    expect(within(header).getByTestId('resource-policy__open-audit')).toHaveAttribute('href', '/en-US/workspaces/ws_1/projects/prj_1/audit');
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

  it('blocks save when duplicate subjects are present', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__add-subject')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('resource-policy__add-subject'));
    await user.click(screen.getByTestId('resource-policy__add-subject'));

    const subjectSelects = screen.getAllByTestId('resource-policy__subject-id-select');
    await user.selectOptions(subjectSelects[0], 'user_123');
    await user.selectOptions(subjectSelects[1], 'user_123');

    expect(screen.getByTestId('resource-policy__duplicate-subjects')).toBeInTheDocument();
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
      'resource_status.overridden'
    );
  });

  it('renders resource groups by type', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <ResourcePolicyPage
        params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('resource-policy__group--endpoint')).toBeInTheDocument();
    });

    expect(screen.getByTestId('resource-policy__group--agent')).toBeInTheDocument();
    expect(screen.getByTestId('resource-policy__group--source_library')).toBeInTheDocument();
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

  it('shows permission denied when user lacks governance access', async () => {
    mockUseHasPermission.mockImplementation((permission) => {
      if (permission === 'project:resource_policy:manage') return false;
      return true;
    });
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
    await user.clear(screen.getByTestId('resource-policy__agent-requests-per-minute'));
    await user.type(screen.getByTestId('resource-policy__agent-requests-per-minute'), '6');

    await user.click(screen.getByTestId('resource-policy__add-subject'));
    const subjectSelects = screen.getAllByTestId('resource-policy__subject-id-select');
    await user.selectOptions(subjectSelects[0], 'user_123');
    await user.type(
      screen.getByPlaceholderText('subject_placeholders.agent.requests_per_minute'),
      '2'
    );

    await user.click(screen.getByTestId('resource-policy__save'));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        rate_limits: {
          rules: [{ key: 'agent.requests_per_minute', value: 6 }],
        },
        allowed_subjects: [
          expect.objectContaining({
            subject_id: 'user_123',
            rate_limits: {
              rules: [{ key: 'agent.requests_per_minute', value: 2 }],
            },
          }),
        ],
      })
    );
  });

});
