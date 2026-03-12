import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
        {
          id: 'ws_alpha',
          name: 'Alpha Workspace',
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
        {
          id: 'ws_beta',
          name: 'Beta Workspace',
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
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
        },
      ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('renders system workspace cards and preview panel', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__heading')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__open-projects--ws_alpha').closest('a')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_alpha/projects',
    );
    expect(screen.getByTestId('system-workspaces__preview')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__mode')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__basics')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__admin')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__idp')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('workspace_admin_card_label');
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('alpha-admin@example.com');
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
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ws_alpha',
              name: 'Alpha Workspace',
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ws_alpha',
              name: 'Alpha Workspace',
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
              created_at: '2026-03-01T00:00:00.000Z',
              updated_at: '2026-03-10T00:00:00.000Z',
            },
          ],
        }),
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
    fireEvent.click(screen.getByTestId('system-workspaces__save'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it('deletes selected workspace', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'ws_alpha',
              name: 'Alpha Workspace',
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
  });
});
