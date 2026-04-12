import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EndpointDialogFooter } from '../EndpointDialogFooter';

describe('EndpointDialogFooter', () => {
  it('keeps the CTA stack stable and mobile-friendly', () => {
    render(
      <EndpointDialogFooter
        canSubmit
        createPending={false}
        hasCredentials
        commonT={(key) => (key === 'create' ? 'Create' : 'Cancel')}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId('endpoints__dialog-footer')).toHaveClass('flex-col-reverse');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('w-full');
    expect(screen.getByRole('button', { name: 'Create' })).toHaveClass('w-full');
  });

  it('shows the loading spinner state while creating', () => {
    render(
      <EndpointDialogFooter
        canSubmit
        createPending
        hasCredentials
        commonT={(key) => (key === 'create' ? 'Create' : 'Cancel')}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.getByTestId('endpoints__dialog-footer').querySelector('svg')).toBeTruthy();
  });
});
