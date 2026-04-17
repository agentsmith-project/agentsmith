import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog';

describe('AlertDialog', () => {
  it('keeps footer CTA order aligned with DOM order on small screens and exposes destructive action semantics', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter data-testid="alert-dialog__footer">
            <AlertDialogCancel data-testid="alert-dialog__cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="alert-dialog__confirm"
              variant="destructive"
              prominence="primary"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const footer = screen.getByTestId('alert-dialog__footer');
    const cancel = screen.getByTestId('alert-dialog__cancel');
    const confirm = screen.getByTestId('alert-dialog__confirm');

    expect(footer.className).not.toContain('flex-col-reverse');
    expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confirm).toHaveAttribute('data-alert-dialog-action-variant', 'destructive');
    expect(confirm).toHaveAttribute('data-alert-dialog-action-prominence', 'primary');
    expect(confirm).toHaveAttribute('data-visual-prominence', 'primary');
  });
});
