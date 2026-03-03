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
        permission_tokens: 'Permission Tokens',
        workspace_permissions: 'Workspace',
        project_permissions: 'Project',
        no_permissions: 'No permissions',
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

  it('renders workspace/project permission tokens in dropdown', async () => {
    render(
      <UserMenu
        user={{ name: 'Alice Doe', email: 'alice@example.com' }}
        workspacePermissions={['workspace:read']}
        projectPermissions={['project:endpoint:use', 'project:manage']}
      />,
    );

    openUserMenu();

    expect(await screen.findByTestId('user-menu__permission-tokens')).toBeInTheDocument();
    expect(screen.getByText('workspace:read')).toBeInTheDocument();
    expect(screen.getByText('project:endpoint:use')).toBeInTheDocument();
    expect(screen.getByText('project:manage')).toBeInTheDocument();
  });

  it('renders empty state when permission tokens are absent', async () => {
    render(
      <UserMenu
        user={{ name: 'Bob Doe', email: 'bob@example.com' }}
        workspacePermissions={[]}
        projectPermissions={[]}
      />,
    );

    openUserMenu();

    expect(await screen.findByTestId('user-menu__workspace-permissions')).toHaveTextContent('No permissions');
    expect(screen.getByTestId('user-menu__project-permissions')).toHaveTextContent('No permissions');
  });
});
