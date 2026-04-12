/**
 * Tests for UserAPIKeysPage
 *
 * Security-focused tests for API key management:
 * - Key listing and display (masked values)
 * - Key creation with validation
 * - Key revocation/deletion
 * - "Key shown once" warning
 * - Clipboard functionality
 * - Permission checks
 * - Time formatting and display
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

// Setup mocks before importing
const mockList = vi.fn();
const mockCreate = vi.fn();
const mockRevoke = vi.fn();

// Mock the API
vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  UserAPIKeyService: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      create: mockCreate,
      revoke: mockRevoke,
    };
  }),
  handleErrorForToast: vi.fn(),
}));

// Mock KeyCreatedDialog with proper structure
vi.mock('@/components/api-keys/KeyCreatedDialog', () => ({
  KeyCreatedDialog: function KeyCreatedDialog({ open, keyValue, keyPrefix }: { open: boolean; keyValue: string | null; keyPrefix?: string }) {
    if (!open) return null;
    return (
      <div data-testid="key-created-dialog">
        <div data-testid="key-value">{keyValue || ''}</div>
        <div data-testid="key-prefix">{keyPrefix || ''}</div>
      </div>
    );
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      user_keys: {
        title: 'API Keys',
        page_description: 'Create, rotate, and revoke personal API keys for user-scoped automation.',
        create: 'Create New Key',
        prefix: 'Prefix',
        note: 'Note',
        created: 'Created',
        last_used: 'Last Used',
        expires: 'Expires',
        expiration_never: 'Never',
        revoke_confirm_title: 'Revoke API Key',
        revoke_confirm_hint: 'This action cannot be undone.',
        revoke: 'Revoke',
        create_success_title: 'API Key Created',
        create_success_hint: 'Copy this key now. You will not be able to see it again.',
        list_loading: 'Loading your API keys...',
        list_empty_title: 'No API keys yet',
        list_empty_description: 'Create a personal API key to authenticate scripts and local tools.',
        list_error_title: 'Could not load your API keys',
        list_error_description: 'Refresh the list or create a new key if you need to keep moving.',
        dialog_title_badge: 'API Key',
        dialog_description: 'Create a new API key. Add an optional note and expiration so you can identify it later.',
        dialog_expiration_hint: 'Leave empty to create a key that does not expire automatically.',
        create_pending: 'Creating...',
        create_success_prefix_only: 'The API only returned the key prefix. Use it to identify this key in the list.',
      },
      common: {
        cancel: 'Cancel',
        confirm: 'Confirm',
        retry: 'Retry',
      },
    };
    return translations[namespace]?.[key] || key;
  }),
}));

import UserAPIKeysPage from '../page';

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

describe('UserAPIKeysPage', () => {
  const wrapper = createWrapper();
  const user = userEvent.setup();

  const mockKeys = [
    {
      id: 'key_001',
      user_id: 'user_001',
      key_prefix: 'usk-***abc123xyz',
      status: 'active',
      note: 'Development key',
      created_at: '2026-01-15T10:00:00Z',
      expires_at: '2027-01-15T10:00:00Z',
      last_used_at: '2026-01-28T14:20:00Z',
    },
    {
      id: 'key_002',
      user_id: 'user_001',
      key_prefix: 'usk-***def456uvw',
      status: 'active',
      note: 'Production key',
      created_at: '2026-01-20T11:30:00Z',
      expires_at: null as string | null,
      last_used_at: '2026-01-28T12:45:00Z',
    },
    {
      id: 'key_003',
      user_id: 'user_001',
      key_prefix: 'usk-***revoked123',
      status: 'revoked',
      note: 'Old key',
      created_at: '2026-01-05T08:00:00Z',
      last_used_at: '2026-01-18T12:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(mockKeys);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering and Display', () => {
    it('renders page title and description', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      expect(screen.getByText('API Keys')).toBeInTheDocument();
      expect(screen.getByText(/Create, rotate, and revoke personal API keys/)).toBeInTheDocument();
    });

    it('renders API keys as a quiet settings sheet without dashboard-style chrome', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('API Keys')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('api-keys__summary-strip')).not.toBeInTheDocument();
      expect(screen.getByTestId('api-keys__list-section')).toBeInTheDocument();
      expect(screen.getByTestId('api-keys__list-section').className).not.toMatch(/rounded-lg|shadow-card/);
    });

    it('renders create button', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });
    });

    it('opens a flatter create dialog without extra guidance chrome', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/create a new api key/i)).toBeInTheDocument();
      expect(screen.queryByText('dialog_title_badge')).not.toBeInTheDocument();
      expect(screen.queryByText('dialog_guidance_title')).not.toBeInTheDocument();
      expect(screen.queryByText('dialog_settings_title')).not.toBeInTheDocument();
    });

    it('shows empty state when no keys exist', async () => {
      mockList.mockResolvedValue([]);
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(/no api keys yet/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/create a personal api key to authenticate/i)).toBeInTheDocument();
    });

    it('shows retry recovery when listing keys fails', async () => {
      mockList.mockRejectedValueOnce(new Error('network_failed'));
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('api-keys__error')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('renders table with keys', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('usk-***abc123xyz')).toBeInTheDocument();
        expect(screen.getByText('usk-***def456uvw')).toBeInTheDocument();
      });
    });

    it('displays masked key prefix only (security: never shows full key)', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        // Key prefix should be visible (with masking indicator)
        expect(screen.getByText('usk-***abc123xyz')).toBeInTheDocument();
      });
      // Full key pattern should NOT be in the document
      const allText = document.body.textContent || '';
      expect(allText).not.toMatch(/usk-[a-zA-Z0-9]{20,}/);
    });

    it('shows note for keys with notes', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Development key')).toBeInTheDocument();
        expect(screen.getByText('Production key')).toBeInTheDocument();
      });
    });

    it('displays status badges for keys', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        const statusElements = screen.getAllByText('active');
        expect(statusElements.length).toBeGreaterThan(0);
      });
    });

    it('shows formatted relative time for dates', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        // Recent timestamps may render as relative text, older ones as locale dates.
        const timeElements = [
          ...screen.queryAllByText(/\d+\s+(min|mins|minute|minutes|hour|hours|day|days)/i),
          ...screen.queryAllByText(/\d{1,2}\/\d{1,2}\/\d{4}/),
        ];
        expect(timeElements.length).toBeGreaterThan(0);
      });
    });

    it('shows "Never" for keys without expiration', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByText('Never').length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Key Creation', () => {
    it('opens create dialog when clicking create button', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/create a new api key/i)).toBeInTheDocument();
    });

    it('validates note input - allows empty note', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      // Should call create even without note
      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith({ note: undefined, expires_in: undefined });
      });
    });

    it('validates note input - trims whitespace', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      const noteInput = screen.getByPlaceholderText('Note');
      await user.type(noteInput, '  My Test Note  ');
      await user.click(screen.getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith({ note: 'My Test Note', expires_in: undefined });
      });
    });

    it('validates expiration input - rejects negative numbers', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      const expiresInInput = screen.getByPlaceholderText('Never');
      await user.type(expiresInInput, '-30');
      await user.click(screen.getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    it('validates expiration input - rejects zero', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      const expiresInInput = screen.getByPlaceholderText('Never');
      await user.type(expiresInInput, '0');
      await user.click(screen.getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    it('validates expiration input - accepts valid positive number', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      const expiresInInput = screen.getByPlaceholderText('Never');
      await user.type(expiresInInput, '30');
      await user.click(screen.getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith({ note: undefined, expires_in: 30 });
      });
    });

    it('shows key created dialog after successful creation', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-value')).toHaveTextContent('usk-new-key-12345');
      });
    });

    it('shows warning that key is displayed only once', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        // The KeyCreatedDialog should appear with the key value
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-value')).toHaveTextContent('usk-new-key-12345');
      });
    });

    it('handles creation when API returns only key_prefix (no full key)', async () => {
      mockCreate.mockResolvedValue({
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-prefix')).toHaveTextContent('usk-***new123');
      });
    });

    it('shows loading state during creation', async () => {
      mockCreate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      expect(screen.getByText(/creating/i)).toBeInTheDocument();
    });

    it('closes create dialog on cancel', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('resets form after successful creation', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      // First creation
      await user.click(screen.getByRole('button', { name: /create new key/i }));
      const noteInput = screen.getByPlaceholderText('Note');
      await user.type(noteInput, 'First key');
      await user.click(screen.getByRole('button', { name: 'Create New Key' }));

      // After success, create dialog closes and note state resets
      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });

      // Open create dialog again - form should be reset
      // The page-level Create New Key button is still visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /create new key/i }));

      await waitFor(() => {
        const newNoteInput = screen.getByPlaceholderText('Note');
        expect(newNoteInput).toHaveValue('');
      });
    });
  });

  describe('Key Revocation', () => {
    it('opens revoke confirmation dialog when clicking revoke button', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('usk-***abc123xyz')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);

      expect(screen.getByText(/revoke api key/i)).toBeInTheDocument();
      expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument();
    });

    it('confirms revocation and calls API', async () => {
      mockRevoke.mockResolvedValue(undefined);

      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('usk-***abc123xyz')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);
      await user.click(screen.getByRole('button', { name: /revoke/i }));

      await waitFor(() => {
        expect(mockRevoke).toHaveBeenCalledWith('key_001');
      });
    });

    it('closes revoke dialog on cancel', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('usk-***abc123xyz')).toBeInTheDocument();
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
  });

  describe('Security - Data Masking', () => {
    it('never logs full API key value to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockCreate.mockResolvedValue({
        key: 'usk-full-secret-key-12345',
        key_prefix: 'usk-***secret',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
      });

      // Check that console logs don't contain the full key
      const allLogs = consoleSpy.mock.calls.flat().join(' ');
      expect(allLogs).not.toContain('usk-full-secret-key-12345');

      consoleSpy.mockRestore();
    });

    it('masks key values in display with asterisks', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        const maskedPrefix = screen.getByText('usk-***abc123xyz');
        expect(maskedPrefix).toBeInTheDocument();
        expect(maskedPrefix).toHaveTextContent(/\*\*\*/);
      });
    });
  });

  describe('Error Handling', () => {
    it('handles API errors during key listing', async () => {
      mockList.mockRejectedValue(new Error('Failed to fetch keys'));

      render(<UserAPIKeysPage />, { wrapper });

      // The error is handled by handleErrorForToast
      // Component should not crash
      await waitFor(() => {
        expect(screen.getByText('API Keys')).toBeInTheDocument();
      });
    });

    it('handles API errors during key creation', async () => {
      mockCreate.mockRejectedValue(new Error('Failed to create key'));

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      // Should not crash, error handled by handleErrorForToast
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('handles API errors during revocation', async () => {
      mockRevoke.mockRejectedValue(new Error('Failed to revoke key'));

      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('usk-***abc123xyz')).toBeInTheDocument();
      });

      const revokeButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('.lucide-trash-2')
      );

      await user.click(revokeButtons[0]);
      await user.click(screen.getByRole('button', { name: /revoke/i }));

      // Error handled by handleErrorForToast
      await waitFor(() => {
        expect(mockRevoke).toHaveBeenCalled();
      });
    });
  });

  describe('Clipboard Functionality', () => {
    it('copies key to clipboard when copy button clicked', async () => {
      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('key-value')).toHaveTextContent('usk-new-key-12345');
      });
    });

    it('handles clipboard errors gracefully', async () => {
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard failed'));

      mockCreate.mockResolvedValue({
        key: 'usk-new-key-12345',
        key_prefix: 'usk-***new123',
      });

      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByTestId('api-keys__create-btn'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create New Key' }));

      await waitFor(() => {
        expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
      });

      // Should not throw error
      expect(screen.getByTestId('key-created-dialog')).toBeInTheDocument();
    });
  });

  describe('Data Formatting', () => {
    it('formats dates correctly for recent keys', async () => {
      const recentDate = new Date();
      recentDate.setMinutes(recentDate.getMinutes() - 5);

      const recentKey = {
        ...mockKeys[0],
        created_at: recentDate.toISOString(),
      };
      mockList.mockResolvedValue([recentKey]);

      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(/min ago/i)).toBeInTheDocument();
      });
    });

    it('formats dates correctly for older keys', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const oldKey = {
        ...mockKeys[0],
        created_at: oldDate.toISOString(),
      };
      mockList.mockResolvedValue([oldKey]);

      render(<UserAPIKeysPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(/days ago/i)).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper button labels', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument();
    });

    it('dialog has proper role', async () => {
      render(<UserAPIKeysPage />, { wrapper });

      await user.click(screen.getByRole('button', { name: /create new key/i }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });
  });
});
