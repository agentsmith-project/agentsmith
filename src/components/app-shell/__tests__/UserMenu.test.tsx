import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserMenu } from '../UserMenu';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const dict: Record<string, Record<string, string>> = {
      common: {
        user: 'User',
      },
      'common.user_menu': {
        profile: 'Profile',
        api_keys: 'API Keys',
        language: 'Language',
        logout: 'Logout',
      },
    };
    return dict[namespace]?.[key] ?? key;
  },
}));

describe('UserMenu', () => {
  const openUserMenu = () => {
    const trigger = screen.getByTestId('topbar__user-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  };

  it('does not render permission tokens in dropdown', async () => {
    render(
      <UserMenu
        user={{ name: 'Alice Doe', email: 'alice@example.com' }}
      />,
    );

    openUserMenu();

    expect(await screen.findByText('Profile')).toBeInTheDocument();
    expect(screen.queryByTestId('user-menu__permission-tokens')).not.toBeInTheDocument();
  });
});
