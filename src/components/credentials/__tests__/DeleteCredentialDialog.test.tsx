/**
 * Tests for DeleteCredentialDialog
 *
 * Security-focused tests for credential deletion:
 * - Confirmation dialog
 * - Credential name display
 * - Destructive action styling
 * - Async confirmation
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Credential } from '@/lib/api/types';

const mockConfirm = vi.fn();

vi.mock('@/components/ui/confirmation-dialog', () => ({
  ConfirmationDialog: function ConfirmationDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmText,
    cancelText,
    variant,
    onConfirm,
    errorContext,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmText: string;
    cancelText: string;
    variant: string;
    onConfirm: () => Promise<void>;
    errorContext: string;
  }) {
    if (!open) return null;
    return (
      <div data-testid="delete-credential-dialog">
        <h2 data-testid="dialog-title">{title}</h2>
        <p data-testid="dialog-description">{description}</p>
        <button data-testid="confirm-button" onClick={onConfirm}>
          {confirmText}
        </button>
        <button data-testid="cancel-button" onClick={() => onOpenChange(false)}>
          {cancelText}
        </button>
        <div data-testid="variant">{variant}</div>
        <div data-testid="error-context">{errorContext}</div>
      </div>
    );
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace) => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, Record<string, string>> = {
      credentials: {
        'delete_dialog.title': 'Delete Credential',
        'delete_dialog.description': 'Are you sure you want to delete {name}? This action cannot be undone.',
      },
      common: {
        delete: 'Delete',
        cancel: 'Cancel',
      },
    };

    // Handle template interpolation for description
    if (key === 'delete_dialog.description') {
      const name = params?.name ?? '';
      return `Are you sure you want to delete ${name}? This action cannot be undone.`;
    }

    return translations[namespace]?.[key] || key;
  }),
}));

import { DeleteCredentialDialog } from '../DeleteCredentialDialog';

describe('DeleteCredentialDialog', () => {
  const user = userEvent.setup();

  const mockCredential: Credential = {
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
    onConfirm: mockConfirm,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders when open with credential', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('delete-credential-dialog')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<DeleteCredentialDialog {...defaultProps} open={false} />);

      expect(screen.queryByTestId('delete-credential-dialog')).not.toBeInTheDocument();
    });

    it('displays delete title', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Delete Credential');
    });

    it('displays credential name in description', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/OpenAI API Key/);
    });

    it('displays warning message about irreversible action', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/cannot be undone/i);
    });

    it('shows delete confirm button', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('confirm-button')).toHaveTextContent('Delete');
    });

    it('shows cancel button', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('cancel-button')).toHaveTextContent('Cancel');
    });

    it('has destructive variant', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('variant')).toHaveTextContent('destructive');
    });

    it('has correct error context', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('error-context')).toHaveTextContent('credentials.delete');
    });
  });

  describe('With Null Credential', () => {
    it('renders dialog even with null credential', () => {
      render(<DeleteCredentialDialog {...defaultProps} credential={null} />);

      expect(screen.getByTestId('delete-credential-dialog')).toBeInTheDocument();
    });

    it('displays empty name when credential is null', () => {
      render(<DeleteCredentialDialog {...defaultProps} credential={null} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/are you sure you want to delete/i);
    });

    it('handles undefined credential name', () => {
      const credentialWithNoName = { ...mockCredential, name: '' };
      render(<DeleteCredentialDialog {...defaultProps} credential={credentialWithNoName} />);

      expect(screen.getByTestId('dialog-description')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onConfirm when delete button clicked', async () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      await user.click(screen.getByTestId('confirm-button'));

      expect(mockConfirm).toHaveBeenCalled();
    });

    it('calls onOpenChange with false when cancel button clicked', async () => {
      const onOpenChange = vi.fn();

      render(<DeleteCredentialDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByTestId('cancel-button'));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('handles async onConfirm', async () => {
      const asyncConfirm = vi.fn().mockResolvedValue(undefined);

      render(<DeleteCredentialDialog {...defaultProps} onConfirm={asyncConfirm} />);

      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(asyncConfirm).toHaveBeenCalled();
      });
    });
  });

  describe('Special Characters in Name', () => {
    it('handles credential name with special characters', () => {
      const specialCredential = {
        ...mockCredential,
        name: 'Key (production) <test> & more',
      };

      render(<DeleteCredentialDialog {...defaultProps} credential={specialCredential} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/key \(production\)/i);
    });

    it('handles credential name with quotes', () => {
      const quoteCredential = {
        ...mockCredential,
        name: 'Credential "with quotes"',
      };

      render(<DeleteCredentialDialog {...defaultProps} credential={quoteCredential} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/with quotes/i);
    });

    it('handles very long credential names', () => {
      const longCredential = {
        ...mockCredential,
        name: 'a'.repeat(500),
      };

      render(<DeleteCredentialDialog {...defaultProps} credential={longCredential} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/a{200,}/);
    });

    it('handles unicode characters in credential name', () => {
      const unicodeCredential = {
        ...mockCredential,
        name: '凭证名称 测试',
      };

      render(<DeleteCredentialDialog {...defaultProps} credential={unicodeCredential} />);

      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/凭证名称/i);
    });
  });

  describe('Security', () => {
    it('does not display credential value in dialog', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      const dialogText = screen.getByTestId('delete-credential-dialog').textContent;

      // Should not contain fingerprint
      expect(dialogText).not.toContain('••••••••••••xyz1');
    });

    it('does not log credential information to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      render(<DeleteCredentialDialog {...defaultProps} />);

      await user.click(screen.getByTestId('confirm-button'));

      const allLogs = consoleSpy.mock.calls.flat().join(' ');
      expect(allLogs).not.toContain('OpenAI API Key');

      consoleSpy.mockRestore();
    });

    it('emphasizes destructive nature of action', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      // Has destructive variant
      expect(screen.getByTestId('variant')).toHaveTextContent('destructive');

      // Has warning message
      expect(screen.getByTestId('dialog-description')).toHaveTextContent(/cannot be undone/i);
    });
  });

  describe('Error Context', () => {
    it('passes correct error context for error tracking', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByTestId('error-context')).toHaveTextContent('credentials.delete');
    });
  });

  describe('Accessibility', () => {
    it('has proper heading', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('heading', { name: 'Delete Credential' })).toBeInTheDocument();
    });

    it('has descriptive text for screen readers', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      const description = screen.getByTestId('dialog-description');
      expect(description).toBeInTheDocument();
    });

    it('has properly labeled action buttons', () => {
      render(<DeleteCredentialDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles credential name with only whitespace', () => {
      const whitespaceCredential = {
        ...mockCredential,
        name: '   ',
      };

      render(<DeleteCredentialDialog {...defaultProps} credential={whitespaceCredential} />);

      // Should still render without crashing
      expect(screen.getByTestId('delete-credential-dialog')).toBeInTheDocument();
    });

    it('handles empty credential object', () => {
      const emptyCredential = {
        id: '',
        workspace_id: '',
        project_id: '',
        name: '',
        type: 'api_key' as const,
        fingerprint: '',
        created_at: '',
        last_rotated_at: '',
      };

      render(<DeleteCredentialDialog {...defaultProps} credential={emptyCredential} />);

      expect(screen.getByTestId('delete-credential-dialog')).toBeInTheDocument();
    });

    it('handles onConfirm that throws error', async () => {
      const errorConfirm = vi.fn().mockRejectedValue(new Error('Delete failed'));

      render(<DeleteCredentialDialog {...defaultProps} onConfirm={errorConfirm} />);

      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(errorConfirm).toHaveBeenCalled();
      });

      // Dialog should still handle the error (in the parent component)
      expect(screen.getByTestId('delete-credential-dialog')).toBeInTheDocument();
    });
  });
});
