import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormDialog } from '../form-dialog';

describe('FormDialog', () => {
  it('surfaces submission errors inline without relying on toast-only feedback', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Validation failed'));

    render(
      <FormDialog
        title='Create policy'
        description='Explain the change before submitting.'
        trigger={<button type='button'>Open</button>}
        submitLabel='Save'
        cancelLabel='Cancel'
        onSubmit={onSubmit}
        open
        onOpenChange={vi.fn()}
        testId='policy-form-dialog'
      >
        {({ onSubmit: handleSubmit }) => (
          <form id='dialog-form' onSubmit={handleSubmit}>
            <input aria-label='Name' defaultValue='Policy draft' />
          </form>
        )}
      </FormDialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByTestId('policy-form-dialog__error')).toHaveTextContent('Validation failed');
    });

    expect(screen.getByTestId('policy-form-dialog__error')).toHaveAttribute('role', 'alert');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
