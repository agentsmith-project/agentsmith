import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { CreateAgentRunnerDialog } from '../CreateAgentRunnerDialog';
import { EditAgentRunnerDialog } from '../EditAgentRunnerDialog';

const {
  mockCreate,
  mockUpdate,
  mockEndpointList,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockEndpointList: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

const mockMessages = {
  agent_runners: {
    object_badge: 'Agent Runner',
    default_endpoint: 'Default endpoint',
    capabilities: 'Capabilities',
    capability_terminal: 'Terminal',
    capability_artifacts: 'Artifacts',
    capability_file_inputs: 'File inputs',
    not_configured: 'Not configured',
    create_dialog: {
      title: 'Create Agent Runner',
      description: 'Configure task runner readiness.',
      name: 'Name',
      name_placeholder: 'Runner name',
      description_label: 'Description',
      description_placeholder: 'Optional description',
      success: 'Created',
    },
    edit_dialog: {
      title: 'Edit Agent Runner',
      description: 'Update runner configuration.',
      success: 'Updated',
    },
  },
  common: {
    cancel: 'Cancel',
    create: 'Create',
    save: 'Save',
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
  AgentRunnerAPI: class {
    create = mockCreate;
    update = mockUpdate;
  },
  EndpointAPI: class {
    list = mockEndpointList;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
  },
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

describe('Agent Runner dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'runner_1' });
    mockUpdate.mockResolvedValue({ id: 'runner_1' });
    mockEndpointList.mockResolvedValue({
      items: [
        {
          id: 'ep_active_1',
          name: 'OpenAI Main',
          model: 'gpt-4.1',
          provider_family: 'openai',
          status: 'active',
        },
      ],
    });
  });

  it('creates a runner without workload type or runtime mode fields', async () => {
    renderWithProviders(
      <CreateAgentRunnerDialog open onOpenChange={vi.fn()} workspaceId="ws_1" projectId="proj_1" />,
    );

    fireEvent.change(await screen.findByPlaceholderText('Runner name'), {
      target: { value: 'managed task runner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const payload = mockCreate.mock.calls[0][2];
    expect(payload.name).toBe('managed task runner');
    expect(payload.default_endpoint_id).toBe('ep_active_1');
    expect(payload.mode).toBeUndefined();
    expect(payload.runner_runtime).toBeUndefined();
    expect(payload.interaction_kind).toBeUndefined();
  });

  it('edits runner readiness configuration without legacy selectors', async () => {
    renderWithProviders(
      <EditAgentRunnerDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws_1"
        projectId="proj_1"
        runner={{
          id: 'runner_1',
          name: 'Managed Runner',
          default_endpoint_id: 'ep_active_1',
          capabilities: { terminal: true, artifacts: true, file_inputs: true },
        }}
      />,
    );

    expect(screen.queryByText(/chat|notebook|external|internal|docker|compose/i)).not.toBeInTheDocument();
    fireEvent.change(await screen.findByDisplayValue('Managed Runner'), {
      target: { value: 'Primary Runner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const payload = mockUpdate.mock.calls[0][3];
    expect(payload.name).toBe('Primary Runner');
    expect(payload.mode).toBeUndefined();
    expect(payload.runner_runtime).toBeUndefined();
    expect(payload.interaction_kind).toBeUndefined();
  });
});
