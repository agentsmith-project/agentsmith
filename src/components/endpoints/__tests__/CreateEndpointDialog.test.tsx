import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { CreateEndpointDialog } from '../CreateEndpointDialog';

const mockTranslations = {
  endpoints: {
    create_dialog: {
      title: 'Create Endpoint',
      description: 'Add endpoint',
      name: 'Name',
      name_placeholder: 'Endpoint name',
      name_hint: 'Name hint',
      model_id: 'Model ID',
      model_id_placeholder: 'Model placeholder',
      provider: 'Provider',
      provider_custom: 'Custom',
      compatibility_interface: 'Compatibility Interface',
      base_url: 'Base URL',
      credential: 'Credential',
      no_credentials: 'No credentials',
      create_credential_first: 'Create credential first',
      credential_required: 'Credential required',
      base_url_required: 'Base URL required',
      model_conflict: 'Model conflict',
      failed: 'Failed',
      limits: 'Limits',
      max_rpm: 'Max RPM',
      timeout_seconds: 'Timeout',
      success: 'Created',
      capability: 'Endpoint Capability',
      capability_chat_completion: 'Chat Completion',
      capability_multimodal_completion: 'Multimodal Completion',
      capability_embedding: 'Embedding',
      capability_rerank: 'Reranker',
      capability_image_generation: 'Image Generation',
      capability_video_generation: 'Video Generation',
      catalog_models: 'Catalog Models',
      select_from_catalog: 'Select from catalog',
      wizard_description: 'Custom wizard description',
      open_wizard_button: 'Open Wizard',
      catalog_context_tokens: 'Context',
      catalog_output_tokens: 'Output',
      catalog_input_price: 'Input Price',
      catalog_output_price: 'Output Price',
      name_conflict: 'Name conflict',
    },
    custom_wizard: {
      use_default: 'Use default',
      title: 'Create Custom Endpoint',
    },
    protocol_labels: {
      openai_compatible: 'OpenAI Compatible',
      anthropic_compatible: 'Anthropic Compatible',
    },
  },
  common: {
    cancel: 'Cancel',
    create: 'Create',
    placeholders: {
      enter_description: 'Enter description',
      select: 'Select',
    },
  },
  errors: {
    api_error: 'API Error',
    network_error: 'Network Error',
  },
};

function resolveTranslation(obj: unknown, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) return path;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : path;
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => resolveTranslation(mockTranslations, `${namespace}.${key}`),
  useLocale: () => 'en',
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const mockCreate = vi.fn();
const mockListCredentials = vi.fn();
const mockListEndpoints = vi.fn();
const mockListCatalogProviders = vi.fn();
const mockListCatalogModels = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({ request: vi.fn() })),
  EndpointAPI: class {
    create = mockCreate;
    list = mockListEndpoints;
  },
  CredentialsAPI: class {
    list = mockListCredentials;
  },
  RuntimeAPI: class {
    listCatalogProviders = mockListCatalogProviders;
    listCatalogModels = mockListCatalogModels;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../CustomEndpointWizard', () => ({
  CustomEndpointWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="custom-endpoint-wizard">wizard-open</div> : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      writable: true,
    });
  }
  mockCreate.mockResolvedValue({ id: 'ep_1' });
  mockListCredentials.mockResolvedValue([{ id: 'cred_1', name: 'Main Key', fingerprint: 'abcd1234' }]);
  mockListEndpoints.mockResolvedValue({ items: [] });
  mockListCatalogProviders.mockResolvedValue({
    version: { id: 'v1' },
    items: [
      {
        id: 'p1',
        version_id: 'v1',
        provider_key: 'openai',
        provider_id: 'openai',
        name: 'OpenAI',
        api: 'https://api.openai.com/v1',
        env: [],
        model_count: 1,
      },
      {
        id: 'p2',
        version_id: 'v1',
        provider_key: 'zhipuai',
        provider_id: 'zhipuai',
        name: 'Zhipu AI',
        api: 'https://open.bigmodel.cn/api/coding/paas/v4',
        env: [],
        model_count: 1,
      },
    ],
  });
  mockListCatalogModels.mockResolvedValue({
    version: { id: 'v1' },
    total: 1,
    items: [
      {
        id: 'm1',
        version_id: 'v1',
        provider_key: 'openai',
        provider_id: 'openai',
        provider_name: 'OpenAI',
        model_id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['chat_completion'],
        limit: { context: 128000, output: 8192 },
        cost: { input: 2.5, output: 10 },
      },
    ],
  });
});

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={mockTranslations}>
        <CreateEndpointDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws_1"
          projectId="proj_1"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('CreateEndpointDialog', () => {
  it('shows custom endpoint entry as an external button', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Wizard' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open Wizard' }));
    expect(screen.getByTestId('custom-endpoint-wizard')).toBeInTheDocument();
  });

  it('shows base-url input in provider catalog flow', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText('Catalog Models')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Model ID')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Base URL *')).toBeInTheDocument();
    expect(screen.queryByText('Limits')).not.toBeInTheDocument();
  });

  it('auto-selects a catalog model and keeps create disabled before credential selection', async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Name *')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'endpoint-openai' } });

    await waitFor(() => {
      expect(screen.getAllByText(/GPT-4o/).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
      expect(screen.getByLabelText('Base URL *')).toHaveValue('https://api.openai.com/v1');
    });
  });

  it('updates base url when provider changes', async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Base URL *')).toHaveValue('https://api.openai.com/v1');
    });

    const providerTrigger = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent?.includes('OpenAI'));
    expect(providerTrigger).toBeDefined();
    fireEvent.click(providerTrigger as HTMLElement);
    let providerOption: HTMLElement | null = null;
    await waitFor(() => {
      const candidates = screen.getAllByText('Zhipu AI');
      providerOption = (candidates
        .map((node) => node.closest('[role="option"]'))
        .find((node): node is HTMLElement => node instanceof HTMLElement))
        ?? null;
      expect(providerOption).not.toBeNull();
    });
    expect(providerOption).toBeInstanceOf(HTMLElement);
    fireEvent.click(providerOption!);

    await waitFor(() => {
      expect(screen.getByLabelText('Base URL *')).toHaveValue('https://open.bigmodel.cn/api/coding/paas/v4');
    });
  });
});
