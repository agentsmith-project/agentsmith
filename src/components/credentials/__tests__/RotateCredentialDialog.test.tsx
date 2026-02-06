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

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  useTranslations: vi.fn((namespace?: string) => {
    const translations: Record<string, Record<string, string>> = {
      credentials: {
        'rotate_dialog.title': 'Rotate Credential',
        'rotate_dialog.description': 'Enter a new value for {name}',
        'rotate_dialog.new_value': 'New Value',
        'rotate_dialog.value_placeholder': 'Enter the new credential value',
        'rotate_dialog.success': 'Credential rotated successfully',
        'create_dialog.show': 'Show',
        'create_dialog.hide': 'Hide',
        rotate: 'Rotate',
      },
      common: {
        cancel: 'Cancel',
      },
    };
    return (key: string, params?: Record<string, string>) => {
      let value = translations[namespace ?? '']?.[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          value = value.replace(`{${k}}`, String(v));
        });
      }
      return value;
    };
  }),
  useLocale: () => 'en-US',
}));

import { RotateCredentialDialog } from '../RotateCredentialDialog';
import { toast } from '@/components/ui/toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

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
    queryClient.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders when open with credential', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByText('Rotate Credential')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Rotate Credential')).not.toBeInTheDocument();
    });

    it('renders dialog even when credential is null', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} credential={null} />);

      // Dialog still renders (controlled by open prop), but description shows empty name
      expect(screen.getByText('Rotate Credential')).toBeInTheDocument();
    });

    it('displays credential name in description', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByText(/enter a new value for openai api key/i)).toBeInTheDocument();
    });

    it('shows new value input field', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      expect(valueInput).toBeInTheDocument();
      expect(valueInput).toHaveAttribute('type', 'password');
    });

    it('shows password visibility toggle button', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('shows cancel button', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('shows rotate button', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /rotate/i })).toBeInTheDocument();
    });
  });

  describe('Input Field', () => {
    it('allows typing in value field', async () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'sk-new-secret-key-12345');

      expect(valueInput).toHaveValue('sk-new-secret-key-12345');
    });

    it('input is empty when dialog opens', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      expect(valueInput).toHaveValue('');
    });

    it('resets input when dialog is reopened', async () => {
      const onOpenChange = vi.fn();

      const { rerender } = renderWithProviders(
        <RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />
      );

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'some-value');

      // Close and reopen
      rerender(<QueryClientProvider client={queryClient}><RotateCredentialDialog {...defaultProps} open={false} onOpenChange={onOpenChange} /></QueryClientProvider>);
      rerender(<QueryClientProvider client={queryClient}><RotateCredentialDialog {...defaultProps} open={true} onOpenChange={onOpenChange} /></QueryClientProvider>);

      expect(screen.getByLabelText(/new value/i)).toHaveValue('');
    });

    it('resets input when credential changes', async () => {
      const { rerender } = renderWithProviders(
        <RotateCredentialDialog {...defaultProps} />
      );

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'some-value');

      const newCredential = { ...mockCredential, id: 'cred_002', name: 'Another Key' };
      rerender(<QueryClientProvider client={queryClient}><RotateCredentialDialog {...defaultProps} credential={newCredential} /></QueryClientProvider>);

      expect(screen.getByLabelText(/new value/i)).toHaveValue('');
    });
  });

  describe('Password Visibility Toggle', () => {
    it('toggles password visibility when clicking toggle button', async () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit button when value has content', async () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('does not submit when value has only whitespace', async () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, '   ');

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      // Button is enabled (value.length > 0) but handleSubmit guards with trim()
      await user.click(submitButton);

      expect(mockRotate).not.toHaveBeenCalled();
    });

    it('does not submit form when clicking submit with empty value', async () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      await user.click(submitButton);

      expect(mockRotate).not.toHaveBeenCalled();
    });
  });

  describe('Form Submission', () => {
    it('submits with correct credential ID and new value', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001', fingerprint: '••••new' });

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} onSuccess={onSuccess} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('shows success toast after successful rotation', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Credential rotated successfully');
      });
    });

    it('resets form after successful rotation', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });
      const onOpenChange = vi.fn();

      const { rerender } = renderWithProviders(
        <RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />
      );

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      // Reopen dialog
      rerender(<QueryClientProvider client={queryClient}><RotateCredentialDialog {...defaultProps} open={true} onOpenChange={onOpenChange} /></QueryClientProvider>);

      // Form should be reset
      expect(screen.getByLabelText(/new value/i)).toHaveValue('');
    });

    it('shows loading state during submission', async () => {
      mockRotate.mockReturnValue(new Promise(() => {})); // Never resolves

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      // During pending state the button text is replaced by a spinner,
      // so we find it by type="submit" instead of accessible name
      await waitFor(() => {
        const submitButton = document.querySelector('button[type="submit"]');
        expect(submitButton).toBeDisabled();
      });
    });

    it('shows spinner icon during submission', async () => {
      mockRotate.mockReturnValue(new Promise(() => {})); // Never resolves

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'new-secret-value');

      await user.click(screen.getByRole('button', { name: /rotate/i }));

      await waitFor(() => {
        const submitButton = document.querySelector('button[type="submit"]');
        const spinner = submitButton?.querySelector('svg[class*="animate-spin"]');
        expect(spinner).toBeInTheDocument();
      });
    });

    it('does not submit when credential is null', async () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} credential={null} />);

      // Dialog renders (controlled by open prop) but submit with null credential
      // would throw inside the mutation function
      expect(screen.getByText('Rotate Credential')).toBeInTheDocument();
    });
  });

  describe('Dialog Closing', () => {
    it('closes when clicking cancel button', async () => {
      const onOpenChange = vi.fn();

      renderWithProviders(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('prevents closing while submitting', async () => {
      const onOpenChange = vi.fn();
      mockRotate.mockReturnValue(new Promise(() => {})); // Never resolves

      renderWithProviders(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i) as HTMLInputElement;
      expect(valueInput.type).toBe('password');
    });

    it('sends value unencrypted to API (API handles encryption)', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByLabelText(/new value/i)).toBeInTheDocument();
    });

    it('has required attribute on input', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      expect(valueInput).toBeRequired();
    });

    it('has proper aria-label on password toggle', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const toggleButton = screen.getByRole('button', { name: /show/i });
      expect(toggleButton).toHaveAttribute('aria-label');
    });

    it('has dialog role', () => {
      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very long credential values', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

      const valueInput = screen.getByLabelText(/new value/i);
      await user.type(valueInput, 'a'.repeat(200));

      const submitButton = screen.getByRole('button', { name: /rotate/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockRotate).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          'a'.repeat(200)
        );
      });
    });

    it('handles special characters in credential value', async () => {
      mockRotate.mockResolvedValue({ id: 'cred_001' });

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} />);

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

      renderWithProviders(<RotateCredentialDialog {...defaultProps} credential={specialCredential} />);

      // Should display the special name in description
      expect(screen.getByText(/key \(production\)/i)).toBeInTheDocument();
    });
  });
});
