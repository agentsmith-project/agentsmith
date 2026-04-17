import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PublicAuthAsideBlock,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthShell,
  PublicAuthSupportBlock,
} from '../PublicAuthPage';

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

describe('PublicAuthPage', () => {
  it('uses the semantic single-column auth recipe when requested', () => {
    render(
      <PublicAuthFrame recipe="public_auth_single">
        <PublicAuthShell recipe="public_auth_single">
          <div>Primary</div>
        </PublicAuthShell>
      </PublicAuthFrame>,
    );

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-recipe', 'public_auth_single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-recipe', 'public_auth_single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
    expect(screen.queryByTestId('public-auth__aside')).not.toBeInTheDocument();
  });

  it('uses the semantic split auth recipe when helper aside is required', () => {
    render(
      <PublicAuthFrame recipe="public_auth_split">
        <PublicAuthShell
          recipe="public_auth_split"
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

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-recipe', 'public_auth_split');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-recipe', 'public_auth_split');
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
      <PublicAuthFrame recipe="public_auth_single">
        <PublicAuthShell recipe="public_auth_single">
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

  it('renders a quiet support block for single-column auth pages', () => {
    render(
      <PublicAuthSupportBlock
        eyebrow="Scope"
        title="Workspace-specific access"
        description="Use your organization account to continue."
      >
        <button type="button">Continue</button>
      </PublicAuthSupportBlock>,
    );

    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.getByText('Workspace-specific access')).toBeInTheDocument();
    expect(screen.getByText('Use your organization account to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });
});
