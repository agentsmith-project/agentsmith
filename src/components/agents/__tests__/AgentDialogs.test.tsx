import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { CreateAgentDialog } from '../CreateAgentDialog';
import { EditAgentDialog } from '../EditAgentDialog';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockEndpointList = vi.fn();

const mockMessages = {
  agents: {
    create_dialog: {
      title: 'Create Agent',
      description: 'Description',
      name: 'Name',
      name_placeholder: 'Agent name',
      mode: 'Mode',
      mode_external: 'External',
      mode_internal: 'Internal',
      interaction_mode: 'Interaction Mode',
      config_title: 'Internal Agent Config',
      image: 'Image',
      image_required: 'Image required',
      env: 'Environment Variables',
      add_env: 'Add variable',
      max_concurrent_sessions: 'Max Concurrent Sessions',
      max_concurrent_sessions_placeholder: 'Optional override',
      cpu_request: 'CPU Request',
      cpu_limit: 'CPU Limit',
      memory_request: 'Memory Request',
      memory_limit: 'Memory Limit',
      idle_timeout_sec: 'Idle Timeout (sec)',
      max_lifetime_sec: 'Max Lifetime (sec)',
      capabilities_title: 'Execution Capabilities',
      notebook_endpoint_id: 'Notebook Endpoint ID',
      notebook_endpoint_required: 'Notebook endpoint required',
      notebook_endpoint_empty: 'No active endpoints available',
      multimodal_enabled: 'Enable multimodal input',
      accepted_mime_types: 'Accepted MIME types',
      max_file_count: 'Max files per message',
      max_total_bytes: 'Max total bytes per message',
      success: 'Created',
    },
    edit_dialog: {
      title: 'Edit Agent',
      description: 'Update agent',
      success: 'Updated',
    },
    interaction_chat: 'Chat',
    interaction_notebook: 'Notebook',
    interaction_both: 'Chat & Notebook',
  },
  common: {
    cancel: 'Cancel',
    create: 'Create',
    save: 'Save',
    private: 'Private',
    public: 'Public',
    visibility: 'Visibility',
    placeholders: {
      enter_description: 'Enter description',
    },
  },
};

function resolveTranslation(path: string): string {
  const keys = path.split('.');
  let current: unknown = mockMessages;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) return path;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : path;
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => resolveTranslation(`${namespace}.${key}`),
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({ request: vi.fn() })),
  AgentAPI: class {
    create = mockCreate;
    update = mockUpdate;
  },
  EndpointAPI: class {
    list = mockEndpointList;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/settings/ExecutionPreferencesEditor', () => ({
  ExecutionPreferencesEditor: () => <div data-testid="execution-preferences-editor" />,
}));

function renderWithProviders(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en-US" messages={mockMessages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('Agent dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'ag_1' });
    mockUpdate.mockResolvedValue({ id: 'ag_1' });
    mockEndpointList.mockResolvedValue({
      items: [
        {
          id: 'ep_active_1',
          name: 'OpenAI Main',
          model: 'gpt-4.1',
          provider_family: 'openai',
          status: 'active',
        },
        {
          id: 'ep_disabled',
          name: 'Disabled',
          model: 'gpt-4o-mini',
          provider_family: 'openai',
          status: 'disabled',
        },
      ],
    });
  });

  it('CreateAgentDialog uses active endpoint options and submits selected endpoint', async () => {
    renderWithProviders(
      <CreateAgentDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws_1"
        projectId="proj_1"
      />,
    );

    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'agent-a' } });

    const endpointSelect = screen.getByLabelText('Notebook Endpoint ID') as HTMLSelectElement;
    await waitFor(() => {
      expect(endpointSelect.value).toBe('ep_active_1');
    });

    expect(screen.getByText('OpenAI Main (openai/gpt-4.1)')).toBeInTheDocument();
    expect(screen.queryByText('Disabled (openai/gpt-4o-mini)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
    const payload = mockCreate.mock.calls[0][2];
    expect(payload.execution_preferences?.notebook?.endpoint_id).toBe('ep_active_1');
    expect(payload.execution_preferences?.notebook?.model).toBeUndefined();
  });

  it('EditAgentDialog submits updated internal env and endpoint selection', async () => {
    const internalAgent = {
      id: 'ag_internal_1',
      name: 'Internal Agent',
      description: '',
      mode: 'internal',
      status: 'enabled',
      interaction_mode: 'notebook',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_active_1',
        },
      },
      config: {
        image: 'ghcr.io/example/runner:latest',
        env: {
          FOO: 'bar',
        },
      },
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
    };

    renderWithProviders(
      <EditAgentDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws_1"
        projectId="proj_1"
        agent={internalAgent as any}
        canSetVisibility={false}
      />,
    );

    const endpointSelect = await waitFor(() => {
      const candidate = screen.getAllByRole('combobox').find((element) => (
        element.querySelector('option[value="ep_active_1"]') !== null
      ));
      expect(candidate).toBeDefined();
      return candidate as HTMLSelectElement;
    });
    fireEvent.change(endpointSelect, { target: { value: 'ep_active_1' } });

    const keyInputs = screen.getAllByPlaceholderText('KEY');
    const valueInputs = screen.getAllByPlaceholderText('value');
    fireEvent.change(keyInputs[0], { target: { value: 'FOO' } });
    fireEvent.change(valueInputs[0], { target: { value: 'baz' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });
    const payload = mockUpdate.mock.calls[0][3];
    expect(payload.config.env).toEqual({ FOO: 'baz' });
    expect(payload.execution_preferences.notebook.endpoint_id).toBe('ep_active_1');
    expect(payload.execution_preferences.notebook.model).toBeUndefined();
  });
});
