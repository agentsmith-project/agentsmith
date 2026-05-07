import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as nextNavigation from 'next/navigation';
import { useAgentRunnerPageCapabilities } from '@/lib/hooks/use-permissions';
import type {
  AgentRunnerActionAffordance,
  AgentRunnerActionOperation,
  AgentRunnerActions,
  AgentRunnerCollectionActions,
  AgentRunnerListResponse,
} from '@/lib/api/types';
import type { AgentRunnerPageRecord } from '../agent-runners-page-types';

function createDeveloperRunnerAction(
  visible = true,
  allowed = true,
  reason_code?: string,
): AgentRunnerActionAffordance {
  const affordance: AgentRunnerActionAffordance = {
    operation: 'create_developer_runner',
    visible,
    allowed,
    required_permissions: ['project:agent_runner:manage'],
    danger_level: 'none',
  };
  return reason_code ? { ...affordance, reason_code } : affordance;
}

function listResponse(
  items: AgentRunnerPageRecord[] = [],
  createAction = createDeveloperRunnerAction(),
): AgentRunnerListResponse {
  const actions: AgentRunnerCollectionActions = {
    create_developer_runner: createAction,
  };
  return {
    items,
    total: items.length,
    page: 1,
    page_size: Math.max(items.length, 1),
    has_more: false,
    actions,
  };
}

const mockList = vi.fn().mockResolvedValue(listResponse());
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDelete = vi.fn().mockResolvedValue({});
const mockDiagnostics = vi.fn().mockResolvedValue(null);
const mockGetAgentTaskModelSetting = vi.fn().mockResolvedValue({
  readiness: {
    state: 'ready',
    display_summary: 'Agent tasks are ready to run.',
  },
});
const mockCreateDialog = vi.fn((props: { open?: boolean }) => (
  props.open ? <div data-testid="agent-runners__create-dialog" /> : null
));
const mockKeysDialog = vi.fn((_: Record<string, unknown>) => null);

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AgentRunnerAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      update: mockUpdate,
      delete: mockDelete,
      getDiagnostics: mockDiagnostics,
    };
  }),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      getAgentTaskModelSetting: mockGetAgentTaskModelSetting,
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'agent_runners.create_developer': 'Create Developer Runner',
      'agent_runners.managed_projection_not_configurable': 'Not configurable here',
      'agent_runners.managed_projection_detail_title': 'Deployment-managed runner',
      'agent_runners.managed_projection_detail_description': 'This read-only runner is configured outside this project UI. Review status and source here.',
      'agent_runners.source_system_managed': 'Deployment managed',
      'agent_runners.source_developer': 'Developer runner',
      'agent_runners.source_label': 'Source',
      'agent_runners.readiness': 'Readiness',
      'agent_runners.detail_close': 'Close details',
      'agent_runners.project_model_setup_title': 'Project model setup',
      'agent_runners.project_model_setup_ready': 'Ready for Agent tasks',
      'agent_runners.project_model_setup_blocked': 'Agent task model setup blocks task execution',
    };
    const scopedKey = namespace ? `${namespace}.${key}` : key;
    const template = translations[scopedKey] ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
  },
}));

vi.mock('@/components/agent-runners/CreateAgentRunnerDialog', () => ({
  CreateAgentRunnerDialog: (props: { open?: boolean }) => mockCreateDialog(props),
}));

vi.mock('@/components/agent-runners/EditAgentRunnerDialog', () => ({
  EditAgentRunnerDialog: () => null,
}));

vi.mock('@/components/api-keys/AgentRunnerKeysDialog', () => ({
  AgentRunnerKeysDialog: (props: Record<string, unknown>) => mockKeysDialog(props),
}));

vi.mock('@/components/agent-runners/AgentRunnerDiagnosticsPanel', () => ({
  AgentRunnerDiagnosticsPanel: () => null,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useAgentRunnerPageCapabilities: vi.fn(() => ({
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canRunDiagnostics: true,
    canManage: true,
  })),
}));

import AgentRunnersPage from '../page';

