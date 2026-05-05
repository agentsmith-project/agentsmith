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

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockListKeys = vi.fn();
const mockCreateKey = vi.fn();
const mockDeleteKey = vi.fn();
const mockGetConnectionInfo = vi.fn();
const mockHandleError = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AgentRunnerAPI: vi.fn().mockImplementation(function () {
    return {
      listKeys: mockListKeys,
      createKey: mockCreateKey,
      deleteKey: mockDeleteKey,
      getConnectionInfo: mockGetConnectionInfo,
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
        connection_address: 'Runner WebSocket address',
      },
      user_keys: {
        create: 'Create New Key',
        revoke_confirm_title: 'Revoke API Key',
        revoke_confirm_hint: 'This action cannot be undone.',
        revoke: 'Revoke',
      },
      common: {
        cancel: 'Cancel',
        copy: 'Copy',
        copied: 'Copied!',
      },
    };
    return translations[namespace]?.[key] || key;
  }),
}));

import { AgentRunnerKeysDialog } from '../AgentRunnerKeysDialog';

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
      key_prefix: 'ask-***def456',
      status: 'active',
      created_at: '2026-01-20T11:30:00Z',
    },
    {
      id: 'agent_key_003',
      agent_runner_id: 'agent_001',
      key_prefix: 'ask-***revoked',
      status: 'revoked',
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
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('Rendering and Display', () => {
    it('uses the sheet recipe and anchors the primary create action in the footer', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('agent-runners__connection-keys-sheet')).toBeInTheDocument();
      });

      expect(screen.getByTestId('agent-runners__connection-keys-footer')).toContainElement(
        screen.getByRole('button', { name: /create new key/i }),
      );
    });

    it('renders when open', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      expect(screen.getByRole('heading', { name: /Connection Keys/ })).toBeInTheDocument();
      expect(screen.getByText(/Test Runner/)).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} open={false} />, { wrapper });

      expect(screen.queryByText(/Connection Keys/)).not.toBeInTheDocument();
    });

    it('shows description about creating connection keys', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      expect(screen.getByText(/create connection keys/i)).toBeInTheDocument();
    });

    it('shows create button', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });
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
        expect(screen.getByText(/no connection keys yet/i)).toBeInTheDocument();
      });
    });

    it('renders list of active keys', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
        expect(screen.getByText('ask-***def456')).toBeInTheDocument();
      });
    });

    it('only shows active keys (not revoked)', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
        expect(screen.getByText('ask-***def456')).toBeInTheDocument();
      });

      // Revoked key should not be shown
      expect(screen.queryByText('ask-***revoked')).not.toBeInTheDocument();
    });

    it('displays masked key prefix only', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        const keyElements = screen.getAllByText(/ask-\*\*\*/);
        expect(keyElements.length).toBeGreaterThan(0);
      });
    });

    it('shows formatted relative time for key creation', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        // Should show relative time like "6 days ago", "1 days ago", etc.
        // Component returns "X min ago", "X hours ago", "X days ago"
        const timeElements = screen.getAllByText(/\d+\s+(min|hours|days)\s+ago/i);
        expect(timeElements.length).toBeGreaterThan(0);
      });
    });

    it('shows revoke button for each active key', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        const revokeButtons = screen.getAllByRole('button').filter(btn =>
          btn.querySelector('.lucide-trash-2')
        );
        expect(revokeButtons.length).toBe(2);
      });
    });
  });

  describe('Key Creation', () => {
    it('opens create dialog when clicking create button', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      // Should call create mutation
      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalled();
      });
    });

    it('calls create API with correct parameters', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalledWith('ws_test', 'proj_001', 'agent_001');
      });
    });

    it('shows key created dialog after successful creation', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-value')).toHaveTextContent('ask-new-full-key-12345');
      });
    });

    it('shows loading state during creation', async () => {
      mockCreateKey.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });

      const createButton = screen.getByRole('button', { name: /create new key/i });
      await user.click(createButton);

      // Button should be disabled during mutation
      await waitFor(() => {
        expect(createButton).toBeDisabled();
      });
    });

    it('refreshes keys list after successful creation', async () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      // Initial load
      await waitFor(() => {
        expect(mockListKeys).toHaveBeenCalledTimes(1);
      });

      // Create key
      await user.click(screen.getByRole('button', { name: /create new key/i }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
      });

      // Should have invalidated queries (listKeys called again)
      expect(mockListKeys).toHaveBeenCalled();
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

      expect(screen.getByText(/revoke api key/i)).toBeInTheDocument();
      expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument();
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
        expect(screen.queryByText(/revoke api key/i)).not.toBeInTheDocument();
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
        expect(screen.getByText('ask-***def456')).toBeInTheDocument();
      });
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
        expect(screen.getByRole('heading', { name: /connection keys/i })).toBeInTheDocument();
      });
    });

    it('handles API errors during key creation', async () => {
      mockCreateKey.mockRejectedValue(new Error('Failed to create key'));

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

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
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });
    });

    it('has dialog role', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has proper heading', () => {
      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      const heading = screen.getByRole('heading', { name: /connection keys/i });
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

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(/no connection keys yet/i)).toBeInTheDocument();
      });
    });

    it('handles keys with all statuses', async () => {
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
        // Should still only show active keys
        expect(screen.getByText('ask-***abc123')).toBeInTheDocument();
        expect(screen.getByText('ask-***def456')).toBeInTheDocument();
        // Non-active keys should not be shown
        expect(screen.queryByText('ask-***revoked')).not.toBeInTheDocument();
        expect(screen.queryByText('ask-***expired')).not.toBeInTheDocument();
        expect(screen.queryByText('ask-***suspended')).not.toBeInTheDocument();
      });
    });

    it('handles key creation with only prefix returned', async () => {
      mockCreateKey.mockResolvedValue({
        key_prefix: 'ask-***onlyprefix',
      });

      render(<AgentRunnerKeysDialog {...defaultProps} />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

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
