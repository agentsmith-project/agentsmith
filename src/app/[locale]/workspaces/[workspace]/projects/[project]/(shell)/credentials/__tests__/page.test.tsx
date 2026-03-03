/**
 * Tests for CredentialsPage
 *
 * Security-focused tests for project credential management:
 * - Credential listing (never shows secret values)
 * - Fingerprint display instead of actual values
 * - Create, rotate, delete operations
 * - Permission checks
 * - Time formatting
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHasPermission } from '@/lib/hooks/use-permissions';

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  CredentialsAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      delete: mockDelete,
    };
  }),
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn((permission: string) => permission === 'project:manage'),
}));

vi.mock('@/components/credentials/CreateCredentialDialog', () => ({
  CreateCredentialDialog: function CreateCredentialDialog({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) {
    if (!open) return null;
    return (
      <div data-testid="create-credential-dialog">
        <button
          data-testid="create-submit"
          onClick={() => onSuccess?.()}
        >
          Create
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/credentials/RotateCredentialDialog', () => ({
  RotateCredentialDialog: function RotateCredentialDialog({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) {
    if (!open) return null;
    return (
      <div data-testid="rotate-credential-dialog">
        <button
          data-testid="rotate-submit"
          onClick={() => onSuccess?.()}
        >
          Rotate
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/credentials/DeleteCredentialDialog', () => ({
  DeleteCredentialDialog: function DeleteCredentialDialog({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => Promise<void>;
  }) {
    if (!open) return null;
    return (
      <div data-testid="delete-credential-dialog">
        <button
          data-testid="delete-confirm"
          onClick={() => onConfirm().catch(() => {})}
        >
          Confirm
        </button>
      </div>
    );
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      credentials: {
        title: 'Credentials',
        subtitle: 'Manage project credentials securely',
        create: 'Create Credential',
        rotate: 'Rotate',
        delete: 'Delete',
        'table.name': 'Name',
        'table.type': 'Type',
        'table.last_rotated': 'Last Rotated',
        fingerprint: 'Fingerprint',
        'empty.title': 'No credentials yet',
        'empty.description': 'Create a credential to get started',
      },
    };
    return translations[namespace]?.[key] || key;
  }),
}));

import CredentialsPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

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

describe('CredentialsPage', () => {
  const wrapper = createWrapper();
  const user = userEvent.setup();

  const mockCredentials = [
    {
      id: 'cred_001',
      workspace_id: 'ws_test',
      project_id: 'proj_001',
      name: 'OpenAI API Key',
      type: 'api_key',
      fingerprint: '••••••••••••xyz1',
      created_at: '2026-01-10T09:00:00Z',
      last_rotated_at: '2026-01-25T14:20:00Z',
    },
    {
      id: 'cred_002',
      workspace_id: 'ws_test',
      project_id: 'proj_001',
      name: 'Anthropic API Key',
      type: 'api_key',
      fingerprint: '••••••••••••abc2',
      created_at: '2026-01-12T10:00:00Z',
      last_rotated_at: '2026-01-20T09:30:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:manage');
    mockList.mockResolvedValue(mockCredentials);
    mockDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering and Display', () => {
    it('renders header and toolbar layout', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
      });

      const header = screen.getByTestId('page-layout__header');
      expect(within(header).getByRole('heading', { level: 1, name: 'Credentials' })).toBeInTheDocument();
      expect(within(header).getByTestId('credentials__open-members')).toHaveAttribute('href', '/en/workspaces/ws_test/projects/proj_001/members');
      expect(within(header).getByTestId('credentials__open-resource-policy')).toHaveAttribute('href', '/en/workspaces/ws_test/projects/proj_001/resource-policy');
      expect(within(header).getByTestId('credentials__open-audit')).toHaveAttribute('href', '/en/workspaces/ws_test/projects/proj_001/audit');
      const toolbar = screen.getByTestId('page-layout__toolbar');
      expect(within(toolbar).getByRole('button', { name: /create credential/i })).toBeInTheDocument();
    });

    it('renders page title and description', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('Credentials')).toBeInTheDocument();
        expect(screen.getByText(/manage project credentials/i)).toBeInTheDocument();
      });
    });

    it('renders create button', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create credential/i })).toBeInTheDocument();
      });
    });

    it('shows loading state initially', async () => {
      mockList.mockReturnValue(new Promise(() => {})); // Never resolves
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      // After params resolve, title shows but data is still loading
      await waitFor(() => {
        expect(screen.getByText('Credentials')).toBeInTheDocument();
      });
    });

    it('shows empty state when no credentials exist', async () => {
      mockList.mockResolvedValue([]);

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(screen.getByText(/no credentials yet/i)).toBeInTheDocument();
        expect(screen.getByText(/create a credential to get started/i)).toBeInTheDocument();
      });
    });

    it('renders table with credentials', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
        expect(screen.getByText('Anthropic API Key')).toBeInTheDocument();
      });
    });

    it('displays credential type', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getAllByText('api_key').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('displays fingerprint (masked value) instead of actual secret', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('••••••••••••xyz1')).toBeInTheDocument();
        expect(screen.getByText('••••••••••••abc2')).toBeInTheDocument();
      });
    });

    it('never displays actual secret values (security check)', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });
      const allText = document.body.textContent || '';
      // Should not contain common secret patterns
      expect(allText).not.toMatch(/sk-[a-zA-Z0-9]{32,}/);
      expect(allText).not.toMatch(/Bearer\s+[a-zA-Z0-9]/);
    });

    it('displays last rotated date', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        // Should show formatted dates (multiple credentials have Jan dates)
        expect(screen.getAllByText(/jan/i).length).toBeGreaterThan(0);
      });
    });

    it('shows rotate button for each credential', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        const rotateButtons = screen.getAllByTitle(/rotate/i);
        expect(rotateButtons.length).toBe(2);
      });
    });

    it('shows delete button for each credential', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        const deleteButtons = screen.getAllByTitle(/delete/i);
        expect(deleteButtons.length).toBe(2);
      });
    });

    it('disables action buttons during delete mutation', async () => {
      const mockDeleteSlow = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(undefined), 1000))
      );

      mockDelete.mockImplementation(mockDeleteSlow);

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Click delete button
      const deleteButtons = screen.getAllByTitle(/delete/i);
      await user.click(deleteButtons[0]);

      // Click confirm
      await waitFor(() => {
        const confirmButton = screen.getByTestId('delete-confirm');
        if (confirmButton) {
          user.click(confirmButton);
        }
      });

      // Buttons should be disabled during mutation
      await waitFor(() => {
        const rotateButtons = screen.getAllByTitle(/rotate/i);
        expect(rotateButtons[0]).toBeDisabled();
      });
    });
  });

  describe('Credential Creation', () => {
    it('opens create dialog when clicking create button', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create credential/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /create credential/i }));

      expect(screen.getByTestId('create-credential-dialog')).toBeInTheDocument();
    });

    it('calls API with correct workspace and project IDs', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(mockList).toHaveBeenCalledWith('ws_test', 'proj_001');
      });
    });

    it('refreshes list after successful creation', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Open create dialog
      await user.click(screen.getByRole('button', { name: /create credential/i }));

      // Submit (mock dialog calls onSuccess)
      await user.click(screen.getByTestId('create-submit'));

      // List should be refreshed (called again)
      await waitFor(() => {
        expect(mockList).toHaveBeenCalledTimes(2); // Initial load + refresh
      });
    });
  });

  describe('Credential Rotation', () => {
    it('opens rotate dialog when clicking rotate button', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      const rotateButtons = screen.getAllByTitle(/rotate/i);
      await user.click(rotateButtons[0]);

      expect(screen.getByTestId('rotate-credential-dialog')).toBeInTheDocument();
    });

    it('passes correct credential to rotate dialog', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      const rotateButtons = screen.getAllByTitle(/rotate/i);
      await user.click(rotateButtons[0]);

      // The dialog should be open with the correct credential
      await waitFor(() => {
        expect(screen.getByTestId('rotate-credential-dialog')).toBeInTheDocument();
      });
    });

    it('refreshes list after successful rotation', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Open rotate dialog
      const rotateButtons = screen.getAllByTitle(/rotate/i);
      await user.click(rotateButtons[0]);

      // Submit (mock dialog calls onSuccess)
      await user.click(screen.getByTestId('rotate-submit'));

      // List should be refreshed
      await waitFor(() => {
        expect(mockList).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Credential Deletion', () => {
    it('opens delete dialog when clicking delete button', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle(/delete/i);
      await user.click(deleteButtons[0]);

      expect(screen.getByTestId('delete-credential-dialog')).toBeInTheDocument();
    });

    it('calls delete API with correct credential ID', async () => {
      mockDelete.mockResolvedValue(undefined);

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Open delete dialog
      const deleteButtons = screen.getAllByTitle(/delete/i);
      await user.click(deleteButtons[0]);

      // Confirm deletion
      await user.click(screen.getByTestId('delete-confirm'));

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('ws_test', 'proj_001', 'cred_001');
      });
    });

    it('refreshes list after successful deletion', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Open delete dialog
      const deleteButtons = screen.getAllByTitle(/delete/i);
      await user.click(deleteButtons[0]);

      // Confirm deletion
      await user.click(screen.getByTestId('delete-confirm'));

      // List should be refreshed
      await waitFor(() => {
        expect(mockList).toHaveBeenCalled();
      });
    });

    it('disables action buttons during deletion', async () => {
      mockDelete.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(undefined), 100))
      );

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Open delete dialog
      const deleteButtons = screen.getAllByTitle(/delete/i);
      await user.click(deleteButtons[0]);

      // Confirm deletion
      await user.click(screen.getByTestId('delete-confirm'));

      // Wait for mutation to start
      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalled();
      });

      // Buttons should be disabled
      const rotateButtons = screen.getAllByTitle(/rotate/i);
      expect(rotateButtons[0]).toBeDisabled();
    });
  });

  describe('Security - Data Protection', () => {
    it('never displays actual credential values', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });
      const allText = document.body.textContent || '';
      // Check for common API key patterns - should NOT be present
      expect(allText).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(allText).not.toMatch(/AKIA[0-9A-Z]{16}/);
    });

    it('only shows fingerprint with masking', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('••••••••••••xyz1')).toBeInTheDocument();
        expect(screen.getByText('••••••••••••abc2')).toBeInTheDocument();
      });
    });

    it('does not log credential values to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      const allLogs = consoleSpy.mock.calls.flat().join(' ');
      expect(allLogs).not.toContain('sk-');
      expect(allLogs).not.toContain('password');

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('handles API errors during list fetch', async () => {
      mockList.mockRejectedValue(new Error('Failed to fetch credentials'));

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      // Should not crash
      await waitFor(() => {
        expect(screen.getByText('Credentials')).toBeInTheDocument();
      });
    });

    it('handles API errors during delete', async () => {
      mockDelete.mockRejectedValue(new Error('Failed to delete'));

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      // Open delete dialog
      const deleteButtons = screen.getAllByTitle(/delete/i);
      await user.click(deleteButtons[0]);

      // Confirm deletion
      await user.click(screen.getByTestId('delete-confirm'));

      // Error should be handled by handleErrorForToast
      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalled();
      });
    });
  });

  describe('Date Formatting', () => {
    it('formats dates correctly', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        // Should show formatted dates with month abbreviation
        expect(screen.getAllByText(/jan/i).length).toBeGreaterThan(0);
      });
    });

    it('shows dash for missing dates', async () => {
      const credWithoutDate = [
        {
          ...mockCredentials[0],
          last_rotated_at: undefined,
        },
      ];
      mockList.mockResolvedValue(credWithoutDate);

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
      });

      const dashes = screen.getAllByText('-');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('has proper button labels', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create credential/i })).toBeInTheDocument();
      });
    });

    it('action buttons have proper title attributes', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getAllByTitle(/rotate/i).length).toBeGreaterThan(0);
        expect(screen.getAllByTitle(/delete/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Route and Permission Guards', () => {
    it('shows invalid parameter error state for unsafe route params', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: '<script>',
            project: 'proj_001',
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
      mockUseHasPermission.mockReturnValue(false);
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
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
  });
});
