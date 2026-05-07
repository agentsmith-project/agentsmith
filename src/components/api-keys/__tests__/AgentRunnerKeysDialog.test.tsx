/**
 * Tests for Agent Runners connection keys dialog
 *
 * Security-focused tests for runner connection key management:
 * - Key listing (masked)
 * - Key creation
 * - Key revocation
 * - Loading states
 * - Empty states
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  AgentRunnerActionAffordance,
  AgentRunnerActionOperation,
  AgentRunnerActions,
  AgentRunnerTestTaskRunAcceptedResponse,
} from '@/lib/api/types';

const mockListKeys = vi.fn();
const mockCreateKey = vi.fn();
const mockDeleteKey = vi.fn();
const mockGetConnectionInfo = vi.fn();
const mockTestConnection = vi.fn();
const mockCreateTestTaskRun = vi.fn();
const mockHandleError = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AgentRunnerAPI: vi.fn().mockImplementation(function () {
    return {
      listKeys: mockListKeys,
      createKey: mockCreateKey,
      deleteKey: mockDeleteKey,
      getConnectionInfo: mockGetConnectionInfo,
      testConnection: mockTestConnection,
      createTestTaskRun: mockCreateTestTaskRun,
    };
  }),
}));

vi.mock('@/lib/hooks/use-api-error', () => ({
  useApiError: vi.fn(() => ({
    handleError: mockHandleError,
    error: null,
    clearError: vi.fn(),
    retry: vi.fn(),
    setError: vi.fn(),
    isVisible: false,
  })),
}));

vi.mock('@/components/api-keys/KeyCreatedDialog', () => ({
  KeyCreatedDialog: function KeyCreatedDialog({ open, keyValue, keyPrefix }: { open: boolean; keyValue: string | null; keyPrefix?: string }) {
    if (!open) return null;
    return (
      <div data-testid="key-created-dialog">
        <div data-testid="key-value">{keyValue || 'NO_KEY'}</div>
        <div data-testid="key-prefix">{keyPrefix || 'NO_PREFIX'}</div>
      </div>
    );
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      agent_runners: {
        keys_title: 'Connection Keys',
        keys_description: 'Create connection keys for this Agent Runner',
        keys_empty: 'No connection keys yet',
        connection_key_title: 'Connection key',
        connection_key_description: 'Use one active connection key to connect this Developer runner. Issuing a new key replaces the current key.',
        connection_key_empty: 'No active connection key yet. Create one before connecting a runner.',
        connection_key_current_title: 'Current connection key',
        connection_key_issue_action: 'Issue connection key',
        connection_key_revoke_confirm_title: 'Revoke connection key',
        connection_key_revoke_confirm_hint: 'Revoking this key immediately stops runner connections using it.',
        connection_key_revoke_action: 'Revoke',
        connection_address: 'Runner WebSocket address',
        system_managed_read_only_notice: 'System managed runners are read-only in this project.',
        developer_checks_title: 'Developer runner checks',
        sheet_state_system_managed_read_only_title: 'System managed runner',
        sheet_state_system_managed_read_only_description: 'This runner is managed by the system side. Connection keys are read-only here.',
        sheet_state_no_active_key_title: 'No active connection key',
        sheet_state_no_active_key_description: 'Create a key before connecting a Developer runner.',
        sheet_state_key_issued_secret_shown_once_title: 'Key issued',
        sheet_state_key_issued_secret_shown_once_description: 'Save the one-time secret, then start the runner with this key.',
        sheet_state_waiting_for_connection_title: 'Waiting for runner connection',
        sheet_state_waiting_for_connection_description: 'Start the runner, then use Test connection to update its connection status.',
        sheet_state_connected_fresh_title: 'Connected recently',
        sheet_state_connected_fresh_description: 'The latest check found the runner connected.',
        sheet_state_connection_stale_title: 'Connection needs another check',
        sheet_state_connection_stale_description: 'The runner has not checked in recently. Reconnect it and check again.',
        sheet_state_disconnected_title: 'Runner is not connected',
        sheet_state_disconnected_description: 'This key does not have a connected runner right now.',
        sheet_state_test_connection_warning_title: 'Connection check needs attention',
        sheet_state_test_connection_warning_description: 'The connection was checked, but runner capability or warning details need attention.',
        sheet_state_test_connection_failed_title: 'Connection check failed',
        sheet_state_test_connection_failed_description: 'The check could not complete. Retry after confirming the runner is reachable.',
        sheet_state_actions_disabled_title: 'Connection changes unavailable',
        sheet_state_actions_disabled_description: 'Connection changes are not available right now.',
        sheet_state_reason_action_disabled: 'Not available right now',
        unavailable_keys_title: 'Unavailable key history',
        unavailable_key_status_revoked: 'Revoked',
        unavailable_key_status_expired: 'Expired',
        unavailable_key_history_hint: 'Historical keys cannot connect a runner.',
        test_connection_action: 'Test connection',
        run_test_task_action: 'Run test task',
        test_connection_result_connected: 'Connection check passed',
        test_connection_result_disconnected: 'Connection unavailable',
        run_test_task_unavailable: 'Runner test task is not available yet.',
        run_test_task_model_setup_blocked: 'Project model setup blocks test tasks.',
        run_test_task_result_accepted: 'Runner test task accepted',
        runner_test_badge: 'runner_test',
        runner_test_source_label: 'Source',
        runner_test_source_value: 'Developer runner test',
        runner_test_run_reference: 'Run reference',
        runner_test_task_reference: 'Task reference',
      },
      user_keys: {
        create: 'Create New Key',
        revoke_confirm_title: 'Revoke API Key',
        revoke_confirm_hint: 'This action cannot be undone.',
        revoke: 'Revoke',
      },
      common: {
        cancel: 'Cancel',
        done: 'Done',
        copy: 'Copy',
        copied: 'Copied!',
      },
    };
    return translations[namespace]?.[key] || key;
  }),
}));

import { AgentRunnerKeysDialog } from '../AgentRunnerKeysDialog';

function action(
  operation: AgentRunnerActionOperation,
  visible = false,
  allowed = false,
  reasonCode?: string,
): AgentRunnerActionAffordance {
  const affordance: AgentRunnerActionAffordance = {
    operation,
    visible,
    allowed,
    required_permissions: [],
    danger_level: operation === 'delete' ? 'high' : 'none',
  };
  return reasonCode ? { ...affordance, reason_code: reasonCode } : affordance;
}

function runnerActions(overrides: Partial<AgentRunnerActions> = {}): AgentRunnerActions {
  const base: AgentRunnerActions = {
    set_project_default: action('set_project_default'),
    bind_to_task: action('bind_to_task'),
    run_test_task: action('run_test_task'),
    edit: action('edit'),
    disable: action('disable'),
    delete: action('delete'),
    issue_connection_key: action('issue_connection_key', true, true),
    revoke_connection_key: action('revoke_connection_key', true, true),
    test_connection: action('test_connection', true, true),
    view_diagnostics: action('view_diagnostics', true, true),
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

describe('AgentRunnerKeysDialog', () => {
  const wrapper = createWrapper();
  const user = userEvent.setup();

  const mockKeys = [
    {
      id: 'agent_key_001',
      agent_runner_id: 'agent_001',
      key_prefix: 'ask-***abc123',
      status: 'active',
      created_at: '2026-01-15T10:00:00Z',
    },
    {
      id: 'agent_key_002',
      agent_runner_id: 'agent_001',
      key_prefix: 'ask-***revoked',
      status: 'revoked',
      created_at: '2026-01-20T11:30:00Z',
    },
    {
      id: 'agent_key_003',
      agent_runner_id: 'agent_001',
      key_prefix: 'ask-***expired',
      status: 'expired',
      created_at: '2026-01-10T09:00:00Z',
    },
  ];

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceId: 'ws_test',
    projectId: 'proj_001',
    runnerId: 'agent_001',
    runnerName: 'Test Runner',
    runnerKind: 'developer' as const,
    readOnly: false,
    runnerStatus: 'ready' as const,
    actions: runnerActions({
      run_test_task: action('run_test_task', true, true),
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set fixed date to make relative time tests deterministic
    // Mock dates are from Jan 10-20, 2026, so we set system time to Jan 21, 2026
    vi.setSystemTime(new Date('2026-01-21T12:00:00Z'));
    mockListKeys.mockResolvedValue(mockKeys);
    mockCreateKey.mockResolvedValue({
      key: 'ask-new-full-key-12345',
      key_prefix: 'ask-***new123',
    });
    mockDeleteKey.mockResolvedValue(undefined);
    mockGetConnectionInfo.mockResolvedValue({
      ws_url: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=agent_001',
      agent_runner_id: 'agent_001',
      protocol_version: '1.0',
      heartbeat_interval_sec: 15,
    });
    mockTestConnection.mockResolvedValue({
      agent_runner_id: 'agent_001',
      status: 'connected',
      checked_at: '2026-01-21T12:00:00Z',
      timeout_ms: 5000,
      capabilities: { task_execution: true },
      freshness: { state: 'fresh', active_connection_count: 1 },
      errors: [],
    });
    mockCreateTestTaskRun.mockRejectedValue(new Error('runner test task unavailable'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('Rendering and Display', () => {
    it('uses the sheet recipe and anchors the primary create action in the footer', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__connection-keys-sheet')).toBeInTheDocument();
      });

      expect(screen.getByTestId('agent-runners__connection-keys-footer')).toContainElement(
        screen.getByRole('button', { name: /issue connection key/i }),
      );
    });

    it('renders when open', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      expect(screen.getByRole('heading', { name: /Connection key/ })).toBeInTheDocument();
      expect(screen.getByText(/Test Runner/)).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} open={false} />, { wrapper });

      expect(screen.queryByText(/Connection key/)).not.toBeInTheDocument();
    });

    it('shows single active connection key guidance', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      expect(screen.getByText(/one active connection key/i)).toBeInTheDocument();
    });

    it('shows create key only when no active key exists', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });
    });

    it('hides create key while an active key exists', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /issue connection key/i })).not.toBeInTheDocument();
      expect(mockCreateKey).not.toHaveBeenCalled();
    });

    it('hides Developer connection mutations for System managed runners', async () => {
      render(
        <AgentRunnerKeysDialog
          {...defaultProps}
          runnerKind="system_managed"
          readOnly
          runnerStatus="ready"
          actions={runnerActions({
            issue_connection_key: action('issue_connection_key', true, true),
            revoke_connection_key: action('revoke_connection_key', true, true),
            test_connection: action('test_connection', true, true),
            run_test_task: action('run_test_task', true, true),
          })}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText(/read-only in this project/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /issue connection key/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /run test task/i })).not.toBeInTheDocument();
      expect(mockListKeys).not.toHaveBeenCalled();
      expect(mockGetConnectionInfo).not.toHaveBeenCalled();
    });

    it('disables Developer connection operations when backend affordances deny them', async () => {
      mockListKeys.mockResolvedValue([]);

      render(
        <AgentRunnerKeysDialog
          {...defaultProps}
          actions={runnerActions({
            issue_connection_key: action('issue_connection_key', true, false),
            revoke_connection_key: action('revoke_connection_key', true, false),
            test_connection: action('test_connection', true, false),
            run_test_task: action('run_test_task', true, false),
          })}
        />,
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeDisabled();
      });
      expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
    });

    it('runs Test connection from the Developer sheet affordance without enabling test task before a connection check', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(mockTestConnection).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001', { timeout_ms: 5000 });
      });
      expect(screen.getByText(/connection check passed/i)).toBeInTheDocument();
      expect(screen.queryByText(/connection passed/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
    });

    it('shows model-setting blockers for Developer test tasks without turning them into connection failures', async () => {
      render(
        <AgentRunnerKeysDialog
          {...defaultProps}
          actions={runnerActions({
            run_test_task: action('run_test_task', true, false, 'agent_task_model_setting_missing'),
          })}
        />,
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/connection check passed/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
      expect(screen.getByText('Project model setup blocks test tasks.')).toBeInTheDocument();
      expect(screen.queryByText(/connection check failed/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('agent-runners__sheet-state')).not.toHaveAttribute('data-state', 'test_connection_failed');
    });

    it('shows accepted runner_test task evidence as safe labeled UI instead of a raw status string', async () => {
      mockCreateTestTaskRun.mockResolvedValueOnce({
        status: 'accepted',
        runner_test: true,
        task_id: 'task_runner_test_001',
        run_id: 'run_runner_test_001',
        resolved_runner_id: 'agent_001',
      });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: /test connection/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: /run test task/i }));

      await waitFor(() => {
        expect(mockCreateTestTaskRun).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001', {
          intent: 'developer_runner_connection_check',
        });
      });
      const result = screen.getByTestId('agent-runners__runner-test-task-result');
      expect(result).toHaveTextContent(/runner_test/i);
      expect(result).toHaveTextContent(/Developer runner test/i);
      expect(result).toHaveTextContent(/Run reference: run_runner_test_001/i);
      expect(result).toHaveTextContent(/Task reference: task_runner_test_001/i);
      expect(result).not.toHaveTextContent('accepted: run_runner_test_001');
    });

    it('clears accepted runner_test evidence when the next run test task attempt is unavailable', async () => {
      let rejectSecondRun: ((error: Error) => void) | null = null;
      const secondRun = new Promise<AgentRunnerTestTaskRunAcceptedResponse>((_, reject) => {
        rejectSecondRun = reject;
      });
      mockCreateTestTaskRun
        .mockResolvedValueOnce({
          status: 'accepted',
          runner_test: true,
          task_id: 'task_runner_test_001',
          run_id: 'run_runner_test_001',
          resolved_runner_id: 'agent_001',
        })
        .mockReturnValueOnce(secondRun);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: /test connection/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: /run test task/i }));
      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__runner-test-task-result')).toHaveTextContent(
          /Run reference: run_runner_test_001/i,
        );
      });
      expect(screen.getByText(/Task reference: task_runner_test_001/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /run test task/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
      });
      expect(screen.queryByText(/Run reference: run_runner_test_001/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Task reference: task_runner_test_001/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-runners__runner-test-task-result')).not.toBeInTheDocument();

      await act(async () => {
        rejectSecondRun?.(new Error('runner test task unavailable'));
        await secondRun.catch(() => undefined);
      });

      await waitFor(() => {
        expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error), { context: 'Run test task' });
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
      expect(screen.queryByText(/Run reference: run_runner_test_001/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Task reference: task_runner_test_001/i)).not.toBeInTheDocument();
    });

    it('shows a no-active-key state and keeps connection CTAs blocked before key issue', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText(/no active connection key/i)).toBeInTheDocument();
      });

      const state = screen.getByTestId('agent-runners__sheet-state');
      expect(state).toHaveAttribute('data-state', 'no_active_key');
      expect(state).toHaveTextContent(/create a key before connecting/i);
      expect(screen.getByRole('button', { name: /issue connection key/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
    });

    it('does not show revoked or expired key history in daily UI', async () => {
      mockListKeys.mockResolvedValue([
        {
          id: 'agent_key_revoked_only',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***oldrev',
          status: 'revoked',
          created_at: '2026-01-10T09:00:00Z',
        },
        {
          id: 'agent_key_expired_only',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***oldexp',
          status: 'expired',
          created_at: '2026-01-09T09:00:00Z',
        },
      ]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'no_active_key');
      });
      expect(screen.queryByTestId('agent-runners__connection-keys-active-count')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-runners__connection-keys-unavailable-history')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***oldrev')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***oldexp')).not.toBeInTheDocument();
      expect(screen.queryByText(/historical keys cannot connect/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    });

    it('moves to waiting-for-connection copy after issuing a key and does not keep old connection status', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText(/no active connection key/i)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001');
      });
      const state = screen.getByTestId('agent-runners__sheet-state');
      expect(state).toHaveAttribute('data-state', 'key_issued_secret_shown_once');
      expect(state).toHaveTextContent(/key issued/i);
      expect(state).toHaveTextContent(/save the one-time secret/i);
      expect(state).toHaveTextContent(/waiting for runner connection/i);
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
      expect(screen.queryByText(/connection check passed/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /issue connection key/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
      expect(screen.getByTestId('key-created-dialog')).not.toHaveTextContent(/agent-execution|localhost:20000|websocket/i);
    });

    it('shows connected-fresh state without promising a live ping', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'connected_fresh');
      });
      const state = screen.getByTestId('agent-runners__sheet-state');
      expect(state).toHaveTextContent(/latest check found the runner connected/i);
      expect(state).not.toHaveTextContent(/live ping/i);
      expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
    });

    it('keeps Run test task disabled for stale connection status', async () => {
      mockTestConnection.mockResolvedValueOnce({
        agent_runner_id: 'agent_001',
        status: 'stale',
        checked_at: '2026-01-21T12:00:00Z',
        timeout_ms: 5000,
        capabilities: { task_execution: true },
        freshness: { state: 'stale', active_connection_count: 1, last_seen_at: '2026-01-21T11:30:00Z' },
        errors: [{ code: 'agent_runner_stale', message: 'agent_runner_stale' }],
      });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'connection_stale');
      });
      expect(screen.getByText(/connection needs another check/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
    });

    it('keeps Run test task disabled for disconnected connection checks', async () => {
      mockTestConnection.mockResolvedValueOnce({
        agent_runner_id: 'agent_001',
        status: 'disconnected',
        checked_at: '2026-01-21T12:00:00Z',
        timeout_ms: 5000,
        capabilities: { task_execution: true },
        freshness: { state: 'missing', active_connection_count: 0 },
        errors: [{ code: 'agent_runner_disconnected', message: 'agent_runner_disconnected' }],
      });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'disconnected');
      });
      expect(screen.getByText(/runner is not connected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
    });

    it('shows a warning state for fresh presence with capability warnings while keeping CTA driven by affordances', async () => {
      mockTestConnection.mockResolvedValueOnce({
        agent_runner_id: 'agent_001',
        status: 'connected',
        checked_at: '2026-01-21T12:00:00Z',
        timeout_ms: 5000,
        capabilities: { task_execution: false },
        freshness: { state: 'fresh', active_connection_count: 1 },
        errors: [],
      });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'test_connection_warning');
      });
      expect(screen.getByText(/connection check needs attention/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
    });

    it('shows failure recovery copy when Test connection request fails', async () => {
      mockTestConnection.mockRejectedValueOnce(new Error('network unavailable'));

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: /test connection/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'test_connection_failed');
      });
      expect(screen.getByText(/connection check failed/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
      expect(mockHandleError).toHaveBeenCalled();
    });

    it('renders visible denied affordances disabled with safe reason copy', async () => {
      mockListKeys.mockResolvedValue([]);

      render(
        <AgentRunnerKeysDialog
          {...defaultProps}
          runnerStatus="offline"
          actions={runnerActions({
            issue_connection_key: action('issue_connection_key', true, false, 'provider_disabled'),
            revoke_connection_key: action('revoke_connection_key', true, false, 'provider_disabled'),
            test_connection: action('test_connection', true, false, 'agent_runner_disconnected'),
            run_test_task: action('run_test_task', true, false, 'agent_runner_disconnected'),
          })}
        />,
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeDisabled();
      });
      const state = screen.getByTestId('agent-runners__sheet-state');
      expect(state).toHaveAttribute('data-state', 'actions_disabled');
      expect(state).toHaveTextContent(/connection changes unavailable/i);
      expect(state).toHaveTextContent(/not available right now/i);
      expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
    });

    it('hides actions when backend affordances mark them invisible', async () => {
      render(
        <AgentRunnerKeysDialog
          {...defaultProps}
          actions={runnerActions({
            issue_connection_key: action('issue_connection_key', false, false),
            revoke_connection_key: action('revoke_connection_key', false, false),
            test_connection: action('test_connection', false, false),
            run_test_task: action('run_test_task', false, false),
          })}
        />,
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /issue connection key/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /run test task/i })).not.toBeInTheDocument();
    });

    it('does not enable Run test task until the current check is connected and fresh', async () => {
      mockTestConnection
        .mockResolvedValueOnce({
          agent_runner_id: 'agent_001',
          status: 'connected',
          checked_at: '2026-01-21T12:00:00Z',
          timeout_ms: 5000,
          capabilities: { task_execution: true },
          freshness: { state: 'stale', active_connection_count: 1, last_seen_at: '2026-01-21T11:30:00Z' },
          errors: [],
        })
        .mockResolvedValueOnce({
          agent_runner_id: 'agent_001',
          status: 'connected',
          checked_at: '2026-01-21T12:02:00Z',
          timeout_ms: 5000,
          capabilities: { task_execution: true },
          freshness: { state: 'fresh', active_connection_count: 1 },
          errors: [],
        });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: /test connection/i }));
      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'connection_stale');
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: /test connection/i }));
      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__sheet-state')).toHaveAttribute('data-state', 'connected_fresh');
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
    });

    it('shows loading state initially', () => {
      mockListKeys.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows empty state when no keys', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText(/no active connection key yet/i)).toBeInTheDocument();
      });
    });

    it('renders the current active connection key', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });
      expect(screen.getByText('Current connection key')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-runners__connection-keys-active-count')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***revoked')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***expired')).not.toBeInTheDocument();
    });

    it('shows only the newest active connection key when the backend returns multiple active rows', async () => {
      mockListKeys.mockResolvedValue([
        {
          id: 'agent_key_newest',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***newest',
          status: 'active',
          created_at: '2026-01-21T11:00:00Z',
        },
        {
          id: 'agent_key_older',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***older',
          status: 'active',
          created_at: '2026-01-20T11:00:00Z',
        },
      ]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('ask-***newest')).toBeInTheDocument();
      });
      expect(screen.queryByText('ask-***older')).not.toBeInTheDocument();
      expect(screen.getByTestId('agent-runners__connection-keys-active-list')).toHaveTextContent('ask-***newest');
      expect(screen.queryByTestId('agent-runners__connection-keys-row--agent_key_older')).not.toBeInTheDocument();
    });

    it('hides revoked metadata instead of showing daily history', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });

      const activeList = screen.getByTestId('agent-runners__connection-keys-active-list');
      expect(within(activeList).queryByText('ask-***revoked')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-runners__connection-keys-unavailable-history')).not.toBeInTheDocument();
      expect(screen.queryByText(/historical keys cannot connect/i)).not.toBeInTheDocument();
    });

    it('displays masked key prefix only', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        const keyElements = screen.getAllByText(/ask-\*\*\*/);
        expect(keyElements.length).toBeGreaterThan(0);
      });
    });

    it('shows formatted relative time for key creation', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        // Should show relative time like "6 days ago", "1 days ago", etc.
        // Component returns "X min ago", "X hours ago", "X days ago"
        const timeElements = screen.getAllByText(/\d+\s+(min|hours|days)\s+ago/i);
        expect(timeElements.length).toBeGreaterThan(0);
      });
    });

    it('shows a revoke button for the current active connection key', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        const revokeButtons = screen.getAllByRole('button').filter(btn =>
          btn.querySelector('.lucide-trash-2')
        );
        expect(revokeButtons.length).toBe(1);
      });
    });
  });

  describe('Key Creation', () => {
    it('opens create dialog when clicking create button', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      // Should call create mutation
      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalled();
      });
    });

    it('calls create API with correct parameters', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001');
      });
    });

    it('shows key created dialog after successful creation', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-value')).toHaveTextContent('ask-new-full-key-12345');
      });
    });

    it('shows loading state during creation', async () => {
      mockListKeys.mockResolvedValue([]);
      mockCreateKey.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });

      const createButton = screen.getByRole('button', { name: /issue connection key/i });
      await user.click(createButton);

      // Button should be disabled during mutation
      await waitFor(() => {
        expect(createButton).toBeDisabled();
      });
    });

    it('refreshes keys list after successful creation', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      // Initial load
      await waitFor(() => {
        expect(mockListKeys).toHaveBeenCalledTimes(1);
      });

      // Create key
      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
      });

      // Should have invalidated queries (listKeys called again)
      expect(mockListKeys).toHaveBeenCalled();
    });

    it('does not offer a second key while an active key exists after a connection check', async () => {
      const localUser = userEvent.setup();
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });

      await localUser.click(screen.getByRole('button', { name: /test connection/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
      });
      expect(screen.getByText(/connection check passed/i)).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /issue connection key/i })).not.toBeInTheDocument();
      expect(mockCreateKey).not.toHaveBeenCalled();
    });
  });

  describe('Key Revocation', () => {
    it('opens revoke confirmation when clicking revoke button', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);

      expect(screen.getByText(/revoke connection key/i)).toBeInTheDocument();
      expect(screen.getByText(/immediately stops runner connections/i)).toBeInTheDocument();
    });

    it('confirms revocation and calls API', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);
      await user.click(screen.getByRole('button', { name: /revoke/i }));

      await waitFor(() => {
        expect(mockDeleteKey).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001', 'agent_key_001');
      });
    });

    it('closes revoke dialog on cancel', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText(/revoke connection key/i)).not.toBeInTheDocument();
      });
    });

    it('refreshes keys list after successful revocation', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(mockListKeys).toHaveBeenCalledTimes(1);
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);
      await user.click(screen.getByRole('button', { name: /revoke/i }));

      await waitFor(() => {
        expect(mockDeleteKey).toHaveBeenCalled();
      });

      // Query should be invalidated
      expect(mockListKeys).toHaveBeenCalled();
    });

    it('clears connected status and disables Run test task after revoking a key', async () => {
      const localUser = userEvent.setup();
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
      });

      await localUser.click(screen.getByRole('button', { name: /test connection/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /run test task/i })).toBeEnabled();
      });
      expect(screen.getByText(/connection check passed/i)).toBeInTheDocument();

      await localUser.click(screen.getByTestId('agent-runners__connection-keys-revoke--agent_key_001'));
      await localUser.click(screen.getByRole('button', { name: /revoke/i }));

      await waitFor(() => {
        expect(mockDeleteKey).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001', 'agent_key_001');
      });
      expect(screen.getByRole('button', { name: /run test task/i })).toBeDisabled();
      expect(screen.queryByText(/connection check passed/i)).not.toBeInTheDocument();
    });
  });

  describe('Security - Data Protection', () => {
    it('never displays full key value', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        const allText = screen.getByRole('dialog').textContent || '';
        // Should not contain full key pattern
        expect(allText).not.toMatch(/ask-[a-zA-Z0-9]{20,}/);
      });
    });

    it('only shows masked key prefix', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });
      expect(screen.queryByText('ask-***revoked')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***expired')).not.toBeInTheDocument();
    });

    it('does not log key values to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });

      const allLogs = consoleSpy.mock.calls.flat().join(' ');
      expect(allLogs).not.toContain('ask-new-full-key-12345');

      consoleSpy.mockRestore();
    });
  });

  describe('Query Behavior', () => {
    it('does not fetch keys when dialog is closed', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} open={false} />, { wrapper });

      expect(mockListKeys).not.toHaveBeenCalled();
    });

    it('fetches keys when dialog opens', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} open={true} />, { wrapper });

      expect(mockListKeys).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001');
    });

    it('enables query only when all IDs are available', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      expect(mockListKeys).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('handles API errors during list fetch', async () => {
      mockListKeys.mockRejectedValue(new Error('Failed to fetch keys'));

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      // Should not crash
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /connection key/i })).toBeInTheDocument();
      });
    });

    it('handles API errors during key creation', async () => {
      mockListKeys.mockResolvedValue([]);
      mockCreateKey.mockRejectedValue(new Error('Failed to create key'));

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      // Error is handled by handleErrorForToast
      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalled();
      });
    });

    it('handles API errors during revocation', async () => {
      mockDeleteKey.mockRejectedValue(new Error('Failed to revoke key'));

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);
      await user.click(screen.getByRole('button', { name: /revoke/i }));

      await waitFor(() => {
        expect(mockDeleteKey).toHaveBeenCalled();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper button labels', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });
    });

    it('has dialog role', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has proper heading', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      const heading = screen.getByRole('heading', { name: /connection key/i });
      expect(heading).toBeInTheDocument();
    });
  });

  describe('Dialog State Management', () => {
    it('calls onOpenChange when requested', () => {
      const onOpenChange = vi.fn();

      render(<AgentRunnerKeysDialog {...defaultProps} onOpenChange={onOpenChange} />, { wrapper });

      // The dialog itself doesn't have a close button in this mock,
      // but the parent can control it via the open prop
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe('Runner Name Display', () => {
    it('displays runner name in title', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} runnerName="My Special Runner" />, { wrapper });

      expect(screen.getByText(/My Special Runner/)).toBeInTheDocument();
    });

    it('handles runner name with special characters', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} runnerName="Runner (v2) - Test" />, { wrapper });

      expect(screen.getByText(/Runner \(v2\)/i)).toBeInTheDocument();
    });

    it('handles very long runner names', () => {
      const longName = 'Runner '.repeat(50);
      render(<AgentRunnerKeysDialog {...defaultProps} runnerName={longName} />, { wrapper });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Key Row Component', () => {
    it('displays key prefix in monospace font', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        const keyElement = screen.getByText('ask-***abc123');
        expect(keyElement.tagName.toLowerCase()).toBe('code');
      });
    });

    it('displays key icon', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        const keyIcons = dialog.querySelectorAll('.lucide-key');
        expect(keyIcons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles empty key list', async () => {
      mockListKeys.mockResolvedValue([]);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText(/no active connection key yet/i)).toBeInTheDocument();
      });
    });

    it('handles keys with all statuses without treating historical metadata as active', async () => {
      const allStatusKeys = [
        ...mockKeys,
        {
          id: 'agent_key_004',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***expired',
          status: 'expired',
          created_at: '2025-12-01T00:00:00Z',
        },
        {
          id: 'agent_key_005',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***suspended',
          status: 'suspended',
          created_at: '2026-01-10T11:00:00Z',
        },
      ];
      mockListKeys.mockResolvedValue(allStatusKeys);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
      });
      const activeList = screen.getByTestId('agent-runners__connection-keys-active-list');
      expect(within(activeList).queryByText('ask-***revoked')).not.toBeInTheDocument();
      expect(within(activeList).queryByText('ask-***expired')).not.toBeInTheDocument();
      expect(within(activeList).queryByText('ask-***suspended')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-runners__connection-keys-unavailable-history')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***revoked')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***expired')).not.toBeInTheDocument();
      expect(screen.queryByText('ask-***suspended')).not.toBeInTheDocument();
    });

    it('handles key creation with only prefix returned', async () => {
      mockListKeys.mockResolvedValue([]);
      mockCreateKey.mockResolvedValue({
        key_prefix: 'ask-***onlyprefix',
      });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /issue connection key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /issue connection key/i }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-value')).toHaveTextContent('NO_KEY');
        expect(screen.getByTestId('key-prefix')).toHaveTextContent('ask-***onlyprefix');
      });
    });

    it('handles very long key prefixes', async () => {
      const longPrefixKeys = [
        {
          id: 'agent_key_001',
          agent_runner_id: 'agent_001',
          key_prefix: 'ask-***' + 'a'.repeat(100),
          status: 'active' as const,
          created_at: '2026-01-15T10:00:00Z',
        },
      ];
      mockListKeys.mockResolvedValue(longPrefixKeys);

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(/ask-\*\*\*a{20,}/)).toBeInTheDocument();
      });
    });
  });
});
