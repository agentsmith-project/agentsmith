import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

  beforeEach(() => {
    document.documentElement.lang = 'en-US';
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolvedOptions(this: Intl.DateTimeFormat) {
      return {
        ...originalResolvedOptions.call(this),
        timeZone: 'America/Los_Angeles',
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the selected workspace quiet in read-only mode and hides the detailed edit sheet', () => {
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

    expect(screen.getByTestId('system-workspaces__enable-edit')).not.toHaveAttribute('data-visual-prominence');
    expect(screen.getByTestId('system-workspaces__read-only-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('system-workspaces__basics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('system-workspaces__idp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('system-workspaces__admin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('system-workspaces__lifecycle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('system-workspaces__save')).not.toBeInTheDocument();
  });

  it('expands into the full settings sheet when edit mode is enabled', () => {
    render(
      <WorkspaceEditorPanel
        locale="en-US"
        t={(key) => key}
        state={createState({ isEditMode: true })}
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

    expect(screen.getByTestId('system-workspaces__basics')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__idp')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__admin')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__lifecycle')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__save')).toHaveAttribute('data-visual-prominence', 'primary');
    expect(screen.getByTestId('system-workspaces__login-preview')).toHaveTextContent('/en-US/workspaces/alpha_workspace/login');
    expect(screen.getByTestId('system-workspaces__callback-preview')).toHaveTextContent('/en-US/workspaces/alpha_workspace/login/callback');
  });

  it('promotes configure-workspace only when the selected workspace needs attention', () => {
    render(
      <WorkspaceEditorPanel
        locale="en-US"
        t={(key) => key}
        state={createState({
          selectedWorkspace: makeWorkspace({
            id: 'ws_failed',
            name: 'Failed Workspace',
            provisioning_status: 'failed',
            last_init_error: 'identity_provider_config_incomplete',
          }),
          selectedStatus: 'failed',
        })}
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

    expect(screen.getByTestId('system-workspaces__enable-edit')).toHaveAttribute('data-visual-prominence', 'primary');
  });

  it('renders initialized timestamps as viewer-local time elements with machine-readable metadata', () => {
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

    const timestamps = screen.getAllByTestId('system-workspaces__initialized-at');
    expect(timestamps.length).toBeGreaterThan(0);

    for (const timestamp of timestamps) {
      expect(timestamp.tagName).toBe('TIME');
      expect(timestamp).toHaveAttribute('dateTime', '2026-03-10T01:00:00.000Z');
      expect(timestamp).toHaveAttribute('data-visual-datetime', '2026-03-10T01:00:00.000Z');
      expect(timestamp).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
      expect(timestamp).not.toHaveTextContent('2026-03-10T01:00:00.000Z');
    }
  });
});
