/**
 * Unit tests for FileDeleteDialog component
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { FileDeleteDialog } from '../FileDeleteDialog';

describe('FileDeleteDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    hasAIReady: false,
    fileCount: 1,
  };

  it('should render single file delete dialog', () => {
    render(
      <FileDeleteDialog
        {...defaultProps}
        filename="test-file.pdf"
      />
    );

    expect(screen.getByText('Delete File')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    expect(screen.getByText(/test-file\.pdf/)).toBeInTheDocument();
  });

  it('should render batch delete dialog', () => {
    render(
      <FileDeleteDialog
        {...defaultProps}
        fileCount={3}
      />
    );

    expect(screen.getAllByText('Delete 3 files').length).toBeGreaterThan(0);
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    expect(screen.getAllByText(/3 files/).length).toBeGreaterThan(0);
  });

  it('should show AI Ready checkbox when file has AI Ready artifacts', () => {
    render(
      <FileDeleteDialog
        {...defaultProps}
        hasAIReady={true}
        filename="test-file.pdf"
      />
    );

    expect(screen.getByText(/Also delete AIReady artifacts/)).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('should not show AI Ready checkbox when file does not have AI Ready artifacts', () => {
    render(
      <FileDeleteDialog
        {...defaultProps}
        hasAIReady={false}
        filename="test-file.pdf"
      />
    );

    expect(screen.queryByText(/Also delete AIReady artifacts/)).not.toBeInTheDocument();
  });

  it('should call onConfirm with deleteAIReady=true when checkbox is checked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <FileDeleteDialog
        {...defaultProps}
        onConfirm={onConfirm}
        hasAIReady={true}
        filename="test-file.pdf"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('should call onConfirm with deleteAIReady=false when checkbox is unchecked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <FileDeleteDialog
        {...defaultProps}
        onConfirm={onConfirm}
        hasAIReady={true}
        filename="test-file.pdf"
      />
    );

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('should call onOpenChange with false when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <FileDeleteDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        filename="test-file.pdf"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should disable buttons when deleting is true', () => {
    render(
      <FileDeleteDialog
        {...defaultProps}
        deleting={true}
        filename="test-file.pdf"
      />
    );

    const deleteButton = screen.getByRole('button', { name: 'Deleting...' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });

    expect(deleteButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
  });

  it('should disable checkbox when deleting is true', () => {
    render(
      <FileDeleteDialog
        {...defaultProps}
        hasAIReady={true}
        deleting={true}
        filename="test-file.pdf"
      />
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
  });

  it('should not close dialog when deleting is true and cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <FileDeleteDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        deleting={true}
        filename="test-file.pdf"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('should reset checkbox state when dialog is closed via cancel button', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <FileDeleteDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        hasAIReady={true}
        filename="test-file.pdf"
      />
    );

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // Close via cancel button (which triggers handleClose and resets state)
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // handleClose calls setDeleteAIReady(true) and onOpenChange(false)
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