const mockUseAgentRunnerPageCapabilities = vi.mocked(useAgentRunnerPageCapabilities);
const mockUseSearchParams = vi.spyOn(nextNavigation, 'useSearchParams');

function action(
  operation: AgentRunnerActionOperation,
  visible = false,
  allowed = false,
): AgentRunnerActionAffordance {
  return {
    operation,
    visible,
    allowed,
    required_permissions: [],
    danger_level: operation === 'delete' ? 'high' : 'none',
  };
}

function runnerActions(overrides: Partial<AgentRunnerActions> = {}): AgentRunnerActions {
  const base: AgentRunnerActions = {
    set_project_default: action('set_project_default'),
    bind_to_task: action('bind_to_task'),
    run_test_task: action('run_test_task'),
    edit: action('edit'),
    disable: action('disable'),
    delete: action('delete'),
    issue_connection_key: action('issue_connection_key'),
    revoke_connection_key: action('revoke_connection_key'),
    test_connection: action('test_connection'),
    view_diagnostics: action('view_diagnostics', true, true),
  };
  return { ...base, ...overrides };
}

function buildRunner(overrides: Partial<AgentRunnerPageRecord> = {}): AgentRunnerPageRecord {
  const base: AgentRunnerPageRecord = {
    id: 'runner_1',
    project_id: 'proj_1',
    name: 'Runner One',
    description: '',
    kind: 'developer',
    source: 'developer',
    read_only: false,
    is_default: false,
    status: 'ready',
    capabilities: { task_execution: true },
    diagnostics: { presence: 'online' },
    actions: runnerActions({
      edit: action('edit', true, true),
      delete: action('delete', true, true),
      issue_connection_key: action('issue_connection_key', true, true),
      revoke_connection_key: action('revoke_connection_key', true, true),
      test_connection: action('test_connection', true, true),
      run_test_task: action('run_test_task', true, true),
    }),
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  };
  return { ...base, ...overrides };
}

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

