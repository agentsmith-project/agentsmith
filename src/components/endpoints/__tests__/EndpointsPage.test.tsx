import * as React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Endpoint } from '@/lib/api/types';
import type { AgentTaskModelSettingReadinessReasonCode } from '@/lib/api/types';

const mocks = vi.hoisted(() => ({
  mockListEndpoints: vi.fn(),
  mockDeleteEndpoint: vi.fn(),
  mockUpdateEndpoint: vi.fn(),
  mockImportBulk: vi.fn(),
  mockGetAgentTaskModelSetting: vi.fn(),
  mockUpdateAgentTaskModelSetting: vi.fn(),
  mockSyncModelCatalog: vi.fn(),
  mockUseEndpointPageCapabilities: vi.fn(),
  mockUseResolvedProjectRoute: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function EndpointAPI() {
    return {
      list: mocks.mockListEndpoints,
      delete: mocks.mockDeleteEndpoint,
      update: mocks.mockUpdateEndpoint,
      importBulk: mocks.mockImportBulk,
      getAgentTaskModelSetting: mocks.mockGetAgentTaskModelSetting,
      updateAgentTaskModelSetting: mocks.mockUpdateAgentTaskModelSetting,
    };
  }),
  ModelConfigAPI: vi.fn().mockImplementation(function ModelConfigAPI() {
    return {
      syncModelCatalog: mocks.mockSyncModelCatalog,
    };
  }),
  APIError: class APIError extends Error {},
  resolveApiErrorPresentation: vi.fn(() => ({ title: 'Error', description: 'Failed' })),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useEndpointPageCapabilities: mocks.mockUseEndpointPageCapabilities,
}));

vi.mock('@/lib/hooks/use-resolved-project-route', () => ({
  useResolvedProjectRoute: mocks.mockUseResolvedProjectRoute,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../CreateEndpointDialog', () => ({
  CreateEndpointDialog: ({ open }: { open: boolean }) => (
    open ? <div data-testid="endpoints__create-dialog" /> : null
  ),
}));

vi.mock('../EditEndpointDialog', () => ({
  EditEndpointDialog: ({ open }: { open: boolean }) => (
    open ? <div data-testid="endpoints__edit-dialog" /> : null
  ),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'common.cancel': 'Cancel',
      'endpoints.title': 'Endpoints',
      'endpoints.subtitle': 'Manage endpoints',
      'endpoints.create': 'Create Endpoint',
      'endpoints.import': 'Import',
      'endpoints.export': 'Export',
      'endpoints.sync_catalog': 'Sync Catalog',
      'endpoints.status_active': 'Active',
      'endpoints.status_disabled': 'Disabled',
      'endpoints.action_edit': 'Edit',
      'endpoints.action_delete': 'Delete',
      'endpoints.action_disable': 'Disable',
      'endpoints.action_enable': 'Enable',
      'endpoints.action_menu': 'Actions',
      'endpoints.action_use_for_agent_tasks': 'Use for Agent tasks',
      'endpoints.agent_task_model.title': 'Agent task model',
      'endpoints.agent_task_model.loading': 'Checking setup',
      'endpoints.agent_task_model.ready': 'Ready',
      'endpoints.agent_task_model.needs_setup': 'Needs setup',
      'endpoints.agent_task_model.unavailable': 'Agent task model readiness is temporarily unavailable.',
      'endpoints.agent_task_model.default_model_label': 'Default model',
      'endpoints.agent_task_model.selected_badge': 'Agent task model',
      'endpoints.agent_task_model.updated_label': 'Updated',
      'endpoints.agent_task_model.setup_next_step_title': 'Set up Agent task model',
      'endpoints.agent_task_model.setup_next_step_description': 'Choose an eligible Endpoint from the list.',
      'endpoints.agent_task_model.update_failed': 'Failed to update Agent task model',
      'endpoints.table.provider': 'Provider',
      'endpoints.table.name': 'Name',
      'endpoints.table.model': 'Model',
      'endpoints.table.capability': 'Capability',
      'endpoints.table.health': 'Health',
      'endpoints.table.pricing': 'Pricing',
      'endpoints.table.pricing_input': 'Input',
      'endpoints.table.pricing_output': 'Output',
      'endpoints.table.admin_status': 'Status',
      'endpoints.table.upstream_protocol': 'Upstream Protocol',
      'endpoints.create_dialog.capability_chat_completion': 'Chat Completion',
      'endpoints.create_dialog.capability_multimodal_completion': 'Multimodal Completion',
      'endpoints.protocol_labels.openai_responses': 'OpenAI Responses',
      'endpoints.protocol_labels.openai_chat_completions': 'OpenAI Chat Completions',
      'endpoints.protocol_labels.anthropic_messages': 'Anthropic Messages',
      'errors.validation_error': 'Validation error',
      'errors.badRequest.description': 'Bad route',
      'errors.permission_denied_title': 'Permission denied',
      'errors.permission_denied_hint': 'Ask an admin.',
    };
    const scopedKey = namespace ? `${namespace}.${key}` : key;
    const template = translations[scopedKey] ?? translations[key] ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
  },
}));

