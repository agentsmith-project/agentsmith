import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PublicAuthAsideBlock,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthShell,
} from '../PublicAuthPage';

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

describe('PublicAuthPage', () => {
  it('marks the shell as single layout when no aside is present', () => {
    render(
      <PublicAuthFrame>
        <PublicAuthShell>
          <div>Primary</div>
        </PublicAuthShell>
      </PublicAuthFrame>,
    );

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'wide');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
    expect(screen.queryByTestId('public-auth__aside')).not.toBeInTheDocument();
  });

  it('marks the shell as split layout when an aside is present', () => {
    render(
      <PublicAuthFrame>
        <PublicAuthShell
          aside={(
            <PublicAuthAsideBlock title="Aside title">
              <div>Aside body</div>
            </PublicAuthAsideBlock>
          )}
        >
          <div>Primary</div>
        </PublicAuthShell>
      </PublicAuthFrame>,
    );

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'wide');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'split');
    expect(screen.getByTestId('public-auth__aside')).toBeInTheDocument();
    expect(screen.getByText('Aside title')).toBeInTheDocument();
  });

  it('renders a narrow frame when requested', () => {
    render(
      <PublicAuthFrame width="narrow">
        <div>Primary</div>
      </PublicAuthFrame>,
    );

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
  });

  it('keeps the public auth stage left-aligned instead of centered like a microsite hero', () => {
    render(
      <PublicAuthFrame>
        <PublicAuthShell>
          <div>Primary</div>
        </PublicAuthShell>
      </PublicAuthFrame>,
    );

    expect(screen.getByTestId('public-auth__stage')).toHaveClass('justify-start');
  });

  it('renders the header content without extra chrome', () => {
    render(<PublicAuthHeader title="Title" description="Description" />);

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });
});
