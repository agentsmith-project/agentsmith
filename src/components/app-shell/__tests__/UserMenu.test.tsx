import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ThemeProvider } from '@/components/providers/ThemeProvider';

import { UserMenu } from '../UserMenu';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const dict: Record<string, Record<string, string>> = {
      common: {
        user: 'User',
      },
      'common.user_menu': {
        profile: 'Profile',
        workspace_personal_context: 'My Workspace Context',
        project_personal_context: 'My Project Context',
        workspace_integrations: 'Workspace integrations',
        personal_connections: 'Personal connections',
        api_keys: 'API Keys',
        language: 'Language',
        logout: 'Logout',
        appearance: 'Appearance',
        theme_light: 'Light',
        theme_dark: 'Dark',
        current: 'Current',
      },
    };
    return dict[namespace]?.[key] ?? key;
  },
}));

describe('UserMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
  });

  const renderMenu = () =>
    render(
      <ThemeProvider>
        <UserMenu
          user={{ name: 'Alice Doe', email: 'alice@example.com' }}
          onProfile={() => undefined}
          onWorkspacePersonalContext={() => undefined}
          onProjectPersonalContext={() => undefined}
          onWorkspaceIntegrations={() => undefined}
          onPersonalConnections={() => undefined}
          onApiKeys={() => undefined}
        />
      </ThemeProvider>,
    );

  const openUserMenu = () => {
    const trigger = screen.getByTestId('topbar__user-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  };

  it('uses a non-submit trigger button so menu opening does not leak into surrounding forms', () => {
    renderMenu();

    expect(screen.getByTestId('topbar__user-menu')).toHaveAttribute('type', 'button');
  });

  it('renders profile, integration, and theme controls without permission tokens', async () => {
    renderMenu();

    openUserMenu();

    expect(await screen.findByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('My Workspace Context')).toBeInTheDocument();
    expect(screen.getByText('My Project Context')).toBeInTheDocument();
    expect(screen.getByText('Workspace integrations')).toBeInTheDocument();
    expect(screen.getByText('Personal connections')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.queryByTestId('user-menu__permission-tokens')).not.toBeInTheDocument();
  });

  it('switches the document theme and persists the choice', async () => {
    renderMenu();

    expect(screen.getByTestId('topbar__user-menu').className).not.toMatch(/shadow-/);

    openUserMenu();
    fireEvent.click(await screen.findByTestId('user-menu__theme-dark'));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('mbos.theme')).toBe('dark');
  });

  it('fires workspace and project personal context actions from the menu', async () => {
    const onWorkspacePersonalContext = vi.fn();
    const onProjectPersonalContext = vi.fn();

    render(
      <ThemeProvider>
        <UserMenu
          user={{ name: 'Alice Doe', email: 'alice@example.com' }}
          onWorkspacePersonalContext={onWorkspacePersonalContext}
          onProjectPersonalContext={onProjectPersonalContext}
        />
      </ThemeProvider>,
    );

    openUserMenu();
    fireEvent.click(await screen.findByText('My Workspace Context'));
    openUserMenu();
    fireEvent.click(await screen.findByText('My Project Context'));

    expect(onWorkspacePersonalContext).toHaveBeenCalledTimes(1);
    expect(onProjectPersonalContext).toHaveBeenCalledTimes(1);
  });
});
