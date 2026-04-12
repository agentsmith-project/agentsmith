import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeWorkspace } from './systemWorkspacesTestUtils';

vi.mock('next/link', () => ({
  default: ({ children }: { children: unknown }) => children,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { WorkspaceEditorPanel } from '../system-workspaces/WorkspaceEditorPanel';
import type { SystemWorkspaceEditorState } from '../system-workspaces/types';

function createState(overrides: Partial<SystemWorkspaceEditorState> = {}): SystemWorkspaceEditorState {
  return {
    draft: {
      name: 'Alpha Workspace',
      adminMode: 'directory_user',
      adminEmail: 'alpha-admin@example.com',
      adminQuery: 'alpha-admin@example.com',
      admin: {
        user_id: 'alpha-admin-id',
        email: 'alpha-admin@example.com',
        name: 'Alpha Admin',
      },
      loginIdpUrl: 'https://alpha.example.com',
      loginIdpRealm: 'alpha',
      loginClientId: 'alpha-client',
      directoryClientId: 'alpha-directory-client',
      directoryClientSecret: '',
    },
    selectedWorkspaceId: 'ws_alpha',
    selectedWorkspace: makeWorkspace({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      workspace_admin: 'alpha-admin@example.com',
      workspace_admin_user_id: 'alpha-admin-id',
      workspace_admin_name: 'Alpha Admin',
    }),
    selectedStatus: 'ready',
    isEditingWorkspace: true,
    isEditMode: false,
    canSubmit: true,
    canPublish: true,
    canDisable: true,
    canDelete: true,
    isProvisioning: false,
    idpVerificationState: 'verified_with_directory',
    directorySearchEnabled: true,
    ...overrides,
  };
}

describe('WorkspaceEditorPanel', () => {
  const noop = () => undefined;

  it('keeps the primary workflow actions explicit instead of falling back to quiet default buttons', () => {
    render(
      <WorkspaceEditorPanel
        locale="en-US"
        t={(key) => key}
        state={createState()}
        isSubmitting={false}
        activeAction={null}
        saveError={null}
        saveNotice={null}
        adminSearchResults={[]}
        adminSearchLoading={false}
        adminSearchError={null}
        idpVerificationNotice={null}
        onDraftChange={noop}
        onEnableEditMode={noop}
        onCancelEditMode={noop}
        onVerifyIdp={noop}
        onSubmit={noop}
        onPublish={noop}
        onDisable={noop}
        onDelete={noop}
      />,
    );

    expect(screen.getByTestId('system-workspaces__editor')).not.toHaveClass('shadow-card');
    expect(screen.getByTestId('system-workspaces__enable-edit')).toHaveClass('bg-foreground/94');
    expect(screen.getByTestId('system-workspaces__enable-edit')).not.toHaveClass('bg-transparent');
    expect(screen.getByTestId('system-workspaces__save')).toHaveClass('bg-foreground/94');
    expect(screen.getByTestId('system-workspaces__save')).not.toHaveClass('bg-transparent');
    expect(screen.getByTestId('system-workspaces__login-preview')).toHaveTextContent('/en-US/workspaces/alpha_workspace/login');
    expect(screen.getByTestId('system-workspaces__callback-preview')).toHaveTextContent('/en-US/workspaces/alpha_workspace/login/callback');
  });
});