describe('AgentRunnersPage', () => {
  const mockReadonlySearchParams = (query = '') =>
    new URLSearchParams(query) as unknown as ReturnType<typeof nextNavigation.useSearchParams>;

  it('renders header and toolbar layout', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    const toolbar = screen.getByTestId('page-layout__toolbar');
    const createButton = await within(toolbar).findByTestId('agent-runners__create-btn');
    expect(createButton).toHaveTextContent('Create Developer Runner');
    expect(toolbar).not.toHaveTextContent(/external|internal|chat|notebook/i);
  });

  it('uses backend collection create affordance even when local manage capability is false', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockCreateDialog.mockClear();
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canRunDiagnostics: true,
      canManage: false,
    });
    mockList.mockResolvedValueOnce(listResponse([], createDeveloperRunnerAction(true, true)));
    const user = userEvent.setup();

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const createButton = await screen.findByTestId('agent-runners__create-btn');
    expect(createButton).toBeEnabled();

    await user.click(createButton);

    await waitFor(() => {
      expect(mockCreateDialog).toHaveBeenCalledWith(expect.objectContaining({ open: true }));
    });
    expect(screen.getByTestId('agent-runners__create-dialog')).toBeInTheDocument();
  });

  it('disables backend-visible denied collection create affordance without opening dialog', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockCreateDialog.mockClear();
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([], createDeveloperRunnerAction(true, false, 'permission_denied')));
    const user = userEvent.setup();

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const createButton = await screen.findByTestId('agent-runners__create-btn');
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute('title', 'action_disabled_reason');

    await user.click(createButton);

    expect(mockCreateDialog).not.toHaveBeenCalledWith(expect.objectContaining({ open: true }));
    expect(screen.queryByTestId('agent-runners__create-dialog')).not.toBeInTheDocument();
  });

  it('renders fixed IA with Project default status before System managed and Developer sections', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_1',
          name: 'Project Managed Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          is_default: true,
          default_endpoint_id: 'ep_1',
          diagnostics: { presence: 'managed' },
          actions: runnerActions({
            set_project_default: action('set_project_default', true, false),
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
        buildRunner({
          id: 'dev_1',
          name: 'Local Developer Runner',
          description: 'Local checks',
        }),
      ]));

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-runners__system-managed-section')).toBeInTheDocument();
    });

    const defaultStatus = screen.getByTestId('agent-runners__project-default-status');
    const systemSection = screen.getByTestId('agent-runners__system-managed-section');
    const developerSection = screen.getByTestId('agent-runners__developer-section');

    expect(defaultStatus).toHaveTextContent('Project Managed Runner');
    expect(defaultStatus.compareDocumentPosition(systemSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(systemSection.compareDocumentPosition(developerSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const systemRow = container.querySelector('[data-row-id="sys_1"]');
    expect(systemRow).not.toBeNull();
    expect(within(systemRow as HTMLElement).queryByRole('button', { name: /connection_keys_action/i })).not.toBeInTheDocument();
    expect(within(systemRow as HTMLElement).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(systemRow as HTMLElement).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(within(systemRow as HTMLElement).queryByRole('button', { name: /set_project_default|default/i })).not.toBeInTheDocument();

    const developerRow = container.querySelector('[data-row-id="dev_1"]');
    expect(developerRow).not.toBeNull();
    expect(within(developerRow as HTMLElement).getByRole('button', { name: /connection_keys_action/i })).toBeInTheDocument();
    expect(within(developerRow as HTMLElement).getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(within(developerRow as HTMLElement).getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/start task/i);
  });

  it('uses the deployment default managed projection for project execution status without requiring legacy is_default', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_projection_default',
          name: 'Deployment Projection Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          is_default: false,
          status: 'ready',
          default_endpoint_id: 'ep_projection_default',
          diagnostics: {
            presence: 'managed',
            managed_runner_projection: 'deployment_default',
          },
          actions: runnerActions({
            bind_to_task: action('bind_to_task', true, true),
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const defaultStatus = await screen.findByTestId('agent-runners__project-default-status');
    await waitFor(() => {
      expect(defaultStatus).toHaveTextContent('Deployment Projection Runner');
    });
    expect(defaultStatus).toHaveTextContent('default_status_ready');
    expect(defaultStatus).not.toHaveTextContent('default_status_no_runner');
    expect(defaultStatus).not.toHaveTextContent('default_status_issue_not_configured');
  });

  it('shows project model setup readiness separately from runner connection readiness', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockGetAgentTaskModelSetting.mockResolvedValueOnce({
      readiness: {
        state: 'blocked',
        display_summary: 'Agent tasks are blocked by model setup.',
        reason_code: 'agent_task_model_setting_missing',
      },
      actions: {
        update: {
          operation: 'update',
          visible: true,
          allowed: true,
          required_permissions: ['project:governance:update'],
          danger_level: 'none',
        },
      },
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_model_ready_connection',
          name: 'Connected Managed Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          is_default: true,
          status: 'ready',
          diagnostics: { presence: 'managed' },
          actions: runnerActions({
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const defaultStatus = await screen.findByTestId('agent-runners__project-default-status');
    await waitFor(() => {
      expect(defaultStatus).toHaveTextContent('Connected Managed Runner');
      expect(defaultStatus).toHaveTextContent('default_status_ready');
    });

    const modelSetup = await screen.findByTestId('agent-runners__project-model-setup-status');
    expect(modelSetup).toHaveTextContent('Project model setup');
    expect(modelSetup).toHaveTextContent('Agent tasks are blocked by model setup.');
    expect(modelSetup).toHaveTextContent('Agent task model setup blocks task execution');
    expect(defaultStatus).not.toHaveTextContent('Agent tasks are blocked by model setup.');
  });

  it('expands runner details inline on row click without rendering a bottom details card', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_inline',
          name: 'Deployment Managed Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          is_default: true,
          diagnostics: { presence: 'managed' },
          actions: runnerActions({
            edit: action('edit', true, true),
            delete: action('delete', true, true),
            issue_connection_key: action('issue_connection_key', true, true),
            set_project_default: action('set_project_default', true, true),
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
        buildRunner({
          id: 'dev_inline',
          name: 'Inline Developer Runner',
          description: 'Inline details target',
        }),
      ]));

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Inline Developer Runner');
    const developerRow = container.querySelector('[data-row-id="dev_inline"]');
    expect(developerRow).not.toBeNull();

    await user.click(developerRow as HTMLElement);

    const inlineDetails = await screen.findByTestId('agent-runners__inline-details--dev_inline');
    expect(inlineDetails).toHaveTextContent('Inline Developer Runner');
    expect(screen.queryByTestId('agent-runners__details-card')).not.toBeInTheDocument();

    const systemRow = container.querySelector('[data-row-id="sys_inline"]');
    expect(systemRow).not.toBeNull();
    const systemRowScope = within(systemRow as HTMLElement);
    expect(systemRowScope.queryByRole('button', { name: /connection_keys_action/i })).not.toBeInTheDocument();
    expect(systemRowScope.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(systemRowScope.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(systemRowScope.queryByRole('button', { name: /set_project_default|default/i })).not.toBeInTheDocument();

    await user.click(systemRow as HTMLElement);

    const managedDetails = await screen.findByTestId('agent-runners__managed-inline-details--sys_inline');
    expect(managedDetails).toHaveTextContent(
      'Deployment Managed Runner',
    );
    expect(managedDetails).toHaveTextContent('Deployment-managed runner');
    expect(managedDetails).toHaveTextContent('Not configurable here');
    expect(managedDetails).toHaveTextContent('Deployment managed');
    expect(managedDetails).not.toHaveTextContent(/task execution|terminal|artifacts|diagnostics_queue_depth|detail_diagnostics/i);
    expect(screen.queryByTestId('agent-runners__details-card')).not.toBeInTheDocument();
  });

  it('keeps Project default status display safe from endpoint ids and raw diagnostics', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_safe_default',
          name: 'Project Managed Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          is_default: true,
          default_endpoint_id: 'ep_private_default_123',
          status: 'degraded',
          diagnostics: {
            presence: 'managed',
            last_error: 'provider stacktrace: /internal/endpoint/ep_private_default_123 failed',
            last_error_at: '2026-02-03T08:00:00Z',
          },
          actions: runnerActions({
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const defaultStatus = await screen.findByTestId('agent-runners__project-default-status');
    await waitFor(() => {
      expect(defaultStatus).toHaveTextContent('Project Managed Runner');
    });
    expect(defaultStatus).toHaveTextContent('Deployment managed');
    expect(defaultStatus).toHaveTextContent('last_check');
    expect(defaultStatus).toHaveTextContent('default_status_issue_unavailable');
    expect(defaultStatus).not.toHaveTextContent('default_endpoint');
    expect(defaultStatus).not.toHaveTextContent('ep_private_default_123');
    expect(defaultStatus).not.toHaveTextContent(/provider stacktrace|internal\/endpoint/i);
  });

  it('renders denied diagnostics affordance disabled without opening details or querying diagnostics', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'dev_diagnostics_denied',
          name: 'Diagnostics Denied Runner',
          actions: runnerActions({
            view_diagnostics: {
              ...action('view_diagnostics', true, false),
              reason_code: 'diagnostics_not_allowed',
            },
          }),
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Diagnostics Denied Runner');
    const diagnosticsButton = screen.getByRole('button', { name: /view_diagnostics_action/i });
    expect(diagnosticsButton).toBeDisabled();
    expect(diagnosticsButton).toHaveAttribute('title', 'action_disabled_reason');

    await user.click(diagnosticsButton);

    expect(screen.queryByTestId('agent-runners__details-card')).not.toBeInTheDocument();
    expect(mockDiagnostics).not.toHaveBeenCalledWith('ws_1', 'proj_1', 'dev_diagnostics_denied');
  });

  it('uses backend action affordances instead of manage permission alone for Developer row actions', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'dev_locked',
          name: 'Locked Developer Runner',
          actions: runnerActions({
            edit: action('edit', true, false),
            delete: action('delete', false, false),
            issue_connection_key: action('issue_connection_key', false, false),
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Locked Developer Runner')).toBeInTheDocument();
    });

    const row = container.querySelector('[data-row-id="dev_locked"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByRole('button', { name: /connection_keys_action/i })).not.toBeInTheDocument();
    expect(within(row as HTMLElement).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole('button', { name: /edit/i })).toBeDisabled();
  });

  it('renders backend-visible Developer row actions without manage permission and triggers row handlers', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockKeysDialog.mockClear();
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canRunDiagnostics: true,
      canManage: false,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'dev_backend_truth',
          name: 'Backend Truth Developer',
          actions: runnerActions({
            edit: action('edit', true, true),
            delete: action('delete', true, true),
            issue_connection_key: action('issue_connection_key', true, true),
            revoke_connection_key: action('revoke_connection_key', true, true),
            test_connection: action('test_connection', true, true),
            run_test_task: action('run_test_task', true, true),
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));
    const user = userEvent.setup();

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Backend Truth Developer');
    const getRowScope = () => {
      const row = container.querySelector('[data-row-id="dev_backend_truth"]');
      expect(row).not.toBeNull();
      return within(row as HTMLElement);
    };

    const connectionButton = getRowScope().getByRole('button', { name: /connection_keys_action/i });
    const editButton = getRowScope().getByRole('button', { name: /edit/i });
    const deleteButton = getRowScope().getByRole('button', { name: /delete/i });
    expect(connectionButton).toBeEnabled();
    expect(editButton).toBeEnabled();
    expect(deleteButton).toBeEnabled();

    await user.click(connectionButton);
    await waitFor(() => {
      expect(mockKeysDialog).toHaveBeenCalledWith(expect.objectContaining({
        open: true,
        runnerId: 'dev_backend_truth',
      }));
    });

    await user.click(getRowScope().getByRole('button', { name: /edit/i }));
    expect(screen.getByTestId('agent-runners__inline-details--dev_backend_truth')).toHaveTextContent(
      'Backend Truth Developer',
    );
    expect(screen.queryByTestId('agent-runners__details-card')).not.toBeInTheDocument();

    await user.click(getRowScope().getByRole('button', { name: /delete/i }));
    expect(screen.getByText(/delete_confirm_title/i)).toBeInTheDocument();
  });

  it('shows backend-visible denied Developer row actions disabled without triggering handlers', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockKeysDialog.mockClear();
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'dev_denied_actions',
          name: 'Denied Actions Developer',
          actions: runnerActions({
            edit: action('edit', true, false),
            delete: action('delete', true, false),
            issue_connection_key: action('issue_connection_key', true, false),
            view_diagnostics: action('view_diagnostics', false, false),
          }),
        }),
      ]));
    const user = userEvent.setup();

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Denied Actions Developer');
    const row = container.querySelector('[data-row-id="dev_denied_actions"]');
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);

    const connectionButton = rowScope.getByRole('button', { name: /connection_keys_action/i });
    const editButton = rowScope.getByRole('button', { name: /edit/i });
    const deleteButton = rowScope.getByRole('button', { name: /delete/i });
    expect(connectionButton).toBeDisabled();
    expect(editButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();

    await user.click(connectionButton);
    await user.click(editButton);
    await user.click(deleteButton);

    expect(mockKeysDialog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('agent-runners__details-card')).not.toBeInTheDocument();
    expect(screen.queryByText(/delete_confirm_title/i)).not.toBeInTheDocument();
  });

  it('hides Developer lifecycle and connection actions for system managed read-only rows even when backend flags are visible', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_forged_actions',
          name: 'Forged System Managed Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          actions: runnerActions({
            edit: action('edit', true, true),
            delete: action('delete', true, true),
            issue_connection_key: action('issue_connection_key', true, true),
            revoke_connection_key: action('revoke_connection_key', true, true),
            test_connection: action('test_connection', true, true),
            run_test_task: action('run_test_task', true, true),
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Forged System Managed Runner');
    const row = container.querySelector('[data-row-id="sys_forged_actions"]');
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);

    expect(rowScope.queryByRole('button', { name: /connection_keys_action/i })).not.toBeInTheDocument();
    expect(rowScope.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(rowScope.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(rowScope.getByRole('button', { name: /view_diagnostics_action/i })).toBeInTheDocument();
  });

  it('keeps managed rows to read-only status/source/not-configurable copy without capability or diagnostics summaries', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'sys_projection',
          name: 'Managed Projection Runner',
          kind: 'system_managed',
          source: 'system',
          read_only: true,
          capabilities: { task_execution: true, terminal: true, artifacts: true },
          diagnostics: {
            presence: 'managed',
            queue_depth: 17,
            last_error: 'internal diagnostics detail',
          },
          actions: runnerActions({
            view_diagnostics: action('view_diagnostics', true, true),
          }),
        }),
      ]));

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Managed Projection Runner');
    const row = container.querySelector('[data-row-id="sys_projection"]');
    expect(row).not.toBeNull();
    expect(row as HTMLElement).toHaveTextContent('Deployment managed');
    expect(row as HTMLElement).toHaveTextContent('Not configurable here');
    expect(row as HTMLElement).not.toHaveTextContent(/task execution|terminal|artifacts|Queue Depth|internal diagnostics detail|Issue reported/i);
  });

  it('shows the connection sheet entry when any Developer connection action family member is visible', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockKeysDialog.mockClear();
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'dev_connection_family',
          name: 'Connection Family Developer',
          actions: runnerActions({
            edit: action('edit', false, false),
            delete: action('delete', false, false),
            issue_connection_key: action('issue_connection_key', false, false),
            revoke_connection_key: action('revoke_connection_key', true, true),
            test_connection: action('test_connection', true, true),
            run_test_task: action('run_test_task', true, true),
            view_diagnostics: action('view_diagnostics', false, false),
          }),
        }),
      ]));
    const user = userEvent.setup();

    const { container } = render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await screen.findByText('Connection Family Developer');
    const row = container.querySelector('[data-row-id="dev_connection_family"]');
    expect(row).not.toBeNull();
    const connectionButton = within(row as HTMLElement).getByRole('button', { name: /connection_keys_action/i });
    expect(connectionButton).toBeEnabled();

    await user.click(connectionButton);

    await waitFor(() => {
      expect(mockKeysDialog).toHaveBeenCalledWith(expect.objectContaining({
        open: true,
        runnerId: 'dev_connection_family',
      }));
    });
  });

  it('opens delete confirmation and deletes an agent', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'runner_1',
          name: 'Runner One',
          description: '',
          owner_name: 'owner',
          admin_name: 'admin',
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    expect(screen.getByText(/delete_confirm_title/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /delete_confirm_action/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('ws_1', 'proj_1', 'runner_1');
    });
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks read access', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canRunDiagnostics: false,
      canManage: false,
    });
    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('opens runner diagnostics panel from query parameter context', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams('runner=runner_1'));
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'runner_1',
          name: 'Runner One',
          description: 'Primary runner',
          owner_name: 'owner',
          admin_name: 'admin',
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Runner One')).toBeInTheDocument();
    });

    expect(screen.getByText('Primary runner')).toBeInTheDocument();
  });

  it('renders owner/admin fallback ids when name fields are missing', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'runner_2',
          name: 'Runner Two',
          description: '',
          owner_id: 'user_owner_1',
          admin_id: 'user_admin_1',
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Runner Two')).toBeInTheDocument();
    });

    expect(screen.getByText('user_owner_1')).toBeInTheDocument();
    expect(screen.getByText(/admin: user_admin_1/i)).toBeInTheDocument();
  });

  it('does not render legacy workload or runtime columns', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce(listResponse([
        buildRunner({
          id: 'runner_1',
          name: 'Managed Runner',
          description: 'Task runner',
          default_endpoint_id: 'ep_1',
          diagnostics: { queue_depth: 0 },
          capabilities: { terminal: true, artifacts: true },
        }),
      ]));

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Managed Runner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-runners__table')).not.toHaveTextContent(/chat|notebook|external|internal|docker|compose/i);
  });
});
