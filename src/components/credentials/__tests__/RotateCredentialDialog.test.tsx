/**
 * Tests for RotateCredentialDialog
 *
 * Security-focused tests for credential rotation:
 * - New value input
 * - Show/hide password toggle
 * - Validation
 * - Submission
 * - Error handling
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';

const mockRotate = vi.fn();
const mockHandleError = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  CredentialsAPI: vi.fn().mockImplementation(function () {
    return {
      rotate: mockRotate,
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
        rotate_dialog: {
          title: 'Rotate Credential',
          description: 'Enter a new value for {name}',
          new_value: 'New Value',
          value_placeholder: 'Enter the new credential value',
          show: 'Show',
          hide: 'Hide',
          success: 'Credential rotated successfully',
        },
        rotate: 'Rotate',
      },
      common: {
        cancel: 'Cancel',
      },
    };
    // Handle template interpolation
    if (key === 'description') {
      return (params: { name: string }) => `Enter a new value for ${params.name}`;
    }
    return translations[namespace]?.[key] || key;
  }),
}));

import { RotateCredentialDialog } from '../RotateCredentialDialog';

describe('RotateCredentialDialog', () => {
  const user = userEvent.setup();

  const mockCredential = {
    id: 'cred_001',
    workspace_id: 'ws_test',
    project_id: 'proj_001',
    name: 'OpenAI API Key',
    type: 'api_key',
    fingerprint: '••••••••••••xyz1',
    created_at: '2026-01-10T09:00:00Z',
    last_rotated_at: '2026-01-25T14:20:00Z',
  };

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    credential: mockCredential,
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
    it('renders when open with credential', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByText('Rotate Credential')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<RotateCredentialDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Rotate Credential')).not.toBeInTheDocument();
    });

    it('does not render when credential is null', () => {
      render(<RotateCredentialDialog {...defaultProps} credential={null} />);

      expect(screen.queryByText('Rotate Credential')).not.toBeInTheDocument();
    });

    it('displays credential name in description', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByText(/enter a new value for openai api key/i)).toBeInTheDocument();
    });

    it('shows new value input field', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      expect(valueInput).toBeInTheDocument();
      expect(valueInput).toHaveAttribute('type', 'password');
    });

    it('shows password visibility toggle button', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('shows cancel button', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('shows rotate button', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /rotate/i })).toBeInTheDocument();
    });
  });

  describe('Input Field', () => {
    it('allows typing in value field', async () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'sk-new-secret-key-12345');

      expect(valueInput).toHaveValue('sk-new-secret-key-12345');
    });

    it('input is empty when dialog opens', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      expect(valueInput).toHaveValue('');
    });

    it('resets input when dialog is reopened', async () => {
      const onOpenChange = vi.fn();

      const { rerender } = render(
        <RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />
      );

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'some-value');

      // Close and reopen
      rerender(<RotateCredentialDialog {...defaultProps} open={false} onOpenChange={onOpenChange} />);
      rerender(<RotateCredentialDialog {...defaultProps} open={true} onOpenChange={onOpenChange} />);

      expect(screen.getByLabelText(/new value/i)).toHaveValue('');
    });

    it('resets input when credential changes', async () => {
      const { rerender } = render(
        <RotateCredentialDialog {...defaultProps} />
      );

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'some-value');

      const newCredential = { ...mockCredential, id: 'cred_002', name: 'Another Key' };
      rerender(<RotateCredentialDialog {...defaultProps} credential={newCredential} />);

      expect(screen.getByLabelText(/new value/i)).toHaveValue('');
    });
  });

  describe('Password Visibility Toggle', () => {
    it('toggles password visibility when clicking toggle button', async () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i) as HTMLInputElement;
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
      render(<RotateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });

      // Initially "Show"
      expect(toggleButton).toHaveAttribute('aria-label', 'Show');

      await user.click(toggleButton);

      // Changes to "Hide"
      expect(toggleButton).toHaveAttribute('aria-label', 'Hide');
    });
  });

  describe('Form Validation', () => {
    it('disables submit button when value is empty', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit button when value has content', async () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('disables submit button when value has only whitespace', async () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, '   ');

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      expect(submitButton).toBeDisabled();
    });

    it('does not submit form when clicking submit with empty value', async () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      await user.click(submitButton);

      expect(mockRotate).not.toHaveBeenCalled();
    });
  });

  describe('Form Submission', () => {
    it('submits with correct credential ID and new value', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001', fingerprint: '••••new' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'sk-new-key-12345');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalledWith(
          'ws_test',
          'proj_001',
          'cred_001',
          'sk-new-key-12345'
        );
      });
    });

    it('closes dialog after successful rotation', async () => {
      const onOpenChange = vi.fn();
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('calls onSuccess callback after successful rotation', async () => {
      const onSuccess = vi.fn();
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} onSuccess={onSuccess} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('shows success toast after successful rotation', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(require('@/components/ui/toast').toast.success).toHaveBeenCalledWith('Credential rotated successfully');
      });
    });

    it('resets form after successful rotation', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });
      const onOpenChange = vi.fn();

      const { rerender } = render(
        <RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />
      );

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      // Reopen dialog
      rerender(<RotateCredentialDialog {...defaultProps} open={true} onOpenChange={onOpenChange} />);

      // Form should be reset
      expect(screen.getByLabelText(/new value/i)).toHaveValue('');
    });

    it('shows loading state during submission', async () => {
      mockRotate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /rotate/i });
        expect(submitButton).toBeDisabled();
      });
    });

    it('shows spinner icon during submission', async () => {
      mockRotate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /rotate/i });
        const spinner = submitButton.querySelector('svg[class*="animate-spin"]');
        expect(spinner).toBeInTheDocument();
      });
    });

    it('throws error when credential is null during submit', async () => {
      render(<RotateCredentialDialog {...defaultProps} credential={null} />);

      // Dialog should not render, so no submission possible
      expect(screen.queryByText('Rotate Credential')).not.toBeInTheDocument();
    });
  });

  describe('Dialog Closing', () => {
    it('closes when clicking cancel button', async () => {
      const onOpenChange = vi.fn();

      render(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('prevents closing while submitting', async () => {
      const onOpenChange = vi.fn();
      mockRotate.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      // Try to close via cancel while submitting
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      // Should not close because mutation is pending
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe('Error Handling', () => {
    it('handles API errors during rotation', async () => {
      const error = new Error('Failed to rotate credential');
      mockRotate.mockRejectedValue(error);
      mockHandleError.mockImplementation(() => {});

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalled();
        expect(mockHandleError).toHaveBeenCalledWith(error, { context: 'Rotate Credential' });
      });
    });

    it('does not close dialog on error', async () => {
      const onOpenChange = vi.fn();
      mockRotate.mockRejectedValue(new Error('Failed'));

      render(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalled();
      });

      // Dialog should still be open
      expect(screen.getByText('Rotate Credential')).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe('Security', () => {
    it('never logs new credential value to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'sk-new-secret-key-12345');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalled();
      });

      const allLogs = consoleSpy.mock.calls.flat().join(' ');
      expect(allLogs).not.toContain('sk-new-secret-key-12345');

      consoleSpy.mockRestore();
    });

    it('masks value input by default', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i) as HTMLInputElement;
      expect(valueInput.type).toBe('password');
    });

    it('sends value unencrypted to API (API handles encryption)', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'sk-new-secret-key-12345');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          'sk-new-secret-key-12345'
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper label for input', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByLabelText(/new value/i)).toBeInTheDocument();
    });

    it('has required attribute on input', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      expect(valueInput).toBeRequired();
    });

    it('has proper aria-label on password toggle', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      expect(toggleButton).toHaveAttribute('aria-label');
    });

    it('has dialog role', () => {
      render(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very long credential values', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'a'.repeat(10000));

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          'a'.repeat(10000)
        );
      });
    });

    it('handles special characters in credential value', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'key-with_special.chars/12345');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          'key-with_special.chars/12345'
        );
      });
    });

    it('handles unicode characters in credential value', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      render(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, '新密钥-new-key');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          '新密钥-new-key'
        );
      });
    });

    it('handles credential name with special characters in description', () => {
      const specialCredential = {
        ...mockCredential,
        name: 'Key (production) <test> & more',
      };

      render(<RotateCredentialDialog {...defaultProps} credential={specialCredential} />);

      // Should display the special name in description
      expect(screen.getByText(/key \(production\)/i)).toBeInTheDocument();
    });
  });
});
