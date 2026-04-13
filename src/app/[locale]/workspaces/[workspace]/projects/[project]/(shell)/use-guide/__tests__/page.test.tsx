import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import UseGuidePage from '../page';

const mockUseEndpointPageCapabilities = vi.fn(() => ({ canUse: true, canManage: false, canRead: true }));
const mockUseApiAccessGuideData = vi.fn(() => ({
  activeApiKeyCount: 2,
  apiKeysLoading: false,
  hasActiveApiKey: true,
  endpointsLoading: false,
  usableEndpoints: [
    {
      id: 'ep_1',
      name: 'Primary OpenAI Endpoint',
      model: 'placeholder-chat-model',
      upstream_protocol: 'openai_chat_completions',
      type: 'catalog',
      status: 'active',
      defaults: { chat_model_id: 'placeholder-chat-model' },
      capabilities: [{ type: 'chat_completion', enabled: true }],
    },
  ],
  personalContextLoading: false,
  workspacePersonalContextCount: 1,
  projectPersonalContextCount: 1,
  hasAnyPersonalContext: true,
}));
const mockReplace = vi.fn();

const translationMap: Record<string, string> = {
  'readiness.api_keys.ready': '{count} active API keys ready',
  'readiness.api_keys.pending': 'Create your first personal API key before using CLI, SDK, or curl examples.',
  'readiness.endpoint.ready': '{name} is ready for access',
  'readiness.endpoint.loading': 'Loading endpoint data',
  'readiness.endpoint.pending': 'Create or activate an endpoint first',
  'readiness.endpoint.unavailable': 'Endpoint list is not available in this view',
  'readiness.policy.ready': 'Project policy is enforced automatically',
  'readiness.context.ready_project_and_workspace': '{projectCount} project entries are ready and override {workspaceCount} workspace defaults when needed.',
  'readiness.context.ready_project_only': '{projectCount} project personal context entries are ready for this project.',
  'readiness.context.ready_workspace_only': '{workspaceCount} workspace personal context entries are ready for this project.',
  'readiness.context.pending': 'Add workspace defaults or project overrides if this project needs personal working preferences.',
  'selection.empty': 'No active endpoint is available for API access yet',
  'selection.no_read_access': 'You can use project access, but this page cannot read the endpoint list.',
  'selection.placeholder': 'Select an endpoint',
};

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, string | number>) => {
  const template = translationMap[key] ?? key;
  if (!values) return template;
  return Object.entries(values).reduce((acc, [name, value]) => acc.replace(`{${name}}`, String(value)), template);
} }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/workspaces/ws_1/projects/proj_1/use-guide',
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/hooks/use-permissions', () => ({ useEndpointPageCapabilities: () => mockUseEndpointPageCapabilities() }));
vi.mock('@/lib/public-runtime-config', () => ({ buildPublicApiUrl: (path: string) => `https://api.example.com/api/v1/${path}` }));
vi.mock('@/lib/use-guide/use-api-access-guide-data', () => ({
  useApiAccessGuideData: () => mockUseApiAccessGuideData(),
}));

describe('UseGuidePage route', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: true, canManage: false, canRead: true });
    mockUseApiAccessGuideData.mockReturnValue({
      activeApiKeyCount: 2,
      apiKeysLoading: false,
      hasActiveApiKey: true,
      endpointsLoading: false,
      usableEndpoints: [
        {
          id: 'ep_1',
          name: 'Primary OpenAI Endpoint',
          model: 'placeholder-chat-model',
          upstream_protocol: 'openai_chat_completions',
          type: 'catalog',
          status: 'active',
          defaults: { chat_model_id: 'placeholder-chat-model' },
          capabilities: [{ type: 'chat_completion', enabled: true }],
        },
      ],
      personalContextLoading: false,
      workspacePersonalContextCount: 1,
      projectPersonalContextCount: 1,
      hasAnyPersonalContext: true,
    });
  });

  it('renders endpoint-first guide and protocol-specific examples', async () => {
    render(<UseGuidePage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('use-guide__page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('use-guide__status-api-keys')).toHaveTextContent('2 active API keys ready');
    expect(screen.getByTestId('use-guide__status-endpoint')).toHaveTextContent('readiness.endpoint.title');
    expect(screen.getByTestId('use-guide__status-context')).toHaveTextContent('1 project entries are ready and override 1 workspace defaults when needed.');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('use-guide__endpoint-select')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__endpoint-select')).toHaveTextContent('Select an endpoint');
    expect(screen.queryByTestId('use-guide__endpoint-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('use-guide__gateway-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy');
    expect(screen.getByTestId('use-guide__openai-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy/openai');
    expect(screen.getByTestId('use-guide__codex-sample')).toHaveTextContent('model_providers.agentsmith.base_url="https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy/openai"');
    expect(screen.getByTestId('use-guide__codex-sample')).toHaveTextContent('<project-model-name>');
    expect(screen.getByTestId('use-guide__tab-openai')).toBeEnabled();
    expect(screen.getByTestId('use-guide__tab-anthropic')).toBeEnabled();
    expect(screen.getByTestId('use-guide__openai-base-url__copy')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__codex-sample__copy')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__link-api-keys')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__link-workspace-context')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__link-project-context')).toBeInTheDocument();
    expect(screen.queryByTestId('use-guide__link-resource-policy')).not.toBeInTheDocument();
  });

  it('falls back to guidance-only mode when endpoint list is not readable', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: true, canManage: false, canRead: false });
    mockUseApiAccessGuideData.mockReturnValue({
      activeApiKeyCount: 0,
      apiKeysLoading: false,
      hasActiveApiKey: false,
      endpointsLoading: false,
      usableEndpoints: [],
      personalContextLoading: false,
      workspacePersonalContextCount: 0,
      projectPersonalContextCount: 0,
      hasAnyPersonalContext: false,
    });

    render(<UseGuidePage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('use-guide__endpoint-unavailable')).toBeInTheDocument();
    });

    expect(screen.getByTestId('use-guide__status-api-keys')).toHaveTextContent('Create your first personal API key before using CLI, SDK, or curl examples.');
    expect(screen.getByTestId('use-guide__status-context')).toHaveTextContent('Add workspace defaults or project overrides if this project needs personal working preferences.');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('use-guide__endpoint-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('use-guide__gateway-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy');
    expect(screen.getByTestId('use-guide__openai-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy/openai');
  });

  it('shows validation_error for invalid parameters', async () => {
    render(<UseGuidePage params={Promise.resolve({ workspace: '../unsafe-workspace', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });

  it('shows permission_denied_title when project endpoint use is forbidden', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: false, canManage: false, canRead: false });

    render(<UseGuidePage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });
});
