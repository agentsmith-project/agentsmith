import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeWorkspace, mockWorkspaceListResponse } from './systemWorkspacesTestUtils';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'updated_at' && values?.value) {
      return `updated_at:${values.value}`;
    }
    return key;
  },
}));

vi.mock('../SystemLogoutButton', () => ({
  SystemLogoutButton: () => <button type="button" data-testid="system__logout">logout</button>,
}));

import { SystemWorkspacesPage } from '../SystemWorkspacesPage';

describe('SystemWorkspacesPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      mockWorkspaceListResponse([
        makeWorkspace({
          id: 'ws_alpha',
          name: 'Alpha Workspace',
          workspace_admin: 'alpha-admin@example.com',
          tenant: {
            workspace_id: 'ws_alpha',
            workspace_name: 'Alpha Workspace',
            substrate_label: 'primary',
            database_name: 'agentsmith_ws_ws_alpha',
            collection_prefix: 'ws_ws_alpha_',
            key_prefix: 'ws:ws_alpha:',
          },
        }),
        makeWorkspace({
          id: 'ws_beta',
          name: 'Beta Workspace',
          provisioning_status: 'draft',
          last_initialized_at: null,
          workspace_admin: 'beta-admin@example.com',
          idp: {
            kind: 'keycloak',
            url: 'https://beta.example.com',
            realm: 'beta',
            client_id: 'beta-client',
            has_client_secret: false,
          },
          tenant: {
            workspace_id: 'ws_beta',
            workspace_name: 'Beta Workspace',
            substrate_label: 'primary',
            database_name: 'agentsmith_ws_ws_beta',
            collection_prefix: 'ws_ws_beta_',
            key_prefix: 'ws:ws_beta:',
          },
          updated_at: '2026-03-11T00:00:00.000Z',
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('renders system workspace cards and preview panel', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__heading')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__open-workspace-login--ws_alpha')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_alpha/login',
    );
    expect(screen.getByTestId('system-workspaces__open-workspace-login--ws_beta')).toBeDisabled();
    expect(screen.getByTestId('system-workspaces__preview')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__mode')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__basics')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__admin')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__idp')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__status')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__notice-status')).toHaveTextContent('status_idle');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('workspace_status_card_label');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('provisioning_status.ready');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('workspace_admin_card_label');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('alpha-admin@example.com');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('workspace_idp_card_label');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('https://alpha.example.com');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('workspace_tenant_card_label');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('agentsmith_ws_ws_alpha');
  });

  it('filters workspaces and generates preview values', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('system-workspaces__search'), { target: { value: 'beta' } });
    expect(screen.queryByTestId('system-workspaces__card--ws_alpha')).not.toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_beta')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('system-workspaces__draft-name'), { target: { value: 'Platform Ops' } });
    expect(screen.getByTestId('system-workspaces__preview')).toHaveTextContent('platform_ops');
  });

  it('shows retry state when loading fails', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: false,
    });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__retry'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('loads existing workspace into the editor and saves updates', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'draft',
            last_initialized_at: null,
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ user_id: 'kc-ops-admin', email: 'ops-admin@example.com', name: 'Ops Admin' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha' }),
      })
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'draft',
            last_initialized_at: null,
            workspace_admin: 'ops-admin@example.com',
            idp: {
              kind: 'keycloak',
              url: 'https://login.example.com',
              realm: 'alpha-prod',
              client_id: 'alpha-client-prod',
              has_client_secret: true,
            },
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    expect(screen.getByTestId('system-workspaces__mode')).toHaveTextContent('edit_mode_label');
    expect(screen.getByTestId('system-workspaces__mode')).toHaveTextContent('editing_workspace');
    fireEvent.change(screen.getByTestId('system-workspaces__draft-admin'), {
      target: { value: 'ops-admin@example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-url'), {
      target: { value: 'https://login.example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-realm'), {
      target: { value: 'alpha-prod' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-id'), {
      target: { value: 'alpha-client-prod' },
    });
    await waitFor(() => expect(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin'));
    fireEvent.click(screen.getByTestId('system-workspaces__save'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(screen.getByTestId('system-workspaces__save-notice')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__notice-status')).toHaveTextContent('status_success');
    expect(screen.getByTestId('system-workspaces__publish')).not.toBeDisabled();
    expect(screen.getByTestId('system-workspaces__disable')).toBeDisabled();
  });

  it('deletes a disabled workspace', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'disabled',
            last_initialized_at: '2026-03-10T02:00:00.000Z',
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    fireEvent.click(screen.getByTestId('system-workspaces__delete'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.getByTestId('system-workspaces__save-notice')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__notice-status')).toHaveTextContent('status_success');
  });

  it('shows validation failure feedback when saving fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ user_id: 'kc-ops-admin', email: 'ops@example.com', name: 'Ops Admin' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error_message: 'invalid_system_workspace_payload' }),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__heading')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('system-workspaces__draft-name'), {
      target: { value: 'Ops Workspace' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-admin'), {
      target: { value: 'ops@example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-url'), {
      target: { value: 'https://login.example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-realm'), {
      target: { value: 'ops' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-id'), {
      target: { value: 'ops-client' },
    });
    await waitFor(() => expect(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin'));
    fireEvent.click(screen.getByTestId('system-workspaces__save'));

    await waitFor(() => {
      expect(screen.getByTestId('system-workspaces__save-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('system-workspaces__notice-status')).toHaveTextContent('status_error');
  });

  it('publishes a selected draft workspace and surfaces ready status', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'draft',
            last_initialized_at: null,
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha', provisioning_status: 'ready' }),
      })
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'ready',
            last_initialized_at: '2026-03-10T02:00:00.000Z',
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    fireEvent.click(screen.getByTestId('system-workspaces__publish'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha/publish',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(screen.getByTestId('system-workspaces__save-notice')).toHaveTextContent('publish_success');
  });

  it('disables a ready workspace', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'ready',
            last_initialized_at: '2026-03-10T02:00:00.000Z',
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha', provisioning_status: 'disabled' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ws_alpha',
              name: 'Alpha Workspace',
              provisioning_status: 'disabled',
              last_initialized_at: '2026-03-10T02:00:00.000Z',
              last_init_error: null,
              workspace_admin: 'alpha-admin@example.com',
              idp: {
                kind: 'keycloak',
                url: 'https://alpha.example.com',
                realm: 'alpha',
                client_id: 'alpha-client',
                has_client_secret: true,
              },
              tenant: {
                workspace_id: 'ws_alpha',
                workspace_name: 'Alpha Workspace',
                substrate_label: 'primary',
                database_name: 'agentsmith_ws_ws_alpha',
                collection_prefix: 'ws_ws_alpha_',
                key_prefix: 'ws:ws_alpha:',
              },
              created_at: '2026-03-01T00:00:00.000Z',
              updated_at: '2026-03-10T00:00:00.000Z',
            },
          ],
        }),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    fireEvent.click(screen.getByTestId('system-workspaces__disable'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha/disable',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(screen.getByTestId('system-workspaces__save-notice')).toHaveTextContent('disable_success');
  });

  it('re-publishes a disabled workspace', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'disabled',
            last_initialized_at: '2026-03-10T02:00:00.000Z',
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha', provisioning_status: 'ready' }),
      })
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'ready',
            last_initialized_at: '2026-03-10T03:00:00.000Z',
            workspace_admin: 'alpha-admin@example.com',
            tenant: {
              workspace_id: 'ws_alpha',
              workspace_name: 'Alpha Workspace',
              substrate_label: 'primary',
              database_name: 'agentsmith_ws_ws_alpha',
              collection_prefix: 'ws_ws_alpha_',
              key_prefix: 'ws:ws_alpha:',
            },
          }),
        ]),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    expect(screen.getByTestId('system-workspaces__publish')).not.toBeDisabled();
    expect(screen.getByTestId('system-workspaces__disable')).toBeDisabled();
    fireEvent.click(screen.getByTestId('system-workspaces__publish'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha/publish',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(screen.getByTestId('system-workspaces__save-notice')).toHaveTextContent('publish_success');
  });

  it('locks editing controls while provisioning is in progress', async () => {
    fetchMock.mockResolvedValueOnce(
      mockWorkspaceListResponse([
        makeWorkspace({
          provisioning_status: 'provisioning',
          last_initialized_at: null,
          workspace_admin: 'alpha-admin@example.com',
          tenant: {
            workspace_id: 'ws_alpha',
            workspace_name: 'Alpha Workspace',
            substrate_label: 'primary',
            database_name: 'agentsmith_ws_ws_alpha',
            collection_prefix: 'ws_ws_alpha_',
            key_prefix: 'ws:ws_alpha:',
          },
        }),
      ]),
    );

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    expect(screen.getByTestId('system-workspaces__save')).toBeDisabled();
    expect(screen.getByTestId('system-workspaces__publish')).toBeDisabled();
    expect(screen.getByTestId('system-workspaces__disable')).toBeDisabled();
    expect(screen.getByTestId('system-workspaces__delete')).toBeDisabled();
    expect(screen.getByTestId('system-workspaces__notice')).toHaveTextContent('provisioning_notice');
  });

  it('only enables delete for disabled workspaces', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ...mockWorkspaceListResponse([
          makeWorkspace({
            provisioning_status: 'ready',
            last_initialized_at: '2026-03-10T02:00:00.000Z',
          }),
          makeWorkspace({
            id: 'ws_disabled',
            name: 'Disabled Workspace',
            provisioning_status: 'disabled',
            last_initialized_at: '2026-03-10T02:00:00.000Z',
          }),
        ]),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__configure--ws_alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_alpha'));
    expect(screen.getByTestId('system-workspaces__delete')).toBeDisabled();

    fireEvent.click(screen.getByTestId('system-workspaces__configure--ws_disabled'));
    expect(screen.getByTestId('system-workspaces__delete')).not.toBeDisabled();
  });
});