import { EndpointsPageView } from '../EndpointsPage';
import { toast } from '@/components/ui/toast';

function action(visible: boolean, allowed: boolean, reasonCode?: AgentTaskModelSettingReadinessReasonCode) {
  return {
    operation: 'use_for_agent_tasks' as const,
    visible,
    allowed,
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    required_permissions: ['project:governance:update'],
    danger_level: 'none' as const,
  };
}

function endpoint(overrides: Partial<Endpoint> & { agent_task_model_selected?: boolean }): Endpoint {
  return {
    id: 'ep_base',
    project_id: 'proj_1',
    name: 'Base Endpoint',
    model: 'gpt-5.5',
    type: 'catalog',
    base_url: 'https://provider.example/v1',
    status: 'active',
    provider_family: 'openai',
    upstream_protocol: 'openai_responses',
    capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-5.5' }],
    defaults: { chat_model_id: 'gpt-5.5' },
    actions: {
      use_for_agent_tasks: action(true, true),
    },
    created_at: '2026-05-07T00:00:00.000Z',
    updated_at: '2026-05-07T00:00:00.000Z',
    ...overrides,
  } as unknown as Endpoint;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EndpointsPageView
        params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en-US' })}
      />
    </QueryClientProvider>,
  );
}

describe('EndpointsPageView Agent task model setting UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseEndpointPageCapabilities.mockReturnValue({
      canRead: true,
      canManage: false,
    });
    mocks.mockUseResolvedProjectRoute.mockReturnValue({
      isReady: true,
      isValid: true,
      workspace: 'ws_1',
      project: 'proj_1',
      locale: 'en-US',
    });
    mocks.mockListEndpoints.mockResolvedValue({
      items: [
        endpoint({
          id: 'ep_selected',
          name: 'OpenAI production',
          model: 'gpt-5.5',
          agent_task_model_selected: true,
          actions: { use_for_agent_tasks: action(true, true) },
        }),
        endpoint({
          id: 'ep_candidate',
          name: 'Anthropic backup',
          model: 'claude-sonnet-4-5',
          provider_family: 'anthropic',
          upstream_protocol: 'anthropic_messages',
          agent_task_model_selected: false,
          actions: { use_for_agent_tasks: action(true, true) },
        }),
        endpoint({
          id: 'ep_locally_ready_but_hidden',
          name: 'Locally ready but hidden',
          model: 'gpt-5.5-mini',
          agent_task_model_selected: false,
          actions: { use_for_agent_tasks: action(false, false, 'agent_task_model_policy_denied') },
        }),
      ],
      total: 3,
      page: 1,
      page_size: 3,
      has_more: false,
    });
    mocks.mockGetAgentTaskModelSetting.mockResolvedValue({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
      setting: {
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        endpoint_id: 'ep_selected',
        endpoint_display_name: 'OpenAI production',
        default_model: 'gpt-5.5',
        setting_revision: 'set_7',
        updated_at: '2026-05-07T00:00:00.000Z',
        updated_by_user_id: 'user_1',
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
    mocks.mockUpdateAgentTaskModelSetting.mockResolvedValue({
      readiness: {
        state: 'ready',
        display_summary: 'Agent tasks are ready to run.',
      },
      setting: {
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        endpoint_id: 'ep_candidate',
        endpoint_display_name: 'Anthropic backup',
        default_model: 'claude-sonnet-4-5',
        setting_revision: 'set_8',
        updated_at: '2026-05-07T00:05:00.000Z',
        updated_by_user_id: 'user_1',
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
  });

  it('renders setting summary, selected row badge, and backend-owned row action without endpoint manage permission', async () => {
    const user = userEvent.setup();
    renderPage();

    const summary = await screen.findByTestId('endpoints__agent-task-model-summary');
    expect(summary).toHaveTextContent('Agent task model');
    await waitFor(() => {
      expect(summary).toHaveTextContent('Agent tasks are ready to run.');
      expect(summary).toHaveTextContent('OpenAI production');
      expect(summary).toHaveTextContent('gpt-5.5');
    });

    const rowForName = (name: string) => screen.getAllByText(name)
      .map((element) => element.closest('tr'))
      .find((row): row is HTMLTableRowElement => row !== null);
    const selectedRow = rowForName('OpenAI production');
    const candidateRow = rowForName('Anthropic backup');
    const hiddenRow = rowForName('Locally ready but hidden');
    expect(selectedRow).not.toBeNull();
    expect(candidateRow).not.toBeNull();
    expect(hiddenRow).not.toBeNull();

    expect(within(selectedRow as HTMLElement).getByText('Agent task model')).toBeInTheDocument();
    expect(within(selectedRow as HTMLElement).queryByRole('button', { name: 'Use for Agent tasks' })).not.toBeInTheDocument();
    expect(within(candidateRow as HTMLElement).queryByText('Agent task model')).not.toBeInTheDocument();
    const candidateUseButton = within(candidateRow as HTMLElement).getByRole('button', { name: 'Use for Agent tasks' });
    expect(candidateUseButton).toHaveTextContent('Use for Agent tasks');
    expect(candidateUseButton).toHaveClass('whitespace-nowrap');
    expect(within(hiddenRow as HTMLElement).queryByRole('button', { name: 'Use for Agent tasks' })).not.toBeInTheDocument();

    await user.click(candidateUseButton);

    await waitFor(() => {
      expect(mocks.mockUpdateAgentTaskModelSetting).toHaveBeenCalledWith(
        'ws_1',
        'proj_1',
        {
          endpoint_id: 'ep_candidate',
          expected_setting_revision: 'set_7',
        },
      );
    });
  });

  it('uses null CAS for first Agent task model configuration without exposing reason enums', async () => {
    const user = userEvent.setup();
    mocks.mockGetAgentTaskModelSetting.mockResolvedValueOnce({
      readiness: {
        state: 'not_configured',
        display_summary: 'Agent task model is not configured.',
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
    mocks.mockListEndpoints.mockResolvedValueOnce({
      items: [
        endpoint({
          id: 'ep_candidate',
          name: 'Anthropic backup',
          model: 'claude-sonnet-4-5',
          provider_family: 'anthropic',
          upstream_protocol: 'anthropic_messages',
          agent_task_model_selected: false,
          actions: { use_for_agent_tasks: action(true, true) },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 1,
      has_more: false,
    });

    renderPage();

    const summary = await screen.findByTestId('endpoints__agent-task-model-summary');
    await waitFor(() => {
      expect(summary).toHaveTextContent('Agent task model is not configured.');
    });
    expect(summary).toHaveTextContent('Needs setup');
    expect(summary).not.toHaveTextContent('agent_task_model_setting_missing');

    await user.click(await screen.findByRole('button', { name: 'Use for Agent tasks' }));

    await waitFor(() => {
      expect(mocks.mockUpdateAgentTaskModelSetting).toHaveBeenCalledWith(
        'ws_1',
        'proj_1',
        {
          endpoint_id: 'ep_candidate',
          expected_setting_revision: null,
        },
      );
    });
  });

  it('does not send a first-config null CAS when the setting query has not loaded successfully', async () => {
    const user = userEvent.setup();
    mocks.mockGetAgentTaskModelSetting.mockRejectedValueOnce(new Error('setting_unavailable'));
    mocks.mockListEndpoints.mockResolvedValueOnce({
      items: [
        endpoint({
          id: 'ep_candidate',
          name: 'Anthropic backup',
          model: 'claude-sonnet-4-5',
          provider_family: 'anthropic',
          upstream_protocol: 'anthropic_messages',
          agent_task_model_selected: false,
          actions: { use_for_agent_tasks: action(true, true) },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 1,
      has_more: false,
    });

    renderPage();

    const summary = await screen.findByTestId('endpoints__agent-task-model-summary');
    await waitFor(() => {
      expect(summary).toHaveTextContent('Agent task model readiness is temporarily unavailable.');
    });
    await user.click(await screen.findByRole('button', { name: 'Use for Agent tasks' }));

    expect(mocks.mockUpdateAgentTaskModelSetting).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Failed to update Agent task model');
  });
});
