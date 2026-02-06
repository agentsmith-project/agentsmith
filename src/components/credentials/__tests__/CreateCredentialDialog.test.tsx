/**
 * Tests for CreateCredentialDialog
 *
 * Security-focused tests for credential creation:
 * - Input validation (name, value)
 * - Show/hide password toggle
 * - Masked input display
 * - Form submission
 * - Error handling
 * - Security - values not exposed
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';

const mockCreate = vi.fn();
const mockHandleError = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  CredentialsAPI: vi.fn().mockImplementation(function () {
    return {
      create: mockCreate,
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

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      credentials: {
        create_dialog: {
          title: 'Create Credential',
          description: 'Add a new credential to your project',
          name: 'Name',
          name_placeholder: 'e.g., OpenAI API Key',
          value: 'Value',
          value_placeholder: 'Enter the credential value',
          show: 'Show',
          hide: 'Hide',
          success: 'Credential created successfully',
        },
      },
      common: {
        cancel: 'Cancel',
        create: 'Create',
      },
    };
    return translations[namespace]?.[key] || key;
  }),
}));

import { CreateCredentialDialog } from '../CreateCredentialDialog';

describe('CreateCredentialDialog', () => {
  const user = userEvent.setup();

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceId: 'ws_test',
    projectId: 'proj_001',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders when open', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      expect(screen.getByText('Create Credential')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<CreateCredentialDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Create Credential')).not.toBeInTheDocument();
    });

    it('displays dialog title and description', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      expect(screen.getByText('Create Credential')).toBeInTheDocument();
      expect(screen.getByText(/add a new credential/i)).toBeInTheDocument();
    });

    it('shows name input field', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveAttribute('placeholder', 'e.g., OpenAI API Key');
    });

    it('shows value input field', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i);
      expect(valueInput).toBeInTheDocument();
      expect(valueInput).toHaveAttribute('type', 'password');
    });

    it('shows password visibility toggle button', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('shows cancel button', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('shows create button', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    });
  });

  describe('Input Fields', () => {
    it('allows typing in name field', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My API Key');

      expect(nameInput).toHaveValue('My API Key');
    });

    it('allows typing in value field', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'sk-secret-key-12345');

      expect(valueInput).toHaveValue('sk-secret-key-12345');
    });

    it('trims whitespace from name input on submit', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, '  My Credential  ');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Credential',
          })
        );
      });
    });

    it('does not trim whitespace from value input', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, '  secret-value  ');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            value: '  secret-value  ',
          })
        );
      });
    });
  });

  describe('Password Visibility Toggle', () => {
    it('toggles password visibility when clicking toggle button', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i) as HTMLInputElement;
      const toggleButton = screen.getByRole('button', { name: /show/i });

      // Initially hidden
      expect(valueInput.type).toBe('password');

      // Show password
      await user.click(toggleButton);
      expect(valueInput.type).toBe('text');

      // Hide password
      await user.click(toggleButton);
      expect(valueInput.type).toBe('password');
    });

    it('changes toggle button aria-label', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });

      // Initially "Show"
      expect(toggleButton).toHaveAttribute('aria-label', 'Show');

      await user.click(toggleButton);

      // Changes to "Hide"
      expect(toggleButton).toHaveAttribute('aria-label', 'Hide');
    });

    it('shows eye icon when password is hidden', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      const eyeIcon = toggleButton.querySelector('svg');

      expect(eyeIcon).toBeInTheDocument();
    });

    it('shows eye-off icon when password is visible', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });

      await user.click(toggleButton);

      const eyeOffIcon = toggleButton.querySelector('svg');
      expect(eyeOffIcon).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('disables submit button when name is empty', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /create/i });
      expect(submitButton).toBeDisabled();
    });

    it('disables submit button when value is empty', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const submitButton = screen.getByRole('button', { name: /create/i });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit button when both fields have values', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      const submitButton = screen.getByRole('button', { name: /create/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('enables submit button when name has only whitespace but value has content', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, '   ');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      const submitButton = screen.getByRole('button', { name: /create/i });
      // Should be disabled because name.trim() is empty
      expect(submitButton).toBeDisabled();
    });

    it('does not submit form when clicking submit with empty name', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      const submitButton = screen.getByRole('button', { name: /create/i });
      await user.click(submitButton);

      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('does not submit form when clicking submit with empty value', async () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const submitButton = screen.getByRole('button', { name: /create/i });
      await user.click(submitButton);

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('Form Submission', () => {
    it('submits form with correct data', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'OpenAI API Key');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'sk-openai-key-12345');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith('ws_test', 'proj_001', {
          name: 'OpenAI API Key',
          type: 'api_key',
          value: 'sk-openai-key-12345',
        });
      });
    });

    it('closes dialog after successful creation', async () => {
      const onOpenChange = vi.fn();
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('calls onSuccess callback after successful creation', async () => {
      const onSuccess = vi.fn();
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} onSuccess={onSuccess} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('shows success toast after successful creation', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(require('@/components/ui/toast').toast.success).toHaveBeenCalledWith('Credential created successfully');
      });
    });

    it('resets form after successful creation', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });
      const onOpenChange = vi.fn();

      const { rerender } = render(
        <CreateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />
      );

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      // Reopen dialog
      rerender(<CreateCredentialDialog {...defaultProps} open={true} onOpenChange={onOpenChange} />);

      // Form should be reset
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
      expect(screen.getByLabelText(/value/i)).toHaveValue('');
    });

    it('shows loading state during submission', async () => {
      mockCreate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /create/i });
        expect(submitButton).toBeDisabled();
      });
    });

    it('shows spinner icon during submission', async () => {
      mockCreate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /create/i });
        const spinner = submitButton.querySelector('svg[class*="animate-spin"]');
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe('Dialog Closing', () => {
    it('closes when clicking cancel button', async () => {
      const onOpenChange = vi.fn();

      render(<CreateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('prevents closing while submitting', async () => {
      const onOpenChange = vi.fn();
      mockCreate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<CreateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      // Try to close via cancel while submitting
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      // Should not close because mutation is pending
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('resets form when opening dialog', async () => {
      const onOpenChange = vi.fn();

      const { rerender } = render(
        <CreateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />
      );

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      // Close and reopen
      onOpenChange(false);
      rerender(<CreateCredentialDialog {...defaultProps} open={false} onOpenChange={onOpenChange} />);

      rerender(<CreateCredentialDialog {...defaultProps} open={true} onOpenChange={onOpenChange} />);

      // Form should be reset
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
    });
  });

  describe('Error Handling', () => {
    it('handles API errors during creation', async () => {
      const error = new Error('Failed to create credential');
      mockCreate.mockRejectedValue(error);
      mockHandleError.mockImplementation(() => {});

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
        expect(mockHandleError).toHaveBeenCalledWith(error, { context: 'Create Credential' });
      });
    });

    it('does not close dialog on error', async () => {
      const onOpenChange = vi.fn();
      mockCreate.mockRejectedValue(new Error('Failed'));

      render(<CreateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });

      // Dialog should still be open
      expect(screen.getByText('Create Credential')).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe('Security', () => {
    it('never logs credential value to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'sk-secret-key-12345');

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalled();
      });

      const allLogs = consoleSpy.mock.calls.flat().join(' ');
      expect(allLogs).not.toContain('sk-secret-key-12345');

      consoleSpy.mockRestore();
    });

    it('masks value input by default', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i) as HTMLInputElement;
      expect(valueInput.type).toBe('password');
    });

    it('sends value unencrypted to API (API handles encryption)', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'sk-secret-key-12345');

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          'ws_test',
          'proj_001',
          expect.objectContaining({
            value: 'sk-secret-key-12345',
          })
        );
      });
    });

    it('always sends type as api_key', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          'ws_test',
          'proj_001',
          expect.objectContaining({
            type: 'api_key',
          })
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper labels for inputs', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/value/i)).toBeInTheDocument();
    });

    it('has required attribute on required inputs', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      const valueInput = screen.getByLabelText(/value/i);

      expect(nameInput).toBeRequired();
      expect(valueInput).toBeRequired();
    });

    it('has proper aria-label on password toggle', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      expect(toggleButton).toHaveAttribute('aria-label');
    });

    it('has dialog role', () => {
      render(<CreateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very long credential names', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'a'.repeat(1000));

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      const submitButton = screen.getByRole('button', { name: /create/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('handles very long credential values', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'a'.repeat(10000));

      const submitButton = screen.getByRole('button', { name: /create/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            value: 'a'.repeat(10000),
          })
        );
      });
    });

    it('handles special characters in credential name', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'Key (production) <test> & more');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, 'secret-value');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            name: 'Key (production) <test> & more',
          })
        );
      });
    });

    it('handles unicode characters in credential value', async () => {
      mockCreate.mockResolvedValue({ id: 'new_cred' });

      render(<CreateCredentialDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText(/name/i);
      await user.type(nameInput, 'My Credential');

      const valueInput = screen.getByLabelText(/value/i);
      await user.type(valueInput, '密钥-value-测试');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            value: '密钥-value-测试',
          })
        );
      });
    });
  });
});
